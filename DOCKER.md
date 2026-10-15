# Running the face swap engine in Docker

Three files make up the container setup:

| File                 | Purpose |
| -------------------- | ------- |
| `Dockerfile`         | Multi-stage build: `deps` → `build` → `runtime`, plus a `migrate` target. |
| `docker-compose.yml` | The app, a MySQL 8.4 database, and a one-shot migration job. |
| `.env.example`       | Every variable the app reads, with notes on which are required. |

## Quick start

```bash
cp .env.example .env
# Set JWT_SECRET at minimum - the server refuses to start in production without it:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

docker compose run --rm migrate   # create the schema
docker compose up -d app          # start the app
curl -fsS localhost:3000/api/health | jq
```

`docker compose up -d app` brings up `db` and runs `migrate` first — `app`
depends on the database being healthy and on the migration exiting cleanly.

## Health endpoints

Two, because they answer different questions:

- **`GET /api/health/live`** — liveness. 200 whenever the process can answer at
  all. Answers *should I restart this container?*
- **`GET /api/health`** — readiness. 200 only when every required dependency is
  reachable, 503 otherwise, with a per-dependency breakdown. Answers *should
  this container receive traffic?* The `HEALTHCHECK` and
  `depends_on: service_healthy` both use this one.

```json
{
  "status": "ok",
  "timestamp": "2026-10-15T16:00:00.000Z",
  "uptimeSeconds": 42,
  "environment": "production",
  "checks": [
    { "name": "database",  "status": "ok", "detail": "SELECT 1 succeeded", "durationMs": 3 },
    { "name": "storage",   "status": "ok", "detail": "credentials present", "durationMs": 0 },
    { "name": "replicate", "status": "ok", "detail": "token present",       "durationMs": 0 }
  ]
}
```

The `database` check runs a real `SELECT 1`; it does not merely confirm that
`DATABASE_URL` is a non-empty string. Missing configuration is an `error` in
production and `skipped` in development, so a local checkout with no Replicate
token does not show red.

## Webhooks

`POST /api/webhooks/replicate` receives Replicate's completion callbacks. Point
`WEBHOOK_URL` at it with a publicly reachable host:

```
WEBHOOK_URL=https://your-host.example.com/api/webhooks/replicate
REPLICATE_WEBHOOK_SECRET=whsec_...
```

Two things to know:

- **Verification fails closed.** With no `REPLICATE_WEBHOOK_SECRET`, every
  callback is rejected with a 401. That is deliberate — the alternative is that
  one unset variable turns the endpoint into "anyone may mark any job
  complete". Job completion still works without it, through client polling.
- **The route is mounted before the JSON body parser**, because signatures are
  computed over the exact bytes sent. Do not put a proxy in front of it that
  rewrites or re-serialises request bodies.

Unknown predictions are answered `200 {"status":"ignored"}` rather than 404, so
a callback that can never match a job does not get retried forever. A fault on
our side answers 500, which is the one case worth retrying.

## Background sweep for abandoned jobs

A job only used to advance when a client asked about it. Two ways that stranded
work: the output copy into storage fails (the job is left retryable, but only a
poll retries it, and the upstream URL expires within the hour), or the webhook
never arrives and nobody reopens the page.

An in-process sweep now asks Replicate about anything in flight that has gone
quiet and pushes it through the same completion path as the webhook and the
poll. It claims each job with a conditional `UPDATE` first, so two replicas — or
a sweep racing a client poll — cannot both download the same output.

It is on whenever `DATABASE_URL` and `REPLICATE_API_TOKEN` are both set, and
reports itself under `sweeper` in `/api/health`:

```json
{ "enabled": true, "runs": 3, "lastRunAt": "…", "lastRunMs": 120,
  "lastResult": { "examined": 2, "claimed": 1, "completed": 1,
                  "failed": 0, "stillWaiting": 0, "errors": 0 } }
```

When it is off, that object says why (`"reason": "DATABASE_URL is not set"`) —
a sweep that silently is not running is the kind of thing noticed only after a
job has been lost. Tunable with `STALE_JOB_SWEEP_INTERVAL_MS`,
`STALE_JOB_STALE_AFTER_MS`, `STALE_JOB_SWEEP_BATCH`, and
`STALE_JOB_SWEEP_ENABLED=false`.

Deliberately a timer rather than the platform's heartbeat cron
(`server/_core/heartbeat.ts`): that needs a publicly reachable
`/api/scheduled/` endpoint whose callbacks carry no documented signature to
verify, and it does not exist in a self-hosted container at all.

`sweeper` is reported but is **not** part of the health `status`. Readiness
answers "can this instance serve requests", and the sweep being off does not
stop it serving — its preconditions are already required checks.

## Build-time vs runtime variables

This is the setup's one sharp edge. **`VITE_*` variables are compiled into the
client bundle by vite during the build.** Putting them in `docker compose`
`environment:` does nothing — the JavaScript was already written. They are
declared as build args and must be set before the image is built:

```bash
docker compose build --build-arg VITE_APP_ID=my-app app
```

or, via `.env`, which compose passes through to the build args already wired up
in `docker-compose.yml`. Changing one requires a rebuild, not a restart.

Everything else (`DATABASE_URL`, `JWT_SECRET`, `REPLICATE_API_TOKEN`, …) is read
at runtime and a restart is enough.

## Migrations

`drizzle-kit` is a devDependency, so it is deliberately absent from the runtime
image. The `migrate` stage builds on `build`, which still has the dev
dependencies:

```bash
docker compose run --rm migrate          # drizzle-kit generate && migrate
```

Run it after any change to `drizzle/schema.ts`.

## Operational notes

- **Non-root.** The runtime stage runs as the image's unprivileged `node` user.
- **Signals.** The server handles `SIGTERM`/`SIGINT` and drains in-flight
  requests for up to 10s before exiting. `init: true` in compose reaps orphans
  and forwards signals; with plain `docker run`, pass `--init`.
- **Fixed port.** In production the server binds `PORT` or fails. It no longer
  scans for a free port — in a container that produced a process that looked
  healthy while the published port pointed at nothing. Port scanning is still
  on in development.
- **Fail-fast startup.** A missing `JWT_SECRET` or `DATABASE_URL`, a taken port,
  or any other startup error exits non-zero instead of logging and idling, so
  Docker's restart policy and any rollout gate see the failure.
- **The database port is not published** by default; uncomment the `ports` block
  in `docker-compose.yml` to reach it from the host.

## Build without compose

```bash
docker build --target runtime -t face-swap-engine .
docker run --init -p 3000:3000 --env-file .env face-swap-engine
```

## Troubleshooting

| Symptom | Cause |
| ------- | ----- |
| `/api/health` returns 503 with `database: error` | `DATABASE_URL` unset, or MySQL unreachable from the container. Check `docker compose logs db`. |
| Container exits immediately, log says `Missing required environment variable(s)` | Working as intended — set them in `.env`. |
| Client shows a blank page or an unconfigured app id | A `VITE_*` variable was set at runtime instead of build time. Rebuild. |
| `pnpm install --frozen-lockfile` fails during build | `pnpm-lock.yaml` is out of step with `package.json`. Run `pnpm install` locally and commit the lockfile. |
| Webhook callbacks rejected | `REPLICATE_WEBHOOK_SECRET` is unset. Verification fails closed by design. |

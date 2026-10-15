import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { HttpError } from "@shared/_core/errors";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerHealthRoutes } from "./health";
import { registerWebhookRoutes } from "../webhookRouter";
import { startStaleJobSweeper } from "../staleJobSweeper";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { ENV, validateEnv } from "./env";
import { serveStatic, setupVite } from "./vite";

/** Grace period for in-flight requests after a shutdown signal. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Resolve the port to listen on.
 *
 * Scanning for a free port is a convenience for local development, where a
 * stale `pnpm dev` may still hold 3000. In production it is a liability: a
 * container publishes one fixed port, so drifting to another one produces a
 * process that looks up while nothing can reach it. There, a taken port is a
 * startup failure.
 */
async function resolvePort(): Promise<number> {
  const preferredPort = parseInt(process.env.PORT || "3000", 10);

  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 1 ||
    preferredPort > 65535
  ) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  if (ENV.isProduction) {
    if (!(await isPortAvailable(preferredPort))) {
      throw new Error(
        `Port ${preferredPort} is already in use. Refusing to bind a different port in production.`
      );
    }
    return preferredPort;
  }

  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  return port;
}

/**
 * Terminal error handler. Without one, Express answers a thrown error with its
 * default HTML stack page - which leaks internals in production and gives API
 * clients a body they cannot parse.
 */
function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) {
    // Nothing useful left to say; let Express tear the connection down.
    return next(err);
  }

  const statusCode = err instanceof HttpError ? err.statusCode : 500;
  const message = err instanceof Error ? err.message : String(err);

  if (statusCode >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  }

  res.status(statusCode).json({
    error: {
      // A 500 message can carry connection strings or query text, so it is
      // logged above and withheld from the client in production only.
      message:
        statusCode >= 500 && ENV.isProduction
          ? "Internal server error"
          : message,
      statusCode,
    },
  });
}

/**
 * A crash that is only logged leaves the process in an unknown state while
 * still accepting traffic. Log, then exit non-zero so the supervisor or
 * container runtime replaces it.
 */
function registerProcessHandlers(onShutdown: () => Promise<void>) {
  process.on("unhandledRejection", reason => {
    console.error("[fatal] Unhandled promise rejection:", reason);
    process.exit(1);
  });

  process.on("uncaughtException", error => {
    console.error("[fatal] Uncaught exception:", error);
    process.exit(1);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`[shutdown] Received ${signal}, draining connections...`);
      onShutdown()
        .then(() => process.exit(0))
        .catch(error => {
          console.error("[shutdown] Failed to close cleanly:", error);
          process.exit(1);
        });
    });
  }
}

async function startServer() {
  validateEnv();

  const app = express();
  const server = createServer(app);

  // Before the JSON parser on purpose: webhook signatures are computed over the
  // exact bytes sent, and express.json() consumes the stream, after which the
  // original body cannot be recovered.
  registerWebhookRoutes(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerHealthRoutes(app);
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // Any /api path that reached here matches no route. The SPA fallback below
  // would answer it with index.html and a 200, so a mistyped endpoint looked
  // like a client-side parse bug instead of a 404.
  app.all("/api/*", (req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: `No API route for ${req.method} ${req.path}`,
        statusCode: 404,
      },
    });
  });

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  app.use(errorHandler);

  const port = await resolvePort();
  // Explicit, because the default host is not obvious when the process runs in
  // a container: binding loopback there makes the published port unreachable.
  const host = process.env.HOST || "0.0.0.0";

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      console.log(
        `Server running on http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`
      );
      resolve();
    });
  });

  // Started after listen, so a sweep can never race the server's own startup.
  const stopSweeper = startStaleJobSweeper();

  registerProcessHandlers(
    () =>
      new Promise<void>((resolve, reject) => {
        stopSweeper();
        const timer = setTimeout(() => {
          console.warn(
            `[shutdown] Still draining after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`
          );
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);
        timer.unref();

        server.close(error => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        });
      })
  );
}

startServer().catch(error => {
  // Previously this only logged, so a server that failed to start stayed alive
  // with exit code 0 and every health check and rollout gate read it as fine.
  console.error("[fatal] Server failed to start:", error);
  process.exit(1);
});

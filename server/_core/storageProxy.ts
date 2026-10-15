import type { Express, Request, Response } from "express";
import { ENV } from "./env";
import { sdk } from "./sdk";

/**
 * Serves a user's own uploads and finished renders.
 *
 * This route used to take the path straight out of the URL and hand it to the
 * storage backend to presign, with no session and no ownership check at all.
 * Anyone who could reach the server could fetch anyone's source photographs and
 * output videos, and the only thing standing in their way was guessing an
 * 8-character suffix on an otherwise entirely predictable path
 * (`outputs/face-swaps/<userId>/job-<jobId>-<timestamp>_<hash>.mp4`). A link
 * shared once worked forever, for everyone.
 *
 * Now: a valid session is required, the key must match the shape of a path this
 * application actually creates, and the user id embedded in that path must be
 * the caller's own.
 */

/**
 * The only key shapes this app produces. Anything else is refused rather than
 * passed through - the backend will presign whatever it is given, so an
 * unrecognised key is a request to sign something we never wrote.
 *
 * Group 1 is the owning user's id.
 */
const OWNED_KEY =
  /^(?:uploads\/(?:source-images|target-images|reference-videos|audio)|outputs\/face-swaps)\/(\d+)\/[A-Za-z0-9._-]+$/;

interface KeyOwner {
  ownerId: number;
}

function parseOwnedKey(key: string): KeyOwner | null {
  // Reject traversal outright rather than relying on the backend to normalise
  // it. Express decodes %2e%2e, so this has to be checked after decoding.
  if (key.split("/").some(segment => segment === "." || segment === "..")) {
    return null;
  }

  const match = OWNED_KEY.exec(key);
  if (!match) return null;

  const ownerId = Number(match[1]);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return null;

  return { ownerId };
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res
        .status(401)
        .set("Cache-Control", "no-store")
        .send("Authentication required");
      return;
    }

    const owned = parseOwnedKey(key);

    // 404 rather than 403 for both "no such shape" and "not yours": a 403 would
    // confirm that a given path exists and belongs to somebody, which is enough
    // to enumerate other users' jobs.
    if (!owned || (owned.ownerId !== user.id && user.role !== "admin")) {
      console.warn(
        `[StorageProxy] Refused ${key} for user ${user.id} (role ${user.role})`
      );
      res.status(404).set("Cache-Control", "no-store").send("Not found");
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(
          `[StorageProxy] forge error: ${forgeResp.status} ${body}`
        );
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      // private: the response carries a signed URL minted for this user.
      res.set("Cache-Control", "no-store, private");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

/** Exported for tests: the key-shape and ownership rule, without the HTTP layer. */
export const __testing = { parseOwnedKey, OWNED_KEY };

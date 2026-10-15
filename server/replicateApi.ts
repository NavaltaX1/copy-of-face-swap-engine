/**
 * Replicate Face Swap API Integration
 * Using the official Replicate Node.js SDK
 */

import crypto from "node:crypto";
import Replicate from "replicate";

// Using codeplugtech/face-swap as default (fastest and most cost-effective)
const DEFAULT_MODEL = "codeplugtech/face-swap:9a4f78985e86e0c8b0e2367a6af5de4d52947e22e22c3c66efb142e5328ddc20";

let replicateClient: Replicate | null = null;

/**
 * Get or initialize Replicate client
 */
export function getReplicateClient(): Replicate {
  if (!replicateClient) {
    const apiToken = process.env.REPLICATE_API_TOKEN;
    if (!apiToken) {
      throw new Error("REPLICATE_API_TOKEN environment variable not set");
    }
    // REPLICATE_API_BASE_URL exists so a deployment can route through its own
    // proxy, and so the job pipeline can be exercised end to end against a
    // stand-in. Unset, the SDK's own default (api.replicate.com) applies.
    const baseUrl = process.env.REPLICATE_API_BASE_URL;
    replicateClient = new Replicate(baseUrl ? { auth: apiToken, baseUrl } : { auth: apiToken });
  }
  return replicateClient;
}

interface FaceSwapInput {
  source_image: string;
  target_image: string;
}

interface PredictionStatus {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string;
  error?: string;
}

/**
 * Submit a face swap prediction to Replicate
 */
export async function submitFaceSwapPrediction(
  sourceImageUrl: string,
  targetImageUrl: string,
  options: {
    webhookUrl?: string;
    modelVersion?: string;
  } = {}
): Promise<{ predictionId: string; status: string }> {
  const client = getReplicateClient();

  const input: FaceSwapInput = {
    source_image: sourceImageUrl,
    target_image: targetImageUrl,
  };

  try {
    const prediction = await client.predictions.create({
      version: options.modelVersion || DEFAULT_MODEL,
      input,
      webhook: options.webhookUrl,
      webhook_events_filter: options.webhookUrl ? ["completed"] : undefined,
    });

    return {
      predictionId: prediction.id,
      status: prediction.status,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to submit face swap prediction: ${errorMessage}`);
  }
}

/**
 * Check the status of a face swap prediction
 */
export async function checkPredictionStatus(predictionId: string): Promise<PredictionStatus> {
  const client = getReplicateClient();

  try {
    const prediction = await client.predictions.get(predictionId);

    return {
      status: prediction.status as any,
      output: prediction.output ? (Array.isArray(prediction.output) ? prediction.output[0] : prediction.output) : undefined,
      error: prediction.error ? String(prediction.error) : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to check prediction status: ${errorMessage}`);
  }
}

/**
 * Cancel a prediction
 */
export async function cancelPrediction(predictionId: string): Promise<void> {
  const client = getReplicateClient();

  try {
    await client.predictions.cancel(predictionId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to cancel prediction: ${errorMessage}`);
  }
}

/**
 * Get available face swap models
 */
export async function getAvailableModels(): Promise<
  Array<{
    name: string;
    version: string;
    description: string;
  }>
> {
  return [
    {
      name: "codeplugtech/face-swap",
      version: DEFAULT_MODEL,
      description: "Fast and cost-effective face swap (fastest, ~$0.0061 per run)",
    },
    {
      name: "easel/advanced-face-swap",
      version: "easel/advanced-face-swap:latest",
      description: "High-quality face swap with multi-face support",
    },
    {
      name: "fofr/face-swap-with-ideogram",
      version: "fofr/face-swap-with-ideogram:latest",
      description: "Stylized face swap with character consistency",
    },
  ];
}

/** How far a webhook timestamp may drift before it is treated as a replay. */
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export interface ReplicateWebhookHeaders {
  /** `webhook-id` */
  id: string | undefined;
  /** `webhook-timestamp`, unix seconds as a string */
  timestamp: string | undefined;
  /** `webhook-signature`, space-separated `v1,<base64>` entries */
  signature: string | undefined;
}

export type WebhookVerification =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Verify a Replicate webhook, which is signed per the Standard Webhooks spec:
 *
 *   signed content = `${webhook-id}.${webhook-timestamp}.${raw body}`
 *   signature      = base64(HMAC-SHA256(secret, signed content))
 *   header         = `v1,<signature>` (space-separated, several during rotation)
 *
 * The secret arrives as `whsec_<base64 key>`; the key is the decoded part after
 * the prefix, not the literal string.
 *
 * Three properties this needs to hold, each of which the previous placeholder
 * implementation got wrong:
 *
 *  - It fails closed. Returning true when REPLICATE_WEBHOOK_SECRET was unset
 *    meant the one configuration mistake that disables verification also made
 *    every unsigned request from anyone on the internet look authentic.
 *  - It signs over id and timestamp, not the body alone, so a captured request
 *    cannot be replayed indefinitely.
 *  - It compares in constant time, and survives a length mismatch, which makes
 *    crypto.timingSafeEqual throw if handed straight to it.
 *
 * The raw request body must be passed byte-for-byte. A body that has been
 * through JSON.parse and re-stringified will not match.
 *
 * NOTE: implemented to the published signature format; it has not been checked
 * against a live Replicate callback. It fails closed, so a mistake here costs
 * rejected webhooks rather than accepted forgeries - and job completion still
 * works through polling.
 */
export function verifyReplicateWebhook(
  headers: ReplicateWebhookHeaders,
  rawBody: string
): WebhookVerification {
  const secret = process.env.REPLICATE_WEBHOOK_SECRET;

  if (!secret) {
    return { valid: false, reason: "REPLICATE_WEBHOOK_SECRET is not set" };
  }

  const { id, timestamp, signature } = headers;
  if (!id) return { valid: false, reason: "missing webhook-id header" };
  if (!timestamp) return { valid: false, reason: "missing webhook-timestamp header" };
  if (!signature) return { valid: false, reason: "missing webhook-signature header" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { valid: false, reason: "webhook-timestamp is not a number" };
  }

  const driftSeconds = Math.abs(Date.now() / 1000 - sentAt);
  if (driftSeconds > WEBHOOK_TOLERANCE_SECONDS) {
    return {
      valid: false,
      reason: `webhook-timestamp is ${Math.round(driftSeconds)}s away from now (tolerance ${WEBHOOK_TOLERANCE_SECONDS}s)`,
    };
  }

  // `whsec_` prefix is conventional; tolerate a raw key without it.
  const keyMaterial = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = Buffer.from(keyMaterial, "base64");
  if (key.length === 0) {
    return { valid: false, reason: "REPLICATE_WEBHOOK_SECRET is not valid base64" };
  }

  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  // Several signatures appear side by side while a secret is being rotated;
  // any one matching is enough.
  const candidates = signature
    .split(" ")
    .filter(part => part.startsWith("v1,"))
    .map(part => part.slice("v1,".length));

  if (candidates.length === 0) {
    return { valid: false, reason: "no v1 signature in webhook-signature header" };
  }

  for (const candidate of candidates) {
    const provided = Buffer.from(candidate, "base64");
    if (provided.length !== expected.length) continue;
    if (crypto.timingSafeEqual(provided, expected)) return { valid: true };
  }

  return { valid: false, reason: "no signature matched" };
}

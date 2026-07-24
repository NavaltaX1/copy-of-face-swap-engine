/**
 * Replicate Face Swap API Integration
 * Using the official Replicate Node.js SDK
 */

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
    replicateClient = new Replicate({ auth: apiToken });
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

/**
 * Verify Replicate webhook signature (optional, for webhook security)
 */
export function verifyReplicateWebhook(
  body: string,
  signature: string
): boolean {
  // Replicate webhooks can be verified using the webhook secret
  // For now, we'll accept all webhooks (production should verify)
  const secret = process.env.REPLICATE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn("REPLICATE_WEBHOOK_SECRET not set - webhook verification skipped");
    return true;
  }

  const crypto = require("crypto");
  const hash = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return hash === signature;
}

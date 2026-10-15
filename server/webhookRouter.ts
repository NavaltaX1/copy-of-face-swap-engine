/**
 * Replicate webhook receiver.
 *
 * WEBHOOK_URL was already being handed to Replicate on every submission, and
 * nothing was listening: predictions fired callbacks into the void and job
 * completion depended entirely on the client polling getJobStatus. A job whose
 * tab was closed stayed "processing" forever.
 *
 * Mounted before the JSON body parser, because signature verification needs the
 * request bytes exactly as sent - a body that has been through JSON.parse and
 * re-stringified will not match the signature.
 */

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { getFaceSwapJobByPredictionId } from "./db";
import { finalizeFailedJob, finalizeSucceededJob } from "./jobCompletion";
import { verifyReplicateWebhook } from "./replicateApi";

export const REPLICATE_WEBHOOK_PATH = "/api/webhooks/replicate";

const payloadSchema = z.object({
  /** The prediction id, which is what we stored on the job. */
  id: z.string().min(1),
  status: z.string().min(1),
  // Model output is a URL, or a list of them for multi-output models.
  output: z.union([z.string(), z.array(z.string())]).nullish(),
  error: z.unknown().nullish(),
});

function firstOutput(
  output: string | string[] | null | undefined
): string | undefined {
  if (typeof output === "string") return output || undefined;
  if (Array.isArray(output))
    return output.find(entry => typeof entry === "string" && entry);
  return undefined;
}

function describeUpstreamError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (typeof error === "string") return error || undefined;
  if (error instanceof Error) return error.message;
  return JSON.stringify(error);
}

async function handleReplicateWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!rawBody) {
      res
        .status(400)
        .json({ error: { message: "Empty request body", statusCode: 400 } });
      return;
    }

    const verification = verifyReplicateWebhook(
      {
        id: req.get("webhook-id"),
        timestamp: req.get("webhook-timestamp"),
        signature: req.get("webhook-signature"),
      },
      rawBody
    );

    if (!verification.valid) {
      // The reason is logged rather than returned: it is useful to whoever runs
      // this, and of no legitimate use to whoever sent an unsigned request.
      console.warn(
        `[webhook] Rejected Replicate callback: ${verification.reason}`
      );
      res.status(401).json({
        error: { message: "Invalid webhook signature", statusCode: 401 },
      });
      return;
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      res.status(400).json({
        error: { message: "Body is not valid JSON", statusCode: 400 },
      });
      return;
    }

    const payload = payloadSchema.safeParse(parsedBody);
    if (!payload.success) {
      res.status(400).json({
        error: { message: "Unexpected webhook payload shape", statusCode: 400 },
      });
      return;
    }

    const { id: predictionId, status } = payload.data;
    const job = await getFaceSwapJobByPredictionId(predictionId);

    if (!job) {
      // 200 on purpose. A prediction we have no job for will never become one,
      // and a non-2xx would have the sender retrying it indefinitely.
      console.warn(
        `[webhook] No job for prediction ${predictionId}; ignoring.`
      );
      res.status(200).json({ status: "ignored", reason: "unknown prediction" });
      return;
    }

    switch (status) {
      case "succeeded": {
        const output = firstOutput(payload.data.output);
        if (!output) {
          // Upstream claims success with nothing to download. Leaving the job
          // in processing would strand it, so it is closed as failed with the
          // contradiction stated plainly.
          const outcome = await finalizeFailedJob(
            job,
            "Upstream reported success but sent no output"
          );
          res.status(200).json(outcome);
          return;
        }
        res.status(200).json(await finalizeSucceededJob(job, output));
        return;
      }

      case "failed": {
        const message =
          describeUpstreamError(payload.data.error) ??
          "Face swap processing failed";
        res.status(200).json(await finalizeFailedJob(job, message));
        return;
      }

      case "canceled": {
        res
          .status(200)
          .json(
            await finalizeFailedJob(job, "Face swap prediction was canceled")
          );
        return;
      }

      default:
        // Submissions filter for completed events, so an in-flight status here
        // is informational. Acknowledged without touching the job.
        res.status(200).json({
          status: "ignored",
          reason: `non-terminal status: ${status}`,
        });
        return;
    }
  } catch (error) {
    // Handed to the error middleware, which answers 5xx - the one case where a
    // retry from Replicate is worth having, since the fault is ours.
    next(error);
  }
}

export function registerWebhookRoutes(app: Express): void {
  app.post(
    REPLICATE_WEBHOOK_PATH,
    // type "*/*" because the signature covers whatever bytes arrived,
    // regardless of the content-type claimed.
    express.raw({ type: "*/*", limit: "1mb" }),
    handleReplicateWebhook
  );
}

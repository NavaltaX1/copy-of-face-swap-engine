/**
 * Face Swap Router - tRPC procedures for face swap operations
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  createFaceSwapJob,
  getFaceSwapJobById,
  getUserFaceSwapJobs,
  updateFaceSwapJob,
  getUserSettings,
  createOrUpdateUserSettings,
  createNotification,
  getUserNotifications,
} from "./db";
import { storagePut, storageGet } from "./storage";
import { submitFaceSwapPrediction, checkPredictionStatus } from "./replicateApi";
import { finalizeFailedJob, finalizeSucceededJob } from "./jobCompletion";
import { TRPCError } from "@trpc/server";

/**
 * The statuses the `faceSwapJobs.status` column accepts. Replicate's vocabulary
 * is its own and can grow, so anything outside this set must not reach the
 * database: MySQL either rejects the write or coerces it to an empty string,
 * neither of which the UI can render.
 */
const JOB_STATUSES = ["pending", "queued", "processing", "completed", "failed"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

/** Replicate's in-flight statuses, mapped onto ours. */
const REPLICATE_STATUS_MAP: Record<string, JobStatus> = {
  starting: "processing",
  processing: "processing",
};

export const faceSwapRouter = router({
  /**
   * Submit a new face swap job
   */
  submitJob: protectedProcedure
    .input(
      z.object({
        sourceImageBase64: z.string().describe("Base64 encoded source image"),
        targetImageBase64: z.string().optional().describe("Base64 encoded target image (optional)"),
        referenceVideoBase64: z.string().optional().describe("Base64 encoded reference video (optional)"),
        audioBase64: z.string().optional().describe("Base64 encoded audio file (optional)"),
        aspectRatio: z.enum(["original", "9:16"]).default("original"),
        visualStyle: z.enum(["none", "cinematic", "vivid", "soft", "bw"]).default("none"),
        nsfwEnabled: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Upload source image to S3
        const sourceImageBuffer = Buffer.from(input.sourceImageBase64, "base64");
        const sourceImageResult = await storagePut(
          `uploads/source-images/${ctx.user.id}/${Date.now()}.jpg`,
          sourceImageBuffer,
          "image/jpeg"
        );

        // Upload target image to S3 (optional)
        let targetImageResult = null;
        if (input.targetImageBase64) {
          const targetImageBuffer = Buffer.from(input.targetImageBase64, "base64");
          targetImageResult = await storagePut(
            `uploads/target-images/${ctx.user.id}/${Date.now()}.jpg`,
            targetImageBuffer,
            "image/jpeg"
          );
        }

        // Upload reference video to S3 (optional)
        let referenceVideoResult = null;
        if (input.referenceVideoBase64) {
          const referenceVideoBuffer = Buffer.from(input.referenceVideoBase64, "base64");
          referenceVideoResult = await storagePut(
            `uploads/reference-videos/${ctx.user.id}/${Date.now()}.mp4`,
            referenceVideoBuffer,
            "video/mp4"
          );
        }

        // Upload audio to S3 (optional)
        let audioResult = null;
        if (input.audioBase64) {
          const audioBuffer = Buffer.from(input.audioBase64, "base64");
          audioResult = await storagePut(
            `uploads/audio/${ctx.user.id}/${Date.now()}.mp3`,
            audioBuffer,
            "audio/mpeg"
          );
        }

        // Create job record in database
        const jobId = await createFaceSwapJob({
          userId: ctx.user.id,
          sourceImageUrl: sourceImageResult.url,
          targetVideoUrl: targetImageResult?.url || null,
          referenceVideoUrl: referenceVideoResult?.url || null,
          audioUrl: audioResult?.url || null,
          status: "pending",
          aspectRatio: input.aspectRatio,
          visualStyle: input.visualStyle,
          nsfwEnabled: input.nsfwEnabled ? 1 : 0,
        });

        // Submit to Replicate API
        try {
          const replicateResponse = await submitFaceSwapPrediction(
            sourceImageResult.url,
            targetImageResult?.url || sourceImageResult.url,
            {
              webhookUrl: process.env.WEBHOOK_URL,
            }
          );

          // Update job with Replicate prediction ID and queued status
          await updateFaceSwapJob(jobId, {
            akoolJobId: replicateResponse.predictionId,
            status: "queued",
          });

          return {
            jobId,
            predictionId: replicateResponse.predictionId,
            status: "queued",
          };
        } catch (replicateError) {
          // Update job with error status
          await updateFaceSwapJob(jobId, {
            status: "failed",
            errorMessage: `Replicate API error: ${(replicateError as Error).message}`,
          });

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to submit to Replicate API: ${(replicateError as Error).message}`,
          });
        }
      } catch (error) {
        // Re-wrapping a TRPCError flattened its code to 500 and doubled its
        // message, so a BAD_REQUEST or NOT_FOUND raised above reached the
        // client as an unhelpful internal error.
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to submit face swap job: ${(error as Error).message}`,
        });
      }
    }),

  /**
   * Get job status and details
   */
  getJobStatus: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await getFaceSwapJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to view this job",
        });
      }

      // Reported to the client when the upstream poll itself fails, so a
      // stalled job can be told apart from one that is genuinely still working.
      let statusCheckError: string | null = null;

      // If job is queued or processing, check status with Replicate
      if ((job.status === "queued" || job.status === "processing") && job.akoolJobId) {
        try {
          const replicateStatus = await checkPredictionStatus(job.akoolJobId);

          // Terminal transitions go through jobCompletion, which the webhook
          // route uses too, so the two paths cannot disagree about what "done"
          // means - or about notifying the user, which nothing used to do.
          if (replicateStatus.status === "succeeded" && replicateStatus.output) {
            const outcome = await finalizeSucceededJob(job, replicateStatus.output);
            if (outcome.kind === "storage_retry") {
              statusCheckError = outcome.message;
            }
          } else if (replicateStatus.status === "failed") {
            await finalizeFailedJob(
              job,
              replicateStatus.error || "Face swap processing failed"
            );
          } else if (replicateStatus.status === "canceled") {
            await finalizeFailedJob(job, "Face swap prediction was canceled");
          } else {
            // Map Replicate status to our status. An unrecognised one is left
            // alone rather than written through: the column is an enum, so an
            // unknown value is rejected or silently blanked.
            const mappedStatus = REPLICATE_STATUS_MAP[replicateStatus.status];
            if (!mappedStatus) {
              statusCheckError = `Unrecognised upstream status: ${replicateStatus.status}`;
              console.warn(`[faceSwap] Job ${input.jobId}: ${statusCheckError}`);
            } else if (mappedStatus !== job.status) {
              await updateFaceSwapJob(input.jobId, {
                status: mappedStatus,
              });
            }
          }
        } catch (error) {
          // Logging alone left the client polling a job that reads "processing"
          // forever with no sign the status check is the thing failing.
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[faceSwap] Job ${input.jobId}: status check failed:`, error);
          statusCheckError = `Status check failed: ${message}`;
        }
      }

      const updatedJob = await getFaceSwapJobById(input.jobId);

      if (!updatedJob) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job disappeared while its status was being checked",
        });
      }

      return { ...updatedJob, statusCheckError };
    }),

  /**
   * Get user's job history
   */
  getJobHistory: protectedProcedure.query(async ({ ctx }) => {
    const jobs = await getUserFaceSwapJobs(ctx.user.id);
    return jobs;
  }),

  /**
   * Get download URL for completed job
   */
  getDownloadUrl: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await getFaceSwapJobById(input.jobId);

      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      if (job.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to download this file",
        });
      }

      if (job.status !== "completed" || !job.outputVideoUrl) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Job is not completed or has no output",
        });
      }

      return { downloadUrl: job.outputVideoUrl };
    }),

  /**
   * Get user settings
   */
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const settings = await getUserSettings(ctx.user.id);
    return settings || { userId: ctx.user.id, nsfwToggle: 0, emailNotifications: 1, inAppNotifications: 1 };
  }),

  /**
   * Update user settings
   */
  updateSettings: protectedProcedure
    .input(
      z.object({
        nsfwToggle: z.boolean().optional(),
        emailNotifications: z.boolean().optional(),
        inAppNotifications: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const updates = {
        nsfwToggle: input.nsfwToggle ? 1 : 0,
        emailNotifications: input.emailNotifications ? 1 : 0,
        inAppNotifications: input.inAppNotifications ? 1 : 0,
      };

      await createOrUpdateUserSettings(ctx.user.id, updates);
      return await getUserSettings(ctx.user.id);
    }),

  /**
   * Get user notifications
   */
  getNotifications: protectedProcedure.query(async ({ ctx }) => {
    const notifications = await getUserNotifications(ctx.user.id);
    return notifications;
  }),
});

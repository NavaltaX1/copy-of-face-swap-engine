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
import { processCompletedJob } from "./outputHandler";
import { TRPCError } from "@trpc/server";

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
        const jobResult = await createFaceSwapJob({
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

        const jobId = (jobResult as any).insertId;

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

      // If job is queued or processing, check status with Replicate
      if ((job.status === "queued" || job.status === "processing") && job.akoolJobId) {
        try {
          const replicateStatus = await checkPredictionStatus(job.akoolJobId);

          // Update job status if changed
          if (replicateStatus.status === "succeeded" && replicateStatus.output) {
            try {
              // Download output from Replicate and store in S3
              const storedOutput = await processCompletedJob(
                input.jobId,
                ctx.user.id,
                replicateStatus.output
              );

              await updateFaceSwapJob(input.jobId, {
                status: "completed",
                outputVideoUrl: storedOutput.storageUrl,
                completedAt: new Date(),
              });
            } catch (storageError) {
              console.error("Error storing output:", storageError);
              // Still mark as completed but with error note
              await updateFaceSwapJob(input.jobId, {
                status: "completed",
                outputVideoUrl: replicateStatus.output, // Fallback to Replicate URL
                errorMessage: `Output storage failed: ${(storageError as Error).message}`,
                completedAt: new Date(),
              });
            }
          } else if (replicateStatus.status === "failed") {
            await updateFaceSwapJob(input.jobId, {
              status: "failed",
              errorMessage: replicateStatus.error || "Face swap processing failed",
            });
          } else if (replicateStatus.status === "canceled") {
            await updateFaceSwapJob(input.jobId, {
              status: "failed",
              errorMessage: "Face swap prediction was canceled",
            });
          } else {
            // Map Replicate status to our status
            const statusMap: Record<string, any> = {
              starting: "processing",
              processing: "processing",
            };
            const mappedStatus = statusMap[replicateStatus.status] || replicateStatus.status;
            if (mappedStatus !== job.status) {
              await updateFaceSwapJob(input.jobId, {
                status: mappedStatus,
              });
            }
          }
        } catch (error) {
          console.error("Error checking Replicate status:", error);
        }
      }

      const updatedJob = await getFaceSwapJobById(input.jobId);
      return updatedJob;
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

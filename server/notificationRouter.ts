/**
 * Notification Router
 * tRPC procedures for managing notifications
 */

import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import { notifications } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

export const notificationRouter = router({
  /**
   * Get user's notifications
   */
  getNotifications: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(10),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      const userNotifications = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, ctx.user.id))
        .orderBy((t) => t.createdAt)
        .limit(input.limit)
        .offset(input.offset);

      return userNotifications;
    }),

  /**
   * Mark notification as read
   */
  markAsRead: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Verify ownership
      const notification = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, input.notificationId))
        .limit(1);

      if (!notification || notification[0]?.userId !== ctx.user.id) {
        throw new Error("Unauthorized");
      }

      // Mark as sent (read)
      await db
        .update(notifications)
        .set({ status: "sent" })
        .where(eq(notifications.id, input.notificationId));

      return { success: true };
    }),

  /**
   * Delete notification
   */
  deleteNotification: protectedProcedure
    .input(z.object({ notificationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      // Verify ownership
      const notification = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, input.notificationId))
        .limit(1);

      if (!notification || notification[0]?.userId !== ctx.user.id) {
        throw new Error("Unauthorized");
      }

      // Delete notification
      await db.delete(notifications).where(eq(notifications.id, input.notificationId));

      return { success: true };
    }),

  /**
   * Get unread notification count
   */
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const result = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.user.id),
          eq(notifications.status, "pending")
        )
      );

    return { unreadCount: result.length };
  }),
});

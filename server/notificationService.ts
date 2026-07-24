/**
 * Notification Service
 * Handles email and in-app notifications for face swap job completion
 */

import { getDb } from "./db";
import { notifications, InsertNotification } from "../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Send email notification
 */
export async function sendEmailNotification(
  email: string,
  subject: string,
  message: string
): Promise<boolean> {
  try {
    // Using Manus built-in notification API
    const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
    const apiKey = process.env.BUILT_IN_FORGE_API_KEY;

    if (!apiUrl || !apiKey) {
      console.error("Missing Manus API credentials");
      return false;
    }

    const response = await fetch(`${apiUrl}/notification/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: email,
        subject,
        html: message,
      }),
    });

    if (!response.ok) {
      console.error("Failed to send email notification:", response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending email notification:", error);
    return false;
  }
}

/**
 * Create in-app notification
 */
export async function createInAppNotification(
  userId: number,
  jobId: number,
  content: string
): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      console.error("Database not available");
      return false;
    }

    const notification: InsertNotification = {
      userId,
      jobId,
      type: "in_app",
      status: "pending",
      content,
    };

    await db.insert(notifications).values(notification);
    return true;
  } catch (error) {
    console.error("Error creating in-app notification:", error);
    return false;
  }
}

/**
 * Send job completion notification
 */
export async function sendJobCompletionNotification(
  userId: number,
  jobId: number,
  userEmail: string | null,
  userName: string | null,
  outputUrl: string,
  emailNotificationsEnabled: boolean,
  inAppNotificationsEnabled: boolean
): Promise<void> {
  const jobLink = `${process.env.VITE_FRONTEND_FORGE_API_URL}/jobs`;
  const downloadLink = outputUrl;

  // Email notification
  if (emailNotificationsEnabled && userEmail) {
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #00f5ff; text-shadow: 0 0 10px #00f5ff;">FACE SWAP COMPLETE</h2>
        <p>Hi ${userName || "User"},</p>
        <p>Your face swap job has been completed successfully!</p>
        <p>
          <a href="${downloadLink}" style="
            display: inline-block;
            padding: 12px 24px;
            background-color: #00f5ff;
            color: #000;
            text-decoration: none;
            border-radius: 4px;
            font-weight: bold;
            margin: 20px 0;
          ">DOWNLOAD OUTPUT</a>
        </p>
        <p>
          <a href="${jobLink}" style="color: #ff006e; text-decoration: none;">View all jobs</a>
        </p>
        <hr style="border: 1px solid #00f5ff; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          This is an automated notification from Face Swap Engine.
        </p>
      </div>
    `;

    await sendEmailNotification(
      userEmail,
      "Your Face Swap Job is Ready!",
      emailContent
    );
  }

  // In-app notification
  if (inAppNotificationsEnabled) {
    const content = `Your face swap job #${jobId} is complete! <a href="${downloadLink}">Download now</a>`;
    await createInAppNotification(userId, jobId, content);
  }
}

/**
 * Send job failure notification
 */
export async function sendJobFailureNotification(
  userId: number,
  jobId: number,
  userEmail: string | null,
  userName: string | null,
  errorMessage: string,
  emailNotificationsEnabled: boolean,
  inAppNotificationsEnabled: boolean
): Promise<void> {
  const jobLink = `${process.env.VITE_FRONTEND_FORGE_API_URL}/jobs`;

  // Email notification
  if (emailNotificationsEnabled && userEmail) {
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ff006e; text-shadow: 0 0 10px #ff006e;">FACE SWAP FAILED</h2>
        <p>Hi ${userName || "User"},</p>
        <p>Unfortunately, your face swap job encountered an error:</p>
        <p style="
          background-color: #1a1f3a;
          padding: 12px;
          border-left: 4px solid #ff006e;
          color: #ff006e;
          font-family: monospace;
        ">${errorMessage}</p>
        <p>
          <a href="${jobLink}" style="color: #00f5ff; text-decoration: none;">View job details</a>
        </p>
        <hr style="border: 1px solid #ff006e; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          This is an automated notification from Face Swap Engine.
        </p>
      </div>
    `;

    await sendEmailNotification(
      userEmail,
      "Face Swap Job Failed",
      emailContent
    );
  }

  // In-app notification
  if (inAppNotificationsEnabled) {
    const content = `Face swap job #${jobId} failed: ${errorMessage}`;
    await createInAppNotification(userId, jobId, content);
  }
}

/**
 * Mark notification as sent
 */
export async function markNotificationAsSent(notificationId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.error("Database not available");
      return;
    }

    // Update notification status
    // Note: Drizzle ORM update syntax
    await db
      .update(notifications)
      .set({
        status: "sent",
        sentAt: new Date(),
      })
      .where(eq(notifications.id, notificationId));
  } catch (error) {
    console.error("Error marking notification as sent:", error);
  }
}

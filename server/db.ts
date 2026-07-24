import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, faceSwapJobs, InsertFaceSwapJob, notifications, InsertNotification, userSettings, InsertUserSettings } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Face Swap Jobs queries
 */
export async function createFaceSwapJob(job: InsertFaceSwapJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(faceSwapJobs).values(job);
  return result;
}

export async function getFaceSwapJobById(jobId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(faceSwapJobs).where(eq(faceSwapJobs.id, jobId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserFaceSwapJobs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(faceSwapJobs).where(eq(faceSwapJobs.userId, userId)).orderBy(desc(faceSwapJobs.createdAt));
}

export async function updateFaceSwapJob(jobId: number, updates: Partial<InsertFaceSwapJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(faceSwapJobs).set(updates).where(eq(faceSwapJobs.id, jobId));
}

/**
 * Notifications queries
 */
export async function createNotification(notification: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(notifications).values(notification);
}

export async function getUserNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(desc(notifications.createdAt));
}

export async function updateNotification(notificationId: number, updates: Partial<InsertNotification>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(notifications).set(updates).where(eq(notifications.id, notificationId));
}

/**
 * User Settings queries
 */
export async function getUserSettings(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createOrUpdateUserSettings(userId: number, settings: Partial<InsertUserSettings>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getUserSettings(userId);
  if (existing) {
    return db.update(userSettings).set({ ...settings, updatedAt: new Date() }).where(eq(userSettings.userId, userId));
  } else {
    return db.insert(userSettings).values({ userId, ...settings } as InsertUserSettings);
  }
}

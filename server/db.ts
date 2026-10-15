import { eq, desc, sql, and, inArray, lte, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  faceSwapJobs,
  InsertFaceSwapJob,
  notifications,
  InsertNotification,
  userSettings,
  InsertUserSettings,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Raised when a query is attempted with no database configured. Distinct from a
 * query that failed against a real database, so callers and the health endpoint
 * can tell "never set up" apart from "set up and broken".
 */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Database not configured: set DATABASE_URL");
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * Lazily create the drizzle instance so local tooling can run without a DB.
 *
 * Returns null only when DATABASE_URL is unset. A malformed URL throws: it is a
 * configuration error, and swallowing it here used to turn every subsequent
 * query into a silent no-op that returned empty results.
 *
 * Note that this does not open a connection - drizzle/mysql2 pools connect on
 * first query - so an unreachable server surfaces at query time, or from
 * pingDatabase() below.
 */
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    _db = drizzle(process.env.DATABASE_URL);
  }
  return _db;
}

/**
 * The database, or a thrown error. Use this on any path where returning an
 * empty result would be indistinguishable from a legitimately empty one.
 */
async function requireDb() {
  const db = await getDb();
  if (!db) throw new DatabaseUnavailableError();
  return db;
}

/**
 * Actually round-trip a query, so the health endpoint reports reachability
 * rather than the presence of a connection string.
 */
export async function pingDatabase(): Promise<"ok" | "unconfigured"> {
  const db = await getDb();
  if (!db) return "unconfigured";
  await db.execute(sql`select 1`);
  return "ok";
}

/**
 * Pull the mysql2 ResultSetHeader out of a drizzle write result.
 *
 * drizzle-orm/mysql2 resolves inserts and updates to `[ResultSetHeader,
 * FieldPacket[]]`, so `result.insertId` and `result.affectedRows` read
 * `undefined` off the array itself. Callers did exactly that, which is how a
 * submitted job never received its prediction id: the id was `undefined`, the
 * follow-up UPDATE matched nothing, and the job sat at `pending` with the
 * render already running upstream and no way to connect the two.
 *
 * Throws rather than returning a default, because every caller is deciding
 * something - which row to update, whether a claim succeeded - and a guessed
 * zero would put the silence straight back.
 */
export function writeResultHeader(result: unknown): {
  affectedRows: number;
  insertId: number;
} {
  const header = (Array.isArray(result) ? result[0] : result) as
    | { affectedRows?: unknown; insertId?: unknown }
    | undefined;

  const affectedRows = header?.affectedRows;
  const insertId = header?.insertId;

  if (typeof affectedRows !== "number" || typeof insertId !== "number") {
    throw new Error(
      "Could not read affectedRows/insertId from the database write result. " +
        "The driver's result shape is not what this code expects, so the write " +
        "cannot be confirmed."
    );
  }

  return { affectedRows, insertId };
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  // A sign-in that does not persist the user leaves every later lookup
  // returning undefined, so this fails here rather than mid-session.
  const db = await requireDb();

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
      values.role = "admin";
      updateSet.role = "admin";
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
  const db = await requireDb();

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Face Swap Jobs queries
 */
/** Returns the new job's id, so callers never touch the driver result. */
export async function createFaceSwapJob(
  job: InsertFaceSwapJob
): Promise<number> {
  const db = await requireDb();
  const result = await db.insert(faceSwapJobs).values(job);
  const { insertId } = writeResultHeader(result);

  if (insertId <= 0) {
    throw new Error("Job insert reported no id");
  }

  return insertId;
}

export async function getFaceSwapJobById(jobId: number) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(faceSwapJobs)
    .where(eq(faceSwapJobs.id, jobId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Look a job up by the upstream prediction id (stored in akoolJobId, named for
 * the provider this started out on). Needed by the webhook route, which is told
 * the prediction id and nothing about our own job ids.
 */
export async function getFaceSwapJobByPredictionId(predictionId: string) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(faceSwapJobs)
    .where(eq(faceSwapJobs.akoolJobId, predictionId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserFaceSwapJobs(userId: number) {
  // Returning [] with no database made "your history is empty" and "the
  // database is down" the same screen.
  const db = await requireDb();
  return db
    .select()
    .from(faceSwapJobs)
    .where(eq(faceSwapJobs.userId, userId))
    .orderBy(desc(faceSwapJobs.createdAt));
}

/** Statuses a job can sit in while still waiting on the upstream render. */
export const IN_FLIGHT_STATUSES = ["queued", "processing"] as const;

/**
 * Jobs still in flight that nothing has touched for a while.
 *
 * `updatedAt` carries ON UPDATE CURRENT_TIMESTAMP, so it advances on every
 * status write and on a sweeper claim - which makes "not updated since X" a
 * usable definition of abandoned without adding a column for it.
 */
export async function findStaleJobs(notUpdatedSince: Date, limit: number) {
  const db = await requireDb();
  return db
    .select()
    .from(faceSwapJobs)
    .where(
      and(
        inArray(faceSwapJobs.status, [...IN_FLIGHT_STATUSES]),
        lte(faceSwapJobs.updatedAt, notUpdatedSince),
        // Nothing can be asked about upstream without its prediction id.
        isNotNull(faceSwapJobs.akoolJobId)
      )
    )
    .orderBy(faceSwapJobs.updatedAt)
    .limit(limit);
}

/**
 * Take ownership of a stale job by bumping its updatedAt, conditional on it
 * still being stale and still in flight.
 *
 * Returns false when someone else got there first. This is what keeps two
 * server replicas - or a sweep overlapping a client poll - from both
 * downloading the same output and racing to store it. The bump also moves the
 * job out of the stale window for another interval, so a job that keeps
 * failing is retried on a schedule rather than hammered.
 */
export async function claimStaleJob(
  jobId: number,
  notUpdatedSince: Date
): Promise<boolean> {
  const db = await requireDb();
  const result = await db
    .update(faceSwapJobs)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(faceSwapJobs.id, jobId),
        inArray(faceSwapJobs.status, [...IN_FLIGHT_STATUSES]),
        lte(faceSwapJobs.updatedAt, notUpdatedSince)
      )
    );

  return writeResultHeader(result).affectedRows === 1;
}

export async function updateFaceSwapJob(
  jobId: number,
  updates: Partial<InsertFaceSwapJob>
) {
  const db = await requireDb();
  return db.update(faceSwapJobs).set(updates).where(eq(faceSwapJobs.id, jobId));
}

/**
 * Notifications queries
 */
export async function createNotification(notification: InsertNotification) {
  const db = await requireDb();
  return db.insert(notifications).values(notification);
}

export async function getUserNotifications(userId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt));
}

export async function updateNotification(
  notificationId: number,
  updates: Partial<InsertNotification>
) {
  const db = await requireDb();
  return db
    .update(notifications)
    .set(updates)
    .where(eq(notifications.id, notificationId));
}

/**
 * User Settings queries
 */
export async function getUserSettings(userId: number) {
  const db = await requireDb();
  const result = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createOrUpdateUserSettings(
  userId: number,
  settings: Partial<InsertUserSettings>
) {
  const db = await requireDb();
  const existing = await getUserSettings(userId);
  if (existing) {
    return db
      .update(userSettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(userSettings.userId, userId));
  } else {
    return db
      .insert(userSettings)
      .values({ userId, ...settings } as InsertUserSettings);
  }
}

import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Face Swap Jobs table - stores all face swap processing jobs
 */
export const faceSwapJobs = mysqlTable("faceSwapJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  sourceImageUrl: text("sourceImageUrl").notNull(),
  targetVideoUrl: text("targetVideoUrl"),
  referenceVideoUrl: text("referenceVideoUrl"),
  audioUrl: text("audioUrl"),
  outputVideoUrl: text("outputVideoUrl"),
  akoolJobId: varchar("akoolJobId", { length: 255 }),
  status: mysqlEnum("status", ["pending", "queued", "processing", "completed", "failed"]).default("pending").notNull(),
  aspectRatio: mysqlEnum("aspectRatio", ["original", "9:16"]).default("original").notNull(),
  visualStyle: mysqlEnum("visualStyle", ["none", "cinematic", "vivid", "soft", "bw"]).default("none").notNull(),
  nsfwEnabled: int("nsfwEnabled").default(0).notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type FaceSwapJob = typeof faceSwapJobs.$inferSelect;
export type InsertFaceSwapJob = typeof faceSwapJobs.$inferInsert;

/**
 * Notifications table - stores email and in-app notifications
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id),
  jobId: int("jobId").notNull().references(() => faceSwapJobs.id),
  type: mysqlEnum("type", ["email", "in_app"]).notNull(),
  status: mysqlEnum("notificationStatus", ["pending", "sent", "failed"]).default("pending").notNull(),
  content: text("content").notNull(),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * User Settings table - stores user preferences
 */
export const userSettings = mysqlTable("userSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id),
  nsfwToggle: int("nsfwToggle").default(0).notNull(),
  emailNotifications: int("emailNotifications").default(1).notNull(),
  inAppNotifications: int("inAppNotifications").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;
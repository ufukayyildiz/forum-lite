import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull().unique(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    role: text("role", { enum: ["admin", "moderator", "member"] })
      .notNull()
      .default("member"),
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp" }),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
    emailSuppressedAt: integer("email_suppressed_at", { mode: "timestamp" }),
    emailSuppressionReason: text("email_suppression_reason"),
    postCount: integer("post_count").notNull().default(0),
    threadCount: integer("thread_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    usernameIdx: uniqueIndex("users_username_idx").on(t.username),
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);

export const categories = sqliteTable(
  "categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull().unique(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    color: text("color").notNull().default("#6366f1"),
    icon: text("icon").notNull().default("MessageSquare"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    slugIdx: uniqueIndex("categories_slug_idx").on(t.slug),
  }),
);

export const threads = sqliteTable(
  "threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    publicId: text("public_id").notNull().unique(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    content: text("content").notNull(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    views: integer("views").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastPostAt: integer("last_post_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    categoryIdx: index("threads_category_idx").on(t.categoryId),
    userIdx: index("threads_user_idx").on(t.userId),
    lastPostIdx: index("threads_last_post_idx").on(t.lastPostAt),
  }),
);

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    editedAt: integer("edited_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    threadIdx: index("posts_thread_idx").on(t.threadId),
    userIdx: index("posts_user_idx").on(t.userId),
  }),
);

export const likes = sqliteTable(
  "likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    uniq: uniqueIndex("likes_post_user_idx").on(t.postId, t.userId),
  }),
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    slugIdx: uniqueIndex("tags_slug_idx").on(t.slug),
  }),
);

export const threadTags = sqliteTable(
  "thread_tags",
  {
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: uniqueIndex("thread_tags_pk").on(t.threadId, t.tagId),
  }),
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    keyIdx: uniqueIndex("attachments_key_idx").on(t.key),
  }),
);

export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  summary: text("summary").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const authAttempts = sqliteTable(
  "auth_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action", { enum: ["login", "register", "reset_password"] }).notNull(),
    ip: text("ip").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    ipActionTimeIdx: index("auth_attempts_ip_action_time_idx").on(t.ip, t.action, t.createdAt),
  }),
);

export const emailSuppressions = sqliteTable(
  "email_suppressions",
  {
    email: text("email").primaryKey(),
    reason: text("reason").notNull(),
    source: text("source").notNull(),
    details: text("details"),
    cfSuppressionStatus: text("cf_suppression_status"),
    cfSuppressedAt: integer("cf_suppressed_at", { mode: "timestamp" }),
    cfSuppressionError: text("cf_suppression_error"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    createdAtIdx: index("email_suppressions_created_at_idx").on(t.createdAt),
  }),
);

export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    userId: integer("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    replyEmail: integer("reply_email", { mode: "boolean" }).notNull().default(true),
    likeEmail: integer("like_email", { mode: "boolean" }).notNull().default(true),
    marketingEmail: integer("marketing_email", { mode: "boolean" }).notNull().default(true),
    allEmail: integer("all_email", { mode: "boolean" }).notNull().default(true),
    unsubscribeToken: text("unsubscribe_token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    tokenIdx: uniqueIndex("notification_preferences_unsubscribe_token_idx").on(t.unsubscribeToken),
  }),
);

export const emailEvents = sqliteTable(
  "email_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    status: text("status").notNull(),
    relatedType: text("related_type"),
    relatedId: integer("related_id"),
    campaignKey: text("campaign_key"),
    trackingToken: text("tracking_token"),
    openedAt: integer("opened_at", { mode: "timestamp" }),
    lastOpenedAt: integer("last_opened_at", { mode: "timestamp" }),
    openCount: integer("open_count").notNull().default(0),
    clickedAt: integer("clicked_at", { mode: "timestamp" }),
    lastClickedAt: integer("last_clicked_at", { mode: "timestamp" }),
    clickCount: integer("click_count").notNull().default(0),
    message: text("message"),
    errorCode: text("error_code"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    createdAtIdx: index("email_events_created_at_idx").on(t.createdAt),
    kindIdx: index("email_events_kind_idx").on(t.kind),
    userIdx: index("email_events_user_idx").on(t.userId),
    trackingTokenIdx: uniqueIndex("email_events_tracking_token_idx").on(t.trackingToken),
  }),
);

export const marketingSends = sqliteTable(
  "marketing_sends",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    campaignKey: text("campaign_key").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    status: text("status").notNull(),
    emailEventId: integer("email_event_id").references(() => emailEvents.id, { onDelete: "set null" }),
    sentByUserId: integer("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    campaignUserIdx: index("marketing_sends_campaign_user_idx").on(t.campaignKey, t.userId),
    createdAtIdx: index("marketing_sends_created_at_idx").on(t.createdAt),
  }),
);

export const analyticsPageviews = sqliteTable(
  "analytics_pageviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    visitorId: text("visitor_id").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    routeType: text("route_type").notNull(),
    referrer: text("referrer"),
    referrerHost: text("referrer_host"),
    source: text("source").notNull().default("direct"),
    medium: text("medium").notNull().default("none"),
    campaign: text("campaign"),
    country: text("country"),
    city: text("city"),
    colo: text("colo"),
    timezone: text("timezone"),
    deviceType: text("device_type").notNull().default("desktop"),
    browser: text("browser").notNull().default("unknown"),
    os: text("os").notNull().default("unknown"),
    isRepeat: integer("is_repeat", { mode: "boolean" }).notNull().default(false),
    isBot: integer("is_bot", { mode: "boolean" }).notNull().default(false),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => ({
    createdAtIdx: index("analytics_pageviews_created_at_idx").on(t.createdAt),
    visitorCreatedAtIdx: index("analytics_pageviews_visitor_created_at_idx").on(t.visitorId, t.createdAt),
    pathCreatedAtIdx: index("analytics_pageviews_path_created_at_idx").on(t.path, t.createdAt),
    userCreatedAtIdx: index("analytics_pageviews_user_created_at_idx").on(t.userId, t.createdAt),
    sourceCreatedAtIdx: index("analytics_pageviews_source_created_at_idx").on(t.source, t.createdAt),
    countryCreatedAtIdx: index("analytics_pageviews_country_created_at_idx").on(t.country, t.createdAt),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  threads: many(threads),
  posts: many(posts),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  threads: many(threads),
}));

export const threadsRelations = relations(threads, ({ one, many }) => ({
  category: one(categories, { fields: [threads.categoryId], references: [categories.id] }),
  author: one(users, { fields: [threads.userId], references: [users.id] }),
  posts: many(posts),
  threadTags: many(threadTags),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  thread: one(threads, { fields: [posts.threadId], references: [threads.id] }),
  author: one(users, { fields: [posts.userId], references: [users.id] }),
  likes: many(likes),
}));

export const threadTagsRelations = relations(threadTags, ({ one }) => ({
  thread: one(threads, { fields: [threadTags.threadId], references: [threads.id] }),
  tag: one(tags, { fields: [threadTags.tagId], references: [tags.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  threadTags: many(threadTags),
}));

export { sql };

export type User = typeof users.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Thread = typeof threads.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type EmailSuppression = typeof emailSuppressions.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type EmailEvent = typeof emailEvents.$inferSelect;
export type MarketingSend = typeof marketingSends.$inferSelect;
export type AnalyticsPageview = typeof analyticsPageviews.$inferSelect;

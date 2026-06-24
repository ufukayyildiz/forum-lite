import type { DB } from "./db";
import type { User } from "./db/schema";
import { safeISO } from "./lib/auth";

export type Bindings = {
  DB: D1Database;
  BUCKET?: R2Bucket;
  ASSETS: Fetcher;
  SEND_EMAIL: SendEmail;
};

export type Variables = {
  db: DB;
  user: User | null;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };

export type PublicUser = {
  id: number;
  publicId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: "admin" | "moderator" | "member";
  banned: boolean;
  postCount: number;
  threadCount: number;
  createdAt: string;
};

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    publicId: u.publicId,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    role: u.role,
    banned: u.banned,
    postCount: u.postCount,
    threadCount: u.threadCount,
    createdAt: safeISO(u.createdAt),
  };
}

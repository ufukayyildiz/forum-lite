import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(env: { DB: D1Database }) {
  return drizzle(env.DB, { schema });
}

export type DB = ReturnType<typeof getDb>;
export { schema };

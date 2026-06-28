let anchorLinksSchemaReady = false;
let anchorLinksSchemaPromise: Promise<boolean> | null = null;

function isD1Backpressure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /D1_ERROR: D1 DB is overloaded|Requests queued for too long|database is locked|too many requests/i.test(message);
}

async function createOrRepairAnchorLinksSchema(db: D1Database): Promise<boolean> {
  try {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS anchor_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        term TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        click_count INTEGER NOT NULL DEFAULT 0,
        created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    ).run();

    const info = await db.prepare("PRAGMA table_info(anchor_links)").all<{ name: string }>();
    const columns = new Set((info.results ?? []).map((row) => row.name));
    const addColumn = async (name: string, statement: string) => {
      if (!columns.has(name)) {
        await db.prepare(statement).run();
        columns.add(name);
      }
    };

    await addColumn("title", "ALTER TABLE anchor_links ADD COLUMN title TEXT NOT NULL DEFAULT ''");
    await addColumn("enabled", "ALTER TABLE anchor_links ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1");
    await addColumn("click_count", "ALTER TABLE anchor_links ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0");
    await addColumn("created_by_user_id", "ALTER TABLE anchor_links ADD COLUMN created_by_user_id INTEGER");
    await addColumn("created_at", "ALTER TABLE anchor_links ADD COLUMN created_at INTEGER");
    await addColumn("updated_at", "ALTER TABLE anchor_links ADD COLUMN updated_at INTEGER");

    await db.prepare("UPDATE anchor_links SET created_at = ? WHERE created_at IS NULL").bind(now).run();
    await db.prepare("UPDATE anchor_links SET updated_at = ? WHERE updated_at IS NULL").bind(now).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS anchor_links_term_idx ON anchor_links(term)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS anchor_links_enabled_idx ON anchor_links(enabled)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS anchor_links_click_count_idx ON anchor_links(click_count)").run();
    return true;
  } catch (error) {
    if (isD1Backpressure(error)) {
      console.warn("anchor_links_schema_unavailable", error instanceof Error ? error.message : String(error));
    } else {
      console.error("anchor_links_schema_unavailable", error);
    }
    return false;
  }
}

export async function ensureAnchorLinksSchema(db: D1Database): Promise<boolean> {
  if (anchorLinksSchemaReady) return true;
  if (!anchorLinksSchemaPromise) anchorLinksSchemaPromise = createOrRepairAnchorLinksSchema(db);
  const ready = await anchorLinksSchemaPromise;
  anchorLinksSchemaPromise = null;
  anchorLinksSchemaReady = ready;
  return ready;
}

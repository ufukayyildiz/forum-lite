-- UTM columns are created/repaired idempotently by src/worker/lib/core-schema.ts.
-- Keep this migration as a no-op so databases where those columns were already
-- backfilled by runtime repair can advance past the historical ALTER statements.
SELECT 1;

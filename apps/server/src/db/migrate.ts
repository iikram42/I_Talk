import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.js';

const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending `NNN_name.sql` files in order. Each file runs in its own transaction. */
export async function migrate(db: Db, dir = defaultDir): Promise<string[]> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Serialize concurrent migrators (e.g. several instances starting at once).
      await client.query('SELECT pg_advisory_xact_lock(724_118)');
      const again = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (again.rowCount === 0) {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        ran.push(file);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}

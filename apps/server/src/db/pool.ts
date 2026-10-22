import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

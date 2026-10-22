import pg from 'pg';

/** Resets the test database schema once per run. Migrations are applied by the tests' helpers. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/parley_test';
  process.env.TEST_DATABASE_URL = url;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();
}

import { loadConfig } from '../config.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
try {
  const ran = await migrate(db);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date');
} finally {
  await db.end();
}

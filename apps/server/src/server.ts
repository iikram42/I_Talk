import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
const app = await buildApp({ config, db });

const sweeper = setInterval(() => {
  app
    .sweep()
    .catch((err: Error) => app.server.log.error({ err: err.message }, 'room maintenance failed'));
}, 60_000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.server.log.info({ signal }, 'shutting down');
  clearInterval(sweeper);
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await app.server.close();
    await db.end();
    process.exit(0);
  } catch (err) {
    app.server.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.server.listen({ host: config.HOST, port: config.PORT });

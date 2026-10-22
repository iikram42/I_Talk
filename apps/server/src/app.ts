import { randomUUID } from 'node:crypto';
import path from 'node:path';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { type ApiErrorBody, LANGUAGES } from '@parley/shared';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { AppError } from './errors.js';
import { CLOSE_CODES, RealtimeHub } from './realtime/hub.js';
import { abandonRooms, expireRooms, purgeEndedRooms } from './rooms/repository.js';
import { registerRoomRoutes } from './rooms/routes.js';
import { RoomService } from './rooms/service.js';
import type { SpeechProviders } from './translation/providers.js';
import { TranslationService } from './translation/service.js';

export interface AppOptions {
  config: Config;
  db: Db;
  /** Replaces the configured AI providers (used by tests). */
  providers?: SpeechProviders;
  logger?: boolean;
}

export interface App {
  server: FastifyInstance;
  hub: RealtimeHub;
  rooms: RoomService;
  translation: TranslationService;
  /** Runs one maintenance pass: expire, abandon and purge rooms. */
  sweep(): Promise<void>;
}

function wsOrigins(origins: string[]): string[] {
  return origins.map((o) => o.replace(/^http/, 'ws'));
}

export async function buildApp({ config, db, providers, logger = true }: AppOptions): Promise<App> {
  const server = Fastify({
    logger: logger && {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.inviteToken'],
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 16 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  const translation = TranslationService.create(config, server.log, providers);
  const hub = new RealtimeHub(translation, server.log);
  const rooms = new RoomService({
    db,
    presence: hub,
    isLanguageAvailable: (code) => translation.supports(code),
    onRoomChanged: (roomId) => {
      hub
        .publishRoom(roomId)
        .catch((err: Error) => server.log.error({ err: err.message, roomId }, 'publish failed'));
    },
  });
  hub.attach(rooms);

  server.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header(
      'permissions-policy',
      'camera=(self), microphone=(self), geolocation=(), payment=()',
    );
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", ...wsOrigins(config.PUBLIC_ORIGINS)],
        workerSrc: ["'self'", 'blob:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.NODE_ENV === 'production',
  });
  await server.register(cors, { origin: config.PUBLIC_ORIGINS, methods: ['GET', 'POST'] });
  await server.register(rateLimit, { global: false });
  await server.register(websocket, { options: { maxPayload: 256 * 1024 } });

  server.setErrorHandler((error: FastifyError | AppError | ZodError, req, reply) => {
    let status = 500;
    let body: ApiErrorBody = {
      error: { code: 'internal', message: 'Something went wrong.', requestId: req.id },
    };
    if (error instanceof AppError) {
      status = error.statusCode;
      body = { error: { code: error.code, message: error.message } };
    } else if (error instanceof ZodError) {
      status = 400;
      const issue = error.issues[0];
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      body = {
        error: { code: 'bad_request', message: `${where}${issue?.message ?? 'Invalid request'}` },
      };
    } else if ('statusCode' in error && error.statusCode === 429) {
      status = 429;
      body = {
        error: {
          code: 'rate_limited',
          message: 'Too many requests. Please wait a moment and try again.',
        },
      };
    } else if ('statusCode' in error && error.statusCode && error.statusCode < 500) {
      status = error.statusCode;
      body = { error: { code: 'bad_request', message: 'Invalid request.' } };
    } else {
      req.log.error({ err: error }, 'unhandled error');
    }
    return reply.code(status).send(body);
  });

  server.get('/api/health', async (_req, reply) => {
    let database = 'ok';
    try {
      await db.query('SELECT 1');
    } catch {
      database = 'unavailable';
    }
    const translationStatus = translation.availability();
    return reply.code(database === 'ok' ? 200 : 503).send({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      translation: { available: translationStatus.available, provider: translationStatus.provider },
    });
  });

  server.get('/api/languages', async () => ({
    languages: LANGUAGES.map((l) => ({
      code: l.code,
      name: l.name,
      nativeName: l.nativeName,
      available: translation.supports(l.code),
    })),
    translation: translation.availability(),
  }));

  registerRoomRoutes(server, { config, rooms, translation });

  server.get(
    '/ws',
    {
      websocket: true,
      config: { rateLimit: { max: config.RATE_LIMIT_JOIN_PER_MIN * 2, timeWindow: '1 minute' } },
    },
    (socket, req) => {
      const origin = req.headers.origin;
      if (!origin || !config.PUBLIC_ORIGINS.includes(origin)) {
        socket.close(CLOSE_CODES.policy, 'Origin not allowed');
        return;
      }
      hub.handle(socket);
    },
  );

  if (config.SERVE_WEB) {
    const root = path.resolve(process.cwd(), config.WEB_DIST_DIR);
    await server.register(fastifyStatic, { root, wildcard: false, maxAge: '1h', index: false });
    server.setNotFoundHandler((req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/') || req.url === '/ws') {
        return reply.code(404).send({ error: { code: 'not_found', message: 'Not found.' } });
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }

  async function sweep() {
    const ended = [
      ...(await expireRooms(db, config.MAX_ROOM_DURATION_MINUTES)),
      ...(await abandonRooms(db, hub.roomsWithPresence(), 10)),
    ];
    for (const id of ended) await hub.publishRoom(id);
    const purged = await purgeEndedRooms(db, config.ROOM_RETENTION_DAYS);
    if (ended.length || purged)
      server.log.info({ ended: ended.length, purged }, 'room maintenance');
  }

  server.addHook('onClose', async () => {
    hub.closeAll();
    await translation.close();
  });

  void translation.init();
  return { server, hub, rooms, translation, sweep };
}

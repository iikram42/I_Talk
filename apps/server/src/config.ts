import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = z.string().transform((v) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.string().url(),
    /** Public origin(s) of the web app, used for WebSocket origin checks and CORS. */
    PUBLIC_ORIGINS: csv.prefault('http://localhost:5173,http://localhost:8080'),
    TRUST_PROXY: bool.prefault('false'),
    SERVE_WEB: bool.prefault('false'),
    WEB_DIST_DIR: z.string().default('../web/dist'),

    STUN_URLS: csv.prefault('stun:stun.l.google.com:19302'),
    TURN_URLS: csv.prefault(''),
    /** Shared secret for coturn `use-auth-secret` (time-limited REST credentials). */
    TURN_SECRET: z.string().optional(),
    TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),

    /** `fake` is a deterministic test double and is rejected outside NODE_ENV=test. */
    AI_PROVIDER: z.enum(['google', 'none', 'fake']).default('google'),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    /** Service-account key JSON. Alternatively set GOOGLE_APPLICATION_CREDENTIALS to a key file path. */
    GOOGLE_CREDENTIALS_JSON: z.string().optional(),
    GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
    GOOGLE_STT_LOCATION: z.string().default('global'),
    GOOGLE_STT_MODEL: z.string().default('long'),

    RATE_LIMIT_CREATE_PER_MIN: z.coerce.number().int().min(1).default(10),
    RATE_LIMIT_JOIN_PER_MIN: z.coerce.number().int().min(1).default(30),
    MAX_ROOM_DURATION_MINUTES: z.coerce.number().int().min(5).default(240),
    ROOM_RETENTION_DAYS: z.coerce.number().int().min(0).default(7),
  })
  .superRefine((env, ctx) => {
    if (env.TURN_URLS.length > 0 && !env.TURN_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['TURN_SECRET'],
        message: 'Required when TURN_URLS is set',
      });
    }
    if (env.AI_PROVIDER === 'fake' && env.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'The fake provider is only allowed when NODE_ENV=test',
      });
    }
    if (env.AI_PROVIDER === 'google' && env.GOOGLE_CREDENTIALS_JSON) {
      try {
        JSON.parse(env.GOOGLE_CREDENTIALS_JSON);
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: ['GOOGLE_CREDENTIALS_JSON'],
          message: 'Must be valid JSON',
        });
      }
    }
  });

export type Config = z.infer<typeof envSchema>;

/**
 * On Vercel, every deployment has its own hostname, so the deployment's own URLs are trusted as
 * origins automatically, and the platform's proxy headers are trusted unless configured otherwise.
 */
function withPlatformDefaults(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.VERCEL !== '1') return env;
  const vercelOrigins = [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => `https://${host}`);
  const configured = env.PUBLIC_ORIGINS ? [env.PUBLIC_ORIGINS] : [];
  return {
    ...env,
    PUBLIC_ORIGINS: [...configured, ...vercelOrigins].join(',') || undefined,
    TRUST_PROXY: env.TRUST_PROXY ?? 'true',
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(withPlatformDefaults(env));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}

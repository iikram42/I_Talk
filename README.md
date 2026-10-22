# Parley

Private two-person voice and video calls with live, bidirectional speech translation.
Person A speaks Hindi, person B speaks Bahasa Indonesia; each hears the other through a
translated voice and sees live captions in both languages.

The product name is set in one place: `packages/shared/src/brand.ts`.

## Status

| Area                                                                | State                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Rooms, invitations, joining, capacity, expiry, revocation           | Working, tested (API + browser)                                                                     |
| WebRTC voice and video between two browsers, reconnect after reload | Working, tested in Chromium                                                                         |
| Translation pipeline (recognition → translation → speech → routing) | Working with a deterministic test provider in automated tests                                       |
| Live Google Cloud integration                                       | Implemented against verified APIs; **not yet run with real credentials** (see `npm run live-check`) |
| Docker image                                                        | Dockerfile and compose file written; **not built here** (no Docker daemon in the build environment) |
| Deployment                                                          | **Not deployed**                                                                                    |

## How it works

```
Browser A ──WebRTC (DTLS-SRTP)──────────────────────────── Browser B
  │  track 1: A's voice    track 2: A's camera    track 3: translation of A's words
  │
  └─WebSocket──► Server ──► Google Speech-to-Text (A's language, streaming)
     16 kHz PCM            └► Cloud Translation (→ B's language)
                              └► Text-to-Speech (B's language)
     ◄── synthesized clip ───┘
  A's browser plays the clip into its outgoing *translation track* (track 3),
  never into its own speakers or microphone path.
```

The same happens in the other direction at the same time.

Key decisions:

- **One server, one database.** Fastify serves the REST API, the WebSocket and (in production)
  the built frontend. PostgreSQL stores only room metadata. No Redis: a single instance keeps
  presence in memory (see _Scaling_).
- **Peer-to-peer media.** Two people need no SFU. STUN is on by default; configure TURN for
  networks where direct connections fail.
- **Translated speech travels as a third WebRTC track from the speaker's browser.** The
  listener's browser receives it as remote WebRTC audio, which its echo canceller removes from
  the microphone, the same way it removes the other person's voice. That is the main defence
  against translation feedback loops. Two more layers back it up: the server drops any
  utterance that closely matches a translation recently played to that same person
  (`LoopGuard`), and microphones run with echo cancellation, noise suppression and AGC.
- **Fixed media layout.** First audio track = voice, video = camera, second audio track =
  translation. Each side identifies tracks by transceiver order, with no extra signaling.
- **The host offers, the guest answers.** The guest says `peer-ready` once it has a fresh
  connection, and the host then offers. Offers carry a connection id so leftovers from a
  replaced connection are ignored. This makes reloads and network drops recover cleanly.
- **Partial transcripts are captions only.** Only final results are translated and spoken.
  Utterances get UUIDs and sequence numbers, are processed concurrently, and are delivered
  strictly in order. Duplicates are dropped, clips older than 12 s are discarded, and the
  player skips the oldest waiting clips if speech backs up.
- **Provider adapters.** `apps/server/src/translation/providers.ts` defines
  `SpeechToTextProvider`, `TranslationProvider` and `TextToSpeechProvider`. Only Google is
  implemented (`translation/google`). `translation/fake.ts` is a deterministic test double that
  config refuses outside `NODE_ENV=test`.

### Room lifecycle

`waiting` (host created it) → `connecting` (guest joined) → `active` (both connected) → `ended`.
End reasons: `ended`, `cancelled` (host left before anyone joined), `expired` (not joined in
time, or ran past `MAX_ROOM_DURATION_MINUTES`), `abandoned` (both gone for 10 minutes). A
sweeper runs every minute.

### Security model

- Room ids are 128-bit random; invitation and participant tokens are 256-bit random and stored
  only as SHA-256 hashes.
- The invitation secret is in the URL **fragment** (`/join/<room>#<token>`), so it is never sent
  to the server in requests, logs or `Referer` headers; the join page removes it from the
  address bar once read.
- Every room operation is authorized on the server with the participant token
  (`Authorization: Bearer`, or the first WebSocket message). Unknown rooms and wrong tokens get
  identical responses, so ids cannot be enumerated.
- The two-person limit is enforced by a row lock plus a `UNIQUE (room_id, role)` constraint;
  12 concurrent joins produce exactly one guest (tested).
- WebSocket origin checks, per-connection message and audio budgets, heartbeats, payload limits.
- Rate limits on room creation, invitation preview/join, session lookup and WebSocket upgrades.
- Helmet security headers with a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`),
  `Permissions-Policy` limiting camera/microphone to the app, HSTS in production, no source maps.
- Secrets live only in server environment variables; auth headers are redacted from logs.

See [PRIVACY.md](PRIVACY.md) for data handling, retention and what is _not_ end-to-end encrypted.

## Project layout

```
apps/server     Fastify API, WebSocket hub, room service, translation pipeline, migrations
  src/rooms         routes → service (business rules) → repository (SQL)
  src/realtime      WebSocket hub: presence, signaling relay, per-direction pipelines
  src/translation   provider interfaces, Google adapter, pipeline, loop guard
  scripts/live-check.ts   real-provider check with latency measurements
apps/web        React + Vite + Tailwind frontend
  src/pages         home, create, join, room
  src/call          signaling socket, PeerCall (WebRTC), mic streamer, translation player
packages/shared Language list, request schemas (zod), API and WebSocket message types
e2e             Playwright tests (two real browser sessions with fake media devices)
```

## Requirements

- Node.js 22+, npm 10+
- PostgreSQL 14+ (16 recommended)
- For translation: a Google Cloud project with **Speech-to-Text**, **Cloud Translation** and
  **Text-to-Speech** APIs enabled, and a service account allowed to use them
- HTTPS in any non-localhost deployment (browsers only allow microphone/camera on secure origins)

## Setup

```bash
npm ci
cp .env.example .env            # then edit DATABASE_URL and the Google settings
createdb parley                 # or use docker compose's db service
npm run migrate                 # applies apps/server/src/db/migrations/*.sql
npm run dev                     # API on :8080, web app on http://localhost:5173
```

Migrations are plain SQL files applied in order and recorded in `schema_migrations`; the server
also applies pending migrations at startup. In production: `node apps/server/dist/migrate.js`.

### Environment variables

All variables are validated at startup (`apps/server/src/config.ts`); the process exits with a
clear message if something is wrong. See `.env.example` for every option.

| Variable                                                           | Required            | Purpose                                                                             |
| ------------------------------------------------------------------ | ------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                     | yes                 | PostgreSQL connection string                                                        |
| `PUBLIC_ORIGINS`                                                   | yes in prod         | Comma-separated origins allowed for WebSocket/CORS, e.g. `https://talk.example.com` |
| `AI_PROVIDER`                                                      |                     | `google` (default) or `none`                                                        |
| `GOOGLE_CLOUD_PROJECT`                                             | for translation     | Project id                                                                          |
| `GOOGLE_CREDENTIALS_JSON`                                          | for translation     | Service-account key JSON (or set `GOOGLE_APPLICATION_CREDENTIALS` to a key file)    |
| `GOOGLE_STT_LOCATION` / `GOOGLE_STT_MODEL`                         |                     | Defaults `global` / `long` (both support hi-IN and id-ID streaming)                 |
| `STUN_URLS`                                                        |                     | Default Google STUN                                                                 |
| `TURN_URLS`, `TURN_SECRET`                                         | recommended in prod | TURN relay and its shared secret                                                    |
| `TRUST_PROXY`                                                      | behind a proxy      | Use client IPs from `X-Forwarded-For` for rate limiting                             |
| `SERVE_WEB`                                                        | prod                | Serve `apps/web/dist` from the API server                                           |
| `RATE_LIMIT_*`, `MAX_ROOM_DURATION_MINUTES`, `ROOM_RETENTION_DAYS` |                     | Limits and retention                                                                |

Without Google credentials the app still runs: calls connect, and the UI says translation is
unavailable.

## AI provider setup (Google Cloud)

1. Create or pick a project and enable billing.
2. Enable the APIs: `speech.googleapis.com`, `translate.googleapis.com`, `texttospeech.googleapis.com`.
3. Create a service account with the roles **Cloud Speech Client** (`roles/speech.client`) and
   **Cloud Translation API User** (`roles/cloudtranslate.user`), then create a JSON key. If
   Text-to-Speech returns a permission error, also grant **Service Usage Consumer**.
4. Set `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CREDENTIALS_JSON` (the key on one line) on the server.
5. Verify with real audio, in both directions, with latency numbers:

```bash
npm run live-check -w @parley/server              # hi-IN ↔ id-ID
npm run live-check -w @parley/server -- en-US es-ES
```

At startup the server asks the provider which translation languages and voices the account
can use and hides any language it cannot serve. Languages offered (all verified in Google's
docs for `long`-model streaming recognition, translation and the named voice): Hindi,
Indonesian, English (US), Spanish, French, German, Portuguese (Brazil), Japanese, Korean,
Vietnamese, Tamil, Turkish. Add more in `packages/shared/src/languages.ts`.

Speech-to-Text streams are limited to about five minutes by Google; the pipeline rotates
streams every four minutes without dropping speech.

## TURN / STUN

STUN alone works for most home networks. Corporate networks, some mobile carriers and
symmetric NATs need a TURN relay. With [coturn](https://github.com/coturn/coturn):

```bash
TURN_SECRET=$(openssl rand -hex 32) docker compose --profile turn up turn
```

then set `TURN_URLS=turn:your-host:3478?transport=udp,turn:your-host:3478?transport=tcp` and
the same `TURN_SECRET` on the app. The server hands each participant short-lived credentials
(coturn `use-auth-secret` scheme, `TURN_CREDENTIAL_TTL_SECONDS`). For production also expose
`turns:` on 5349 with a TLS certificate and open the relay port range on the firewall.

## Tests

```bash
npm run lint && npm run typecheck && npm run format:check
npm test              # unit + integration (server tests need PostgreSQL; TEST_DATABASE_URL, default postgres://postgres@localhost:5432/parley_test)
npm run build
npm run test:e2e      # Playwright; needs the build and a migrated E2E_DATABASE_URL (default parley_e2e)
```

- **Server (39 tests):** room creation/validation, invitation preview, wrong token vs unknown
  room indistinguishable, capacity under 12 concurrent joins, expiry, revocation (host only),
  session authorization, end reasons, sweeper and retention purge, rate limiting, unsupported
  languages, database outage (safe 500/503), security headers; WebSocket origin check, auth
  failures, signaling and media-state relay, room-ended broadcast, duplicate-tab replacement,
  both translation directions with audio routed only to the speaker, playback relay, pausing;
  pipeline ordering, partial vs final, duplicates, echo/loop protection, provider failure and
  recovery, timeouts, stale audio, same-language bypass, latency measurement, stream rotation,
  error cool-down.
- **Web (18 tests):** home page states, call-type selection, searchable keyboard language
  picker, room creation request and token storage, unavailable languages, error display,
  invitation errors, guest join flow, call controls, transcript merging, translation player
  queueing/skipping.
- **End-to-end (5 tests, Chromium with fake camera/microphone):** voice and video calls from
  room creation through clipboard copy, guest join, WebRTC connection with measured audio (and
  video frames), translated captions in both directions, audio present on the dedicated
  translation track, mute/unmute seen by the peer, camera toggle, third person rejected, end
  call for both; invalid, revoked and expired links; host cancel; reload of guest then host with
  media recovery.

Automated tests use the fake provider, so they prove routing and UI, **not translation
quality**. Real quality needs two people, real microphones and Google credentials.

## Production build and deployment

```bash
npm ci && npm run build
NODE_ENV=production SERVE_WEB=true PUBLIC_ORIGINS=https://talk.example.com \
DATABASE_URL=... GOOGLE_CLOUD_PROJECT=... GOOGLE_CREDENTIALS_JSON='...' \
node apps/server/dist/server.js
```

Or with Docker: `docker build -t parley .` and run with the same variables (the image serves
the web app, applies migrations at startup and has a health check on `/api/health`).
`docker compose up` runs the app with PostgreSQL locally.

Put it behind an HTTPS reverse proxy (Caddy, nginx, a cloud load balancer) that forwards
WebSocket upgrades on `/ws`, and set `TRUST_PROXY=true`. The server shuts down gracefully on
SIGTERM (closes sockets and the database pool).

### Vercel (multi-service project)

`vercel.json` defines two [services](https://vercel.com/docs/services):

| Service  | Built from                                          | Public paths       |
| -------- | --------------------------------------------------- | ------------------ |
| `server` | `apps/server/Dockerfile.vercel` (container runtime) | `/api/*` and `/ws` |
| `web`    | `apps/web` (Vite static build, SPA fallback)        | everything else    |

The browser calls the API and the WebSocket on its own origin, so neither service calls the
other server-side and no service bindings are needed. Project environment variables to set:

- `DATABASE_URL`: an external PostgreSQL (for example Neon from the Vercel Marketplace).
- `PORT=8080`: the port the container listens on (Vercel's default is 80).
- `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CREDENTIALS_JSON`.
- `PUBLIC_ORIGINS` only for a custom domain. The deployment's own `*.vercel.app` URLs are
  trusted automatically (from `VERCEL_URL`, `VERCEL_BRANCH_URL` and
  `VERCEL_PROJECT_PRODUCTION_URL`), and `TRUST_PROXY` defaults to `true` on Vercel.

Caveats: Vercel runs the container as an autoscaling function, so see _Scaling_ below. A
WebSocket also closes when the function reaches its maximum duration; the client reconnects
and resumes the call automatically. Local testing with `vercel dev` needs Docker for the
`server` service.

### Scaling

Presence and the translation pipelines live in the server process, so run **one instance**
(it can handle many concurrent rooms; Google calls are the bottleneck). To run several, route
both participants of a room to the same instance (sticky by room id) or move presence and
signaling to Redis pub/sub.

## Known limitations

- Live Google integration and Hindi ↔ Indonesian quality are **unverified** until
  `npm run live-check` and a real two-person call are run with credentials.
- Real end-to-end latency has not been measured yet (only the fake provider has run).
  `live-check` prints real numbers, and the server logs `recognitionMs`, `translationMs`,
  `synthesisMs` and `totalMs` for every utterance.
- Translation is sentence-by-sentence; it waits for the recognizer to finalize each utterance.
- Echo cancellation quality varies by browser and device; headphones give the best results.
- Only tested in Chromium. Safari and Firefox use the same standard APIs but have not been run.
- Single-instance presence (see _Scaling_). No accounts; rooms are guest-only.
- Speaker selection (`setSinkId`) is only offered where the browser supports it.

## Future improvements

1. Run `live-check` and a real Hindi ↔ Indonesian call; tune voices, speaking rate and endpointing.
2. Stream partial translations into captions (text only) for faster feedback.
3. Use streaming TTS (Chirp 3 HD voices support it) to start speaking sooner.
4. Redis-backed presence for multiple instances; Prometheus metrics for latency percentiles.
5. Cross-browser end-to-end runs (WebKit, Firefox) and a TURN-only connectivity test.
6. Optional accounts and call history (opt-in, with explicit retention settings).

CREATE TABLE rooms (
  id                            text PRIMARY KEY,
  call_type                     text NOT NULL CHECK (call_type IN ('voice', 'video')),
  title                         text,
  status                        text NOT NULL CHECK (status IN ('waiting', 'connecting', 'active', 'ended')),
  end_reason                    text CHECK (end_reason IN ('ended', 'cancelled', 'expired', 'abandoned')),
  invite_token_hash             text NOT NULL,
  invite_revoked_at             timestamptz,
  expected_guest_language       text NOT NULL,
  expected_guest_output_language text NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  expires_at                    timestamptz NOT NULL,
  started_at                    timestamptz,
  ended_at                      timestamptz,
  CHECK ((status = 'ended') = (ended_at IS NOT NULL))
);

CREATE INDEX rooms_open_expiry_idx ON rooms (expires_at) WHERE status <> 'ended';
CREATE INDEX rooms_ended_at_idx ON rooms (ended_at) WHERE status = 'ended';

CREATE TABLE room_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         text NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('host', 'guest')),
  display_name    text NOT NULL,
  spoken_language text NOT NULL,
  output_language text NOT NULL,
  token_hash      text NOT NULL UNIQUE,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  -- One host and at most one guest per room, enforced by the database even under concurrent joins.
  UNIQUE (room_id, role)
);

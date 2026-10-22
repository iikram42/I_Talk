import type { CallType, EndReason, ParticipantRole, RoomStatus } from '@parley/shared';
import type { DbClient } from '../db/pool.js';

export interface RoomRow {
  id: string;
  call_type: CallType;
  title: string | null;
  status: RoomStatus;
  end_reason: EndReason | null;
  invite_token_hash: string;
  invite_revoked_at: Date | null;
  expected_guest_language: string;
  expected_guest_output_language: string;
  created_at: Date;
  expires_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
}

export interface ParticipantRow {
  id: string;
  room_id: string;
  role: ParticipantRole;
  display_name: string;
  spoken_language: string;
  output_language: string;
  token_hash: string;
  joined_at: Date;
  last_seen_at: Date;
}

export type NewRoom = Pick<
  RoomRow,
  'id' | 'call_type' | 'title' | 'invite_token_hash' | 'expected_guest_language' | 'expected_guest_output_language' | 'expires_at'
>;
export type NewParticipant = Pick<
  ParticipantRow,
  'room_id' | 'role' | 'display_name' | 'spoken_language' | 'output_language' | 'token_hash'
>;

export async function insertRoom(db: DbClient, room: NewRoom): Promise<RoomRow> {
  const { rows } = await db.query<RoomRow>(
    `INSERT INTO rooms (id, call_type, title, status, invite_token_hash, expected_guest_language,
                        expected_guest_output_language, expires_at)
     VALUES ($1, $2, $3, 'waiting', $4, $5, $6, $7) RETURNING *`,
    [room.id, room.call_type, room.title, room.invite_token_hash, room.expected_guest_language,
      room.expected_guest_output_language, room.expires_at],
  );
  return rows[0]!;
}

export async function insertParticipant(db: DbClient, p: NewParticipant): Promise<ParticipantRow> {
  const { rows } = await db.query<ParticipantRow>(
    `INSERT INTO room_participants (room_id, role, display_name, spoken_language, output_language, token_hash)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [p.room_id, p.role, p.display_name, p.spoken_language, p.output_language, p.token_hash],
  );
  return rows[0]!;
}

export async function findRoom(db: DbClient, id: string, forUpdate = false): Promise<RoomRow | undefined> {
  const { rows } = await db.query<RoomRow>(
    `SELECT * FROM rooms WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return rows[0];
}

export async function listParticipants(db: DbClient, roomId: string): Promise<ParticipantRow[]> {
  const { rows } = await db.query<ParticipantRow>(
    `SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at`,
    [roomId],
  );
  return rows;
}

export async function findParticipantByToken(
  db: DbClient,
  roomId: string,
  tokenHash: string,
): Promise<ParticipantRow | undefined> {
  const { rows } = await db.query<ParticipantRow>(
    `SELECT * FROM room_participants WHERE room_id = $1 AND token_hash = $2`,
    [roomId, tokenHash],
  );
  return rows[0];
}

export async function setRoomStatus(
  db: DbClient,
  id: string,
  status: RoomStatus,
  endReason: EndReason | null = null,
): Promise<RoomRow | undefined> {
  const { rows } = await db.query<RoomRow>(
    `UPDATE rooms
        SET status = $2,
            end_reason = COALESCE($3, end_reason),
            started_at = CASE WHEN $2 = 'active' AND started_at IS NULL THEN now() ELSE started_at END,
            ended_at = CASE WHEN $2 = 'ended' THEN COALESCE(ended_at, now()) ELSE ended_at END
      WHERE id = $1 AND status <> 'ended'
      RETURNING *`,
    [id, status, endReason],
  );
  return rows[0];
}

export async function revokeInvite(db: DbClient, id: string): Promise<void> {
  await db.query(`UPDATE rooms SET invite_revoked_at = COALESCE(invite_revoked_at, now()) WHERE id = $1`, [id]);
}

export async function touchParticipant(db: DbClient, id: string): Promise<void> {
  await db.query(`UPDATE room_participants SET last_seen_at = now() WHERE id = $1`, [id]);
}

/** Ends rooms nobody joined before expiry, and calls that ran past the maximum duration. */
export async function expireRooms(db: DbClient, maxDurationMinutes: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE rooms SET status = 'ended', end_reason = 'expired', ended_at = now()
      WHERE status <> 'ended'
        AND ((status IN ('waiting', 'connecting') AND expires_at <= now())
          OR created_at <= now() - make_interval(mins => $1))
      RETURNING id`,
    [maxDurationMinutes],
  );
  return rows.map((r) => r.id);
}

/** Ends active calls where nobody has been seen for `idleMinutes` (both sides gone). */
export async function abandonRooms(db: DbClient, roomIdsWithPresence: string[], idleMinutes: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE rooms r SET status = 'ended', end_reason = 'abandoned', ended_at = now()
      WHERE r.status = 'active'
        AND NOT (r.id = ANY($1::text[]))
        AND NOT EXISTS (
          SELECT 1 FROM room_participants p
           WHERE p.room_id = r.id AND p.last_seen_at > now() - make_interval(mins => $2))
      RETURNING r.id`,
    [roomIdsWithPresence, idleMinutes],
  );
  return rows.map((r) => r.id);
}

/** Deletes ended rooms (and, via cascade, their participants) after the retention period. */
export async function purgeEndedRooms(db: DbClient, retentionDays: number): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM rooms WHERE status = 'ended' AND ended_at <= now() - make_interval(days => $1)`,
    [retentionDays],
  );
  return rowCount ?? 0;
}

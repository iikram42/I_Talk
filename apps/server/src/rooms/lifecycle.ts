import type { RoomStatus } from '@parley/shared';

/** Allowed room status transitions. `ended` is terminal. */
const TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  waiting: ['connecting', 'ended'],
  connecting: ['active', 'ended'],
  active: ['ended'],
  ended: [],
};

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/**
 * Derives the status a room should have from who has joined and who is connected right now.
 * Once a call has been `active` it stays active while participants reconnect.
 */
export function nextStatus(current: RoomStatus, guestJoined: boolean, connectedCount: number): RoomStatus {
  let status = current;
  if (status === 'waiting' && guestJoined) status = 'connecting';
  if (status === 'connecting' && connectedCount >= 2) status = 'active';
  return status;
}

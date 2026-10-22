/**
 * Per-tab storage for room credentials. sessionStorage keeps a call alive across reloads in the
 * same tab without sharing the session with other tabs or persisting it after the tab closes.
 */
interface StoredRoom {
  participantToken: string;
  inviteToken?: string;
}

const key = (roomId: string) => `parley:room:${roomId}`;

export function saveRoomSession(roomId: string, value: StoredRoom): void {
  try {
    sessionStorage.setItem(key(roomId), JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the call still works until the tab reloads.
    memory.set(roomId, value);
  }
}

const memory = new Map<string, StoredRoom>();

export function loadRoomSession(roomId: string): StoredRoom | null {
  try {
    const raw = sessionStorage.getItem(key(roomId));
    if (raw) return JSON.parse(raw) as StoredRoom;
  } catch {
    // Fall through to the in-memory copy.
  }
  return memory.get(roomId) ?? null;
}

export function clearRoomSession(roomId: string): void {
  memory.delete(roomId);
  try {
    sessionStorage.removeItem(key(roomId));
  } catch {
    // Nothing to clear.
  }
}

export function inviteUrl(roomId: string, inviteToken: string): string {
  // The secret lives in the fragment, which browsers never send to the server or in Referer headers.
  return `${window.location.origin}/join/${roomId}#${inviteToken}`;
}

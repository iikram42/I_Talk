import type {
  ApiErrorBody,
  CreateRoomRequest,
  CreateRoomResponse,
  ErrorCode,
  InvitePreviewResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  LanguagesResponse,
  RoomView,
  SessionResponse,
} from '@parley/shared';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | 'network',
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(
      'network',
      'Could not reach the server. Check your connection and try again.',
      0,
    );
  }
  const body = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      err?.code ?? 'internal',
      err?.message ?? 'Something went wrong.',
      res.status,
    );
  }
  return body as T;
}

export const api = {
  languages: () => request<LanguagesResponse>('/api/languages'),
  createRoom: (input: CreateRoomRequest) =>
    request<CreateRoomResponse>('/api/rooms', { method: 'POST', body: JSON.stringify(input) }),
  previewInvite: (roomId: string, inviteToken: string) =>
    request<InvitePreviewResponse>(`/api/rooms/${encodeURIComponent(roomId)}/preview`, {
      method: 'POST',
      body: JSON.stringify({ inviteToken }),
    }),
  joinRoom: (roomId: string, input: JoinRoomRequest) =>
    request<JoinRoomResponse>(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  session: (roomId: string, token: string) =>
    request<SessionResponse>(`/api/rooms/${encodeURIComponent(roomId)}/session`, { token }),
  endRoom: (roomId: string, token: string) =>
    request<{ room: RoomView }>(`/api/rooms/${encodeURIComponent(roomId)}/end`, {
      method: 'POST',
      token,
    }),
  revokeInvite: (roomId: string, token: string) =>
    request<{ room: RoomView }>(`/api/rooms/${encodeURIComponent(roomId)}/invite/revoke`, {
      method: 'POST',
      token,
    }),
};

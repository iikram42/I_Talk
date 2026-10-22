import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateRoomPage } from '../src/pages/CreateRoomPage';
import { HomePage } from '../src/pages/HomePage';
import { JoinRoomPage } from '../src/pages/JoinRoomPage';
import { languagesBody, mockFetch, renderAt } from './utils';

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  window.location.hash = '';
});

describe('HomePage', () => {
  it('shows call buttons, languages and the translation disclaimer', async () => {
    mockFetch((url) => (url === '/api/languages' ? { body: languagesBody(['tr-TR']) } : undefined));
    renderAt('/', [{ path: '/', element: <HomePage /> }]);
    expect(screen.getByRole('button', { name: 'Start a Voice Call' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start a Video Call' })).toBeEnabled();
    expect(screen.getByText(/Translation is not instantaneous/)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Supported languages' });
    expect(within(list).getByText('हिन्दी')).toBeInTheDocument();
    expect(within(list).getByText('Bahasa Indonesia')).toBeInTheDocument();
    expect(within(list).getByTitle(/tr-TR is not available/)).toBeInTheDocument();
  });

  it('offers a retry when languages fail to load', async () => {
    let calls = 0;
    mockFetch(() =>
      ++calls === 1
        ? { status: 500, body: { error: { code: 'internal', message: 'Boom' } } }
        : { body: languagesBody() },
    );
    renderAt('/', [{ path: '/', element: <HomePage /> }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Supported languages' })).toBeInTheDocument();
  });

  it('warns when live translation is unavailable', async () => {
    mockFetch(() => ({ body: languagesBody([], false) }));
    renderAt('/', [{ path: '/', element: <HomePage /> }]);
    expect(
      await screen.findByText('Live translation is currently unavailable'),
    ).toBeInTheDocument();
  });

  it('navigates to room creation with the chosen call type', async () => {
    mockFetch(() => ({ body: languagesBody() }));
    renderAt('/', [
      { path: '/', element: <HomePage /> },
      { path: '/new', element: <CreateRoomPage /> },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Start a Video Call' }));
    expect(await screen.findByRole('heading', { name: 'Create a room' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Video call/ })).toBeChecked();
  });
});

describe('CreateRoomPage', () => {
  it('creates a Hindi ↔ Indonesian room with one action and stores the tokens', async () => {
    const fetch = mockFetch((url, init) => {
      if (url === '/api/languages') return { body: languagesBody() };
      if (url === '/api/rooms' && init?.method === 'POST') {
        return {
          status: 201,
          body: {
            room: { id: 'R'.repeat(22) },
            participantToken: 'p'.repeat(43),
            inviteToken: 'i'.repeat(43),
          },
        };
      }
      return undefined;
    });
    renderAt('/new?type=voice', [
      { path: '/new', element: <CreateRoomPage /> },
      { path: '/room/:id', element: <p>room page</p> },
    ]);
    await screen.findByRole('heading', { name: 'Create a room' });
    expect(screen.getByLabelText('I speak')).toHaveValue('Hindi · हिन्दी');
    expect(screen.getByLabelText('They speak')).toHaveValue('Indonesian · Bahasa Indonesia');
    await userEvent.type(screen.getByLabelText('Your name (optional)'), 'Asha');
    await userEvent.click(screen.getByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('room page')).toBeInTheDocument();
    const body = JSON.parse(fetch.mock.calls.find(([u]) => u === '/api/rooms')![1]!.body as string);
    expect(body).toEqual({
      callType: 'voice',
      hostLanguage: 'hi-IN',
      hostOutputLanguage: 'hi-IN',
      guestLanguage: 'id-ID',
      guestOutputLanguage: 'id-ID',
      hostName: 'Asha',
      expiresInMinutes: 60,
    });
    expect(JSON.parse(sessionStorage.getItem(`parley:room:${'R'.repeat(22)}`)!)).toEqual({
      participantToken: 'p'.repeat(43),
      inviteToken: 'i'.repeat(43),
    });
  });

  it('lets the user search and pick languages with the keyboard, and output follows spoken language', async () => {
    mockFetch(() => ({ body: languagesBody() }));
    renderAt('/new', [{ path: '/new', element: <CreateRoomPage /> }]);
    const input = await screen.findByLabelText('I speak');
    await userEvent.click(input);
    await userEvent.type(input, 'engl');
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['English (US) · Englishen-US']);
    await userEvent.keyboard('{Enter}');
    expect(input).toHaveValue('English (US) · English');
    expect(screen.getByLabelText('I want to hear')).toHaveValue('English (US) · English');
    await userEvent.click(input);
    await userEvent.type(input, 'zzz');
    expect(screen.getByText('No matching languages')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('English (US) · English');
  });

  it('blocks languages the server cannot serve', async () => {
    mockFetch(() => ({ body: languagesBody(['id-ID']) }));
    renderAt('/new', [{ path: '/new', element: <CreateRoomPage /> }]);
    expect(await screen.findByText(/Not available on this server: Indonesian/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeDisabled();
  });

  it('shows the server error when creation fails', async () => {
    mockFetch((url) =>
      url === '/api/languages'
        ? { body: languagesBody() }
        : { status: 429, body: { error: { code: 'rate_limited', message: 'Too many requests.' } } },
    );
    renderAt('/new', [{ path: '/new', element: <CreateRoomPage /> }]);
    await userEvent.click(await screen.findByRole('button', { name: 'Create room' }));
    expect(await screen.findByText('Too many requests.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create room' })).toBeEnabled();
  });
});

describe('JoinRoomPage', () => {
  const roomId = 'R'.repeat(22);
  const token = 't'.repeat(43);
  const preview = {
    room: {
      id: roomId,
      callType: 'video',
      title: 'Family call',
      expiresAt: new Date().toISOString(),
      expectedGuestLanguage: 'id-ID',
      expectedGuestOutputLanguage: 'id-ID',
    },
    host: { displayName: 'Asha', spokenLanguage: 'hi-IN', outputLanguage: 'hi-IN' },
  };

  it('rejects a link without a token', () => {
    mockFetch(() => ({ body: languagesBody() }));
    renderAt(`/join/${roomId}`, [{ path: '/join/:roomId', element: <JoinRoomPage /> }]);
    expect(screen.getByRole('heading', { name: 'This link isn’t valid' })).toBeInTheDocument();
  });

  it.each([
    ['invite_expired', 'This invitation has expired'],
    ['invite_revoked', 'This invitation was revoked'],
    ['room_full', 'This call is full'],
  ])('explains %s', async (code, heading) => {
    window.location.hash = token;
    mockFetch((url) =>
      url === '/api/languages'
        ? { body: languagesBody() }
        : { status: 410, body: { error: { code, message: 'x' } } },
    );
    renderAt(`/join/${roomId}`, [{ path: '/join/:roomId', element: <JoinRoomPage /> }]);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('shows the invitation, requires a name, and joins', async () => {
    window.location.hash = token;
    const fetch = mockFetch((url) => {
      if (url === '/api/languages') return { body: languagesBody() };
      if (url.endsWith('/preview')) return { body: preview };
      if (url.endsWith('/join'))
        return { status: 201, body: { room: preview.room, participantToken: 'g'.repeat(43) } };
      return undefined;
    });
    renderAt(`/join/${roomId}`, [
      { path: '/join/:roomId', element: <JoinRoomPage /> },
      { path: '/room/:id', element: <p>room page</p> },
    ]);
    expect(
      await screen.findByRole('heading', { name: 'Asha invited you to a video call' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Hindi')).toBeInTheDocument();
    expect(screen.getByText(/camera and microphone access/)).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(screen.getByText('Enter the name the host will see')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Your name'), 'Budi');
    await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    await waitFor(() => expect(screen.getByText('room page')).toBeInTheDocument());
    const joinCall = fetch.mock.calls.find(([u]) => String(u).endsWith('/join'))!;
    expect(JSON.parse(joinCall[1]!.body as string)).toEqual({
      inviteToken: token,
      displayName: 'Budi',
      spokenLanguage: 'id-ID',
      outputLanguage: 'id-ID',
    });
  });
});

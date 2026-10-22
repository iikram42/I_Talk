import type { ClientMessage, ServerMessage } from '@parley/shared';

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Close codes the server uses when reconnecting would not help. */
const FATAL_CLOSE_CODES = new Set([4401, 4409, 4410, 4408]);

/**
 * The room's WebSocket: authenticates with the participant token, relays signaling and
 * translation messages, and reconnects with backoff after network drops.
 */
export class RoomSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private disposed = false;
  status: SocketStatus = 'connecting';

  constructor(
    private readonly roomId: string,
    private readonly token: string,
    private readonly handlers: {
      onMessage: (msg: ServerMessage) => void;
      onStatus: (status: SocketStatus, closeCode?: number) => void;
    },
    private readonly url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  ) {
    this.connect();
  }

  private setStatus(status: SocketStatus, code?: number) {
    this.status = status;
    this.handlers.onStatus(status, code);
  }

  private connect() {
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'auth',
          roomId: this.roomId,
          token: this.token,
        } satisfies ClientMessage),
      );
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), 20_000);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        this.attempts = 0;
        this.setStatus('open');
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = (event) => {
      window.clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.disposed || FATAL_CLOSE_CODES.has(event.code)) {
        this.setStatus('closed', event.code);
        return;
      }
      this.setStatus('reconnecting', event.code);
      const delay = Math.min(10_000, 500 * 2 ** this.attempts) * (0.75 + Math.random() * 0.5);
      this.attempts += 1;
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  get isOpen(): boolean {
    return this.status === 'open' && this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendAudio(pcm: ArrayBuffer): void {
    // Drop audio rather than queue it when the socket is backed up; stale speech is not useful.
    if (this.isOpen && this.ws!.bufferedAmount < 64_000) this.ws!.send(pcm);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close(1000, 'Left');
    this.ws = null;
  }
}

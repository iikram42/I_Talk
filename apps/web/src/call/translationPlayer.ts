export interface TranslatedClip {
  utteranceId: string;
  audio: ArrayBuffer;
  /** When the clip arrived, used to drop clips that waited too long behind others. */
  receivedAt: number;
}

export type PlaybackState = 'started' | 'ended' | 'skipped';

const MAX_PENDING = 2;
const MAX_WAIT_MS = 8_000;
const GAP_MS = 250;

/**
 * Plays synthesized translations into a dedicated outgoing WebRTC track (never the local
 * speakers and never the microphone path). The other participant receives it as a separate
 * audio track, which their browser's echo canceller treats as far-end audio.
 */
export class TranslationPlayer {
  readonly destination: MediaStreamAudioDestinationNode;
  private queue: TranslatedClip[] = [];
  private playing: AudioBufferSourceNode | null = null;
  private playingId: string | null = null;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    private readonly onPlayback: (utteranceId: string, state: PlaybackState) => void,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.destination = context.createMediaStreamDestination();
  }

  get track(): MediaStreamTrack {
    return this.destination.stream.getAudioTracks()[0]!;
  }

  get busy(): boolean {
    return this.playing !== null;
  }

  enqueue(clip: TranslatedClip): void {
    if (this.disposed) return;
    this.queue.push(clip);
    // If speech is arriving faster than it can be spoken, skip the oldest waiting clips.
    while (this.queue.length > MAX_PENDING) this.onPlayback(this.queue.shift()!.utteranceId, 'skipped');
    if (!this.playing) void this.playNext();
  }

  private async playNext(): Promise<void> {
    const clip = this.queue.shift();
    if (!clip || this.disposed) return;
    if (this.now() - clip.receivedAt > MAX_WAIT_MS) {
      this.onPlayback(clip.utteranceId, 'skipped');
      return this.playNext();
    }
    let buffer: AudioBuffer;
    try {
      buffer = await this.context.decodeAudioData(clip.audio.slice(0));
    } catch {
      this.onPlayback(clip.utteranceId, 'skipped');
      return this.playNext();
    }
    if (this.disposed) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    this.playing = source;
    this.playingId = clip.utteranceId;
    source.onended = () => {
      source.disconnect();
      if (this.playing === source) this.playing = null;
      this.onPlayback(clip.utteranceId, 'ended');
      window.setTimeout(() => {
        if (!this.playing) void this.playNext();
      }, GAP_MS);
    };
    this.onPlayback(clip.utteranceId, 'started');
    source.start();
  }

  /** Stops current playback and drops everything queued (e.g. the user paused translation). */
  clear(): void {
    for (const clip of this.queue) this.onPlayback(clip.utteranceId, 'skipped');
    this.queue = [];
    if (this.playing) {
      this.playing.onended = null;
      this.playing.stop();
      this.playing.disconnect();
      this.playing = null;
      if (this.playingId) this.onPlayback(this.playingId, 'skipped');
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.track.stop();
  }
}

import type { CallType, IceServerConfig, RTCIceCandidateLike } from '@parley/shared';

export interface LocalTracks {
  mic: MediaStreamTrack;
  micStream: MediaStream;
  video: MediaStreamTrack | null;
  translation: MediaStreamTrack;
  translationStream: MediaStream;
}

export interface RemoteMedia {
  /** The other person's own voice and camera. */
  original: MediaStream;
  /** Synthesized translation of what the other person said, in our language. */
  translation: MediaStream;
}

export type ConnectionQuality = 'good' | 'fair' | 'poor' | 'unknown';

export interface PeerSignal {
  connectionId?: string;
  description?: { type: 'offer' | 'answer'; sdp: string };
  candidate?: RTCIceCandidateLike;
}

interface Options {
  iceServers: IceServerConfig[];
  /**
   * The host always makes offers and the guest only answers, which avoids offer collisions.
   * The guest sends `peer-ready` for each new connection so the host can offer again (see useCall).
   */
  isOfferer: boolean;
  callType: CallType;
  local: LocalTracks;
  sendSignal: (signal: PeerSignal) => void;
  onRemoteMedia: (media: RemoteMedia) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onQuality: (quality: ConnectionQuality) => void;
}

/**
 * One WebRTC connection to the other participant. Media layout is fixed so each side can tell
 * the tracks apart without extra signaling: first audio = voice, video = camera,
 * second audio = translated speech.
 */
export class PeerCall {
  private pc: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remote: RemoteMedia = { original: new MediaStream(), translation: new MediaStream() };
  private statsTimer: number | undefined;
  private disconnectTimer: number | undefined;
  private closed = false;
  private lastStats: { lost: number; received: number } | null = null;
  /** The host's id for this connection; the guest echoes the id of the offer it answers. */
  private readonly id = crypto.randomUUID();
  private remoteId: string | null = null;

  constructor(private readonly opts: Options) {
    this.pc = this.create();
    if (opts.isOfferer) this.addOffererTransceivers();
    this.statsTimer = window.setInterval(() => void this.measure(), 2_000);
  }

  private signal(signal: PeerSignal) {
    const connectionId = this.opts.isOfferer ? this.id : this.remoteId;
    this.opts.sendSignal({ ...signal, ...(connectionId ? { connectionId } : {}) });
  }

  private create(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    pc.onicecandidate = (e) => {
      if (e.candidate && pc === this.pc)
        this.signal({ candidate: e.candidate.toJSON() as RTCIceCandidateLike });
    };
    pc.ontrack = (e) => this.onTrack(e);
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      const state = pc.connectionState;
      this.opts.onConnectionState(state);
      window.clearTimeout(this.disconnectTimer);
      if (state === 'failed') void this.restartIce();
      if (state === 'disconnected')
        this.disconnectTimer = window.setTimeout(() => void this.restartIce(), 4_000);
    };
    return pc;
  }

  private addOffererTransceivers() {
    const { local, callType } = this.opts;
    this.pc.addTransceiver(local.mic, { direction: 'sendrecv', streams: [local.micStream] });
    if (callType === 'video') {
      this.pc.addTransceiver(local.video ?? 'video', {
        direction: 'sendrecv',
        streams: [local.micStream],
      });
    }
    this.pc.addTransceiver(local.translation, {
      direction: 'sendrecv',
      streams: [local.translationStream],
    });
  }

  /** Attaches our tracks to the transceivers the offer created, in the agreed order. */
  private attachAnswererTracks() {
    const { local } = this.opts;
    const audio = this.pc.getTransceivers().filter((t) => t.receiver.track.kind === 'audio');
    const video = this.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video');
    const assign = (
      t: RTCRtpTransceiver | undefined,
      track: MediaStreamTrack | null,
      stream: MediaStream,
    ) => {
      if (!t || t.currentDirection === 'sendrecv') return;
      t.direction = 'sendrecv';
      void t.sender.replaceTrack(track);
      t.sender.setStreams(stream);
    };
    assign(audio[0], local.mic, local.micStream);
    assign(video, local.video, local.micStream);
    assign(audio[1], local.translation, local.translationStream);
  }

  private onTrack(e: RTCTrackEvent) {
    const track = e.track;
    let key: keyof RemoteMedia = 'original';
    if (track.kind === 'audio') {
      const audio = this.pc.getTransceivers().filter((t) => t.receiver.track.kind === 'audio');
      if (audio.indexOf(e.transceiver) === 1) key = 'translation';
    }
    // New stream objects so media elements and React effects notice the change.
    const others = this.remote[key].getTracks().filter((t) => t.kind !== track.kind);
    this.remote = { ...this.remote, [key]: new MediaStream([...others, track]) };
    this.opts.onRemoteMedia(this.remote);
  }

  private async makeOffer(iceRestart = false) {
    if (this.closed) return;
    try {
      const offer = await this.pc.createOffer({ iceRestart });
      await this.pc.setLocalDescription(offer);
      this.signal({ description: { type: 'offer', sdp: this.pc.localDescription!.sdp } });
    } catch (err) {
      console.warn('Failed to create offer', err);
    }
  }

  /** Sends a fresh offer (host only), once the guest has said it is ready for one. */
  offer(): void {
    if (this.opts.isOfferer) void this.makeOffer();
  }

  private async restartIce() {
    if (this.closed || !this.opts.isOfferer || this.pc.signalingState !== 'stable') return;
    await this.makeOffer(true);
  }

  /** Guest only: the host replaced its connection, so start over with a fresh one. */
  private resetConnection() {
    this.detach(this.pc);
    this.pc.close();
    this.pc = this.create();
    this.pendingCandidates = [];
    this.lastStats = null;
    this.remote = { original: new MediaStream(), translation: new MediaStream() };
    this.opts.onRemoteMedia(this.remote);
  }

  private detach(pc: RTCPeerConnection) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
  }

  async handleSignal(signal: PeerSignal): Promise<void> {
    if (this.closed) return;
    if (signal.description?.type === 'offer' && !this.opts.isOfferer) {
      if (this.remoteId && signal.connectionId !== this.remoteId) this.resetConnection();
      this.remoteId = signal.connectionId ?? null;
    } else if ((signal.connectionId ?? null) !== (this.opts.isOfferer ? this.id : this.remoteId)) {
      return; // Left over from a replaced connection.
    }
    try {
      if (signal.description) {
        const { type, sdp } = signal.description;
        if (type === 'offer') {
          if (this.opts.isOfferer) return; // Only the host offers.
          await this.pc.setRemoteDescription({ type, sdp });
          this.attachAnswererTracks();
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.signal({
            description: { type: 'answer', sdp: this.pc.localDescription!.sdp },
          });
        } else if (this.pc.signalingState === 'have-local-offer') {
          await this.pc.setRemoteDescription({ type, sdp });
        }
        for (const c of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(c);
      } else if (signal.candidate) {
        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate.candidate,
          sdpMid: signal.candidate.sdpMid ?? null,
          sdpMLineIndex: signal.candidate.sdpMLineIndex ?? null,
          ...(signal.candidate.usernameFragment
            ? { usernameFragment: signal.candidate.usernameFragment }
            : {}),
        };
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(candidate);
        else this.pendingCandidates.push(candidate);
      }
    } catch (err) {
      console.warn('Signaling error', err);
    }
  }

  /** Swaps a local track in place, e.g. after a microphone is unplugged and re-acquired. */
  async replaceTrack(kind: 'mic' | 'video', track: MediaStreamTrack | null): Promise<void> {
    const transceivers = this.pc.getTransceivers();
    const target =
      kind === 'video'
        ? transceivers.find((t) => t.receiver.track.kind === 'video')
        : transceivers.filter((t) => t.receiver.track.kind === 'audio')[0];
    await target?.sender.replaceTrack(track);
  }

  private async measure() {
    if (this.pc.connectionState !== 'connected') return;
    const stats = await this.pc.getStats();
    let rtt: number | undefined;
    let lost = 0;
    let received = 0;
    stats.forEach((report: RTCStats & Record<string, unknown>) => {
      if (
        report.type === 'candidate-pair' &&
        report.nominated &&
        typeof report.currentRoundTripTime === 'number'
      ) {
        rtt = report.currentRoundTripTime;
      }
      if (report.type === 'inbound-rtp') {
        lost += Number(report.packetsLost ?? 0);
        received += Number(report.packetsReceived ?? 0);
      }
    });
    const prev = this.lastStats;
    this.lastStats = { lost, received };
    const dLost = prev ? lost - prev.lost : 0;
    const dReceived = prev ? received - prev.received : 0;
    const lossRate = dLost + dReceived > 0 ? dLost / (dLost + dReceived) : 0;
    let quality: ConnectionQuality = 'good';
    if ((rtt ?? 0) > 0.4 || lossRate > 0.08) quality = 'poor';
    else if ((rtt ?? 0) > 0.2 || lossRate > 0.02) quality = 'fair';
    this.opts.onQuality(quality);
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.statsTimer);
    window.clearTimeout(this.disconnectTimer);
    this.detach(this.pc);
    this.pc.close();
  }
}

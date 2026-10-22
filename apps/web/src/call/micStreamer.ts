/**
 * Streams the microphone to the server as 16 kHz PCM for speech recognition.
 * It reads the same echo-cancelled track that goes to the peer, so translated speech played from
 * the speakers is suppressed before it reaches recognition.
 */
export class MicStreamer {
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly onChunk: (pcm: ArrayBuffer) => void,
  ) {}

  async start(track: MediaStreamTrack): Promise<void> {
    this.stop();
    await this.context.audioWorklet.addModule('/pcm-worklet.js');
    this.source = this.context.createMediaStreamSource(new MediaStream([track]));
    this.node = new AudioWorkletNode(this.context, 'pcm-downsampler');
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.onChunk(event.data);
    // Worklets only run when connected to the graph; route through a muted gain so nothing is heard.
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(this.context.destination);
  }

  stop(): void {
    if (this.node) this.node.port.onmessage = null;
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.source = this.node = this.sink = null;
  }
}

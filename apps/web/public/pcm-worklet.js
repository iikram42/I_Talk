// Converts microphone audio to 16 kHz, 16-bit mono PCM and posts ~100 ms chunks to the main thread.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.position = 0;
    this.buffer = new Int16Array(CHUNK_SAMPLES);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    // Average the source samples that fall into each output sample (simple low-pass + decimate).
    while (this.position < channel.length) {
      const start = Math.floor(this.position);
      const end = Math.min(channel.length, Math.floor(this.position + this.ratio));
      let sum = 0;
      for (let i = start; i < Math.max(end, start + 1); i++) sum += channel[i];
      const sample = Math.max(-1, Math.min(1, sum / Math.max(end - start, 1)));
      this.buffer[this.length++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.length === CHUNK_SAMPLES) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
        this.buffer = new Int16Array(CHUNK_SAMPLES);
        this.length = 0;
      }
      this.position += this.ratio;
    }
    this.position -= channel.length;
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);

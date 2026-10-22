/**
 * Detects recognized speech that is really our own synthesized audio leaking from a speaker
 * into the microphone. Each participant has a short memory of what was recently played to them;
 * if their next utterance closely matches it, the utterance is dropped instead of translated back.
 * This backs up browser echo cancellation, which already removes most of that audio.
 */
export class LoopGuard {
  private readonly played = new Map<string, { text: string; at: number }[]>();

  constructor(
    private readonly windowMs = 30_000,
    private readonly threshold = 0.72,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records text that will be spoken aloud to `listenerId`. */
  remember(listenerId: string, text: string): void {
    const entries = this.prune(listenerId);
    entries.push({ text: normalize(text), at: this.now() });
    this.played.set(listenerId, entries);
  }

  /** True when `speakerId` just said something that matches audio recently played to them. */
  isEcho(speakerId: string, recognized: string): boolean {
    const candidate = normalize(recognized);
    if (candidate.length < 2) return false;
    return this.prune(speakerId).some(({ text }) => {
      if (candidate.length >= 8 && text.includes(candidate)) return true;
      return similarity(candidate, text) >= this.threshold;
    });
  }

  forget(participantId: string): void {
    this.played.delete(participantId);
  }

  private prune(id: string) {
    const cutoff = this.now() - this.windowMs;
    const entries = (this.played.get(id) ?? []).filter((e) => e.at >= cutoff);
    this.played.set(id, entries);
    return entries;
  }
}

export function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sørensen–Dice coefficient over character bigrams; works for scripts with or without spaces. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const grams = (s: string) => {
    const chars = Array.from(s.replace(/ /g, ''));
    const counts = new Map<string, number>();
    for (let i = 0; i < chars.length - 1; i++) {
      const g = chars[i]! + chars[i + 1]!;
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return { counts, size: Math.max(chars.length - 1, 0) };
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let overlap = 0;
  for (const [g, n] of ga.counts) overlap += Math.min(n, gb.counts.get(g) ?? 0);
  return (2 * overlap) / (ga.size + gb.size);
}

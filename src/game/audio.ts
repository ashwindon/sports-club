/**
 * Small synthesized sounds, so there are no audio files to load. Browsers
 * keep audio off until the page gets a click or key press.
 */
export class Sounds {
  #ctx: AudioContext | undefined;
  #noise: AudioBuffer | undefined;
  #muted = false;

  constructor() {
    // Any click or key unlocks sound, except the sound switch itself, which
    // would otherwise unlock and then mute in the same click.
    addEventListener("pointerdown", (event) => {
      if (!(event.target as Element | null)?.closest?.("[data-sound-switch]")) void this.#unlock();
    });
    addEventListener("keydown", () => void this.#unlock());
  }

  /** Sound is actually coming out: the browser has allowed it and it isn't muted. */
  get on(): boolean {
    return this.#ctx?.state === "running" && !this.#muted;
  }

  /** Turns sound on (unlocking it if the browser hasn't yet) or off. Resolves to the new state. */
  async toggle(): Promise<boolean> {
    if (this.#ctx?.state === "running") {
      this.#muted = !this.#muted;
    } else {
      this.#muted = false;
      await this.#unlock();
    }
    return this.on;
  }

  #unlock(): Promise<void> {
    this.#ctx ??= new AudioContext();
    return this.#ctx.resume().catch(() => undefined);
  }

  /** Leather on willow; `strength` 0–1 from how hard it was hit. */
  bat(strength: number): void {
    const s = Math.min(Math.max(strength, 0.15), 1);
    this.#burst({ type: "bandpass", freq: 2600, q: 1.4, gain: 0.35 + 0.5 * s, decay: 0.06 });
    this.#tone(950, 0.09, 0.25 * s);
  }

  bounce(): void {
    this.#burst({ type: "lowpass", freq: 420, q: 0.7, gain: 0.3, decay: 0.07 });
  }

  stumps(): void {
    for (let i = 0; i < 3; i++) this.#burst({ type: "bandpass", freq: 1500 + i * 400, q: 3, gain: 0.3, decay: 0.08, delay: i * 0.035 });
  }

  catch(): void {
    this.#burst({ type: "lowpass", freq: 700, q: 1, gain: 0.35, decay: 0.05 });
  }

  /** A swell of crowd noise for boundaries and wickets. */
  crowd(seconds = 1.6): void {
    this.#burst({ type: "bandpass", freq: 900, q: 0.5, gain: 0.18, decay: seconds, attack: 0.25 });
  }

  #burst(options: { type: BiquadFilterType; freq: number; q: number; gain: number; decay: number; delay?: number; attack?: number }): void {
    const ctx = this.#ctx;
    if (!ctx || !this.on) return;
    const start = ctx.currentTime + (options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.#noiseBuffer(ctx);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type;
    filter.frequency.value = options.freq;
    filter.Q.value = options.q;
    const amp = this.#envelope(ctx, start, options.gain, options.decay, options.attack ?? 0.002);
    source.connect(filter).connect(amp).connect(ctx.destination);
    source.start(start);
    source.stop(start + (options.attack ?? 0) + options.decay + 0.05);
  }

  #tone(freq: number, decay: number, gain: number): void {
    const ctx = this.#ctx;
    if (!ctx || !this.on) return;
    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(this.#envelope(ctx, start, gain, decay, 0.002)).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + decay + 0.05);
  }

  #envelope(ctx: AudioContext, start: number, gain: number, decay: number, attack: number): GainNode {
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    return amp;
  }

  #noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.#noise) {
      this.#noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.#noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.#noise;
  }
}

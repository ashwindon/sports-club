const median = (values: number[]) => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Per-phone link health: clock sync from ping/pong, then how late each motion
 * sample arrives, how often samples come, and how many go missing.
 */
export class LinkStats {
  #pings = new Map<number, number>();
  #nextPingId = 0;
  /** Recent pongs as (round trip, phone clock − game clock). */
  #syncs: { rtt: number; offset: number }[] = [];
  #latencies: number[] = [];
  #arrivals: number[] = [];
  #lastSeq: number | undefined;
  #lost = 0;
  #late = 0;

  ping(now: number): number {
    const id = this.#nextPingId++;
    this.#pings.set(id, now);
    return id;
  }

  pong(id: number, phoneTime: number, now: number): void {
    const sent = this.#pings.get(id);
    if (sent === undefined) return;
    this.#pings.delete(id);
    const rtt = now - sent;
    this.#syncs.push({ rtt, offset: phoneTime - (sent + rtt / 2) });
    if (this.#syncs.length > 20) this.#syncs.shift();
  }

  /** The offset from the quickest recent round trip is the least distorted by queueing. */
  get #best() {
    return this.#syncs.reduce<{ rtt: number; offset: number } | undefined>(
      (best, sync) => (!best || sync.rtt < best.rtt ? sync : best),
      undefined,
    );
  }

  /** A phone timestamp moved onto the game's clock, once the clocks have been compared. */
  gameTime(phoneTime: number): number | undefined {
    const best = this.#best;
    return best ? phoneTime - best.offset : undefined;
  }

  /**
   * Records a motion sample. `stale` means a newer one already arrived (the
   * channel is unordered), so it should not move the bat backwards.
   */
  sample(seq: number, phoneTime: number, now: number): { stale: boolean } {
    const stale = this.#lastSeq !== undefined && seq <= this.#lastSeq;
    if (stale) {
      // Counted as lost when the gap opened; it was only late.
      this.#late += 1;
      this.#lost = Math.max(0, this.#lost - 1);
    } else {
      if (this.#lastSeq !== undefined) this.#lost += seq - this.#lastSeq - 1;
      this.#lastSeq = seq;
    }
    this.#arrivals.push(now);
    while (this.#arrivals.length > 0 && now - this.#arrivals[0] > 1000) this.#arrivals.shift();

    const best = this.#best;
    if (best) {
      this.#latencies.push(now - (phoneTime - best.offset));
      if (this.#latencies.length > 120) this.#latencies.shift();
    }
    return { stale };
  }

  snapshot() {
    const gaps = this.#arrivals.slice(1).map((t, i) => t - this.#arrivals[i]);
    return {
      rateHz: this.#arrivals.length,
      latencyMs: median(this.#latencies),
      rttMs: this.#best?.rtt,
      maxGapMs: gaps.length ? Math.max(...gaps) : undefined,
      lost: this.#lost,
      late: this.#late,
    };
  }
}

/** Phone gyros typically top out at ±2000°/s; readings near that are clipped. */
const GYRO_LIMIT_DEG = 1950;

export interface Swing {
  peakSpinDeg: number;
  peakToeKmh: number;
  durationMs: number;
  gyroMaxedOut: boolean;
}

/**
 * Finds swings in the spin rate: starts above 600°/s (a backlift stays below
 * that; a drive goes well past 1000°/s), ends after 120 ms below 150°/s.
 */
export class SwingTracker {
  last: Swing | undefined;
  best: Swing | undefined;
  #current: (Swing & { start: number }) | undefined;
  #quietSince: number | undefined;

  update(t: number, spinDeg: number, maxAxisDeg: number, toeSpeed: number): Swing | undefined {
    const toeKmh = toeSpeed * 3.6;
    if (!this.#current) {
      if (spinDeg < 600) return undefined;
      this.#current = { start: t, peakSpinDeg: 0, peakToeKmh: 0, durationMs: 0, gyroMaxedOut: false };
    }
    const swing = this.#current;
    swing.peakSpinDeg = Math.max(swing.peakSpinDeg, spinDeg);
    swing.peakToeKmh = Math.max(swing.peakToeKmh, toeKmh);
    swing.gyroMaxedOut ||= maxAxisDeg > GYRO_LIMIT_DEG;

    if (spinDeg >= 150) {
      this.#quietSince = undefined;
      return undefined;
    }
    this.#quietSince ??= t;
    if (t - this.#quietSince < 120) return undefined;

    const { start, ...done } = swing;
    done.durationMs = this.#quietSince - start;
    this.#current = undefined;
    this.#quietSince = undefined;
    this.last = done;
    if (!this.best || done.peakToeKmh > this.best.peakToeKmh) this.best = done;
    return done;
  }

  reset(): void {
    this.last = this.best = undefined;
  }
}

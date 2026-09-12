/**
 * Shared low-frequency clock for React-rendered readouts (KPI tiles, legend values,
 * table). Charts redraw at 60 fps outside React; text that humans read does not need to
 * change more than ~4 times a second.
 *
 * All subscribers are notified in the same task, so React batches them into a single
 * commit, and nothing is notified when the probed data versions haven't changed (a
 * paused stream costs zero renders).
 */
export class UiTicker {
  private tick = 0;
  private lastProbe = Number.NaN;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly probe: () => number,
    private readonly intervalMs = 250,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.startTimer();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopTimer();
    };
  };

  getTick = (): number => this.tick;

  /** Force an immediate update (e.g. right after a control change). */
  bump(): void {
    this.tick++;
    this.listeners.forEach((l) => l());
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      const probe = this.probe();
      if (probe === this.lastProbe) return;
      this.lastProbe = probe;
      this.bump();
    }, this.intervalMs);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

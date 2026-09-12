import { InteractionTracker } from './performanceUtils';

export interface FrameInfo {
  /** rAF timestamp (ms). */
  now: number;
  /** Time since the previous frame, clamped to 250 ms (tab switches). */
  dt: number;
  frame: number;
}

export interface RenderTask {
  /** Lower runs first. Viewport animation runs before charts, monitors after. */
  priority: number;
  render(frame: FrameInfo): void;
  onError?(error: unknown): void;
}

const HISTORY = 512;

/**
 * One requestAnimationFrame loop for the whole dashboard.
 *
 * N charts each running their own rAF would schedule N callbacks per frame and could
 * draw from different data versions in the same frame. A single loop advances the
 * shared viewport once, then lets each chart decide (via its own dirty check) whether
 * to redraw. It also measures what it costs: frame intervals for FPS and the main-thread
 * time spent inside render tasks.
 */
export class RenderLoop {
  private tasks: RenderTask[] = [];
  private rafId = 0;
  private lastTime = 0;
  private frame = 0;
  private cursor = 0;
  private filled = 0;
  private readonly stamps = new Float64Array(HISTORY);
  private readonly intervals = new Float32Array(HISTORY);
  private readonly costs = new Float32Array(HISTORY);

  readonly interactions = new InteractionTracker();
  /** Main-thread ms spent in render tasks during the previous frame. */
  lastFrameCost = 0;

  add(task: RenderTask): () => void {
    this.tasks = [...this.tasks, task].sort((a, b) => a.priority - b.priority);
    this.start();
    return () => {
      this.tasks = this.tasks.filter((t) => t !== task);
      if (this.tasks.length === 0) this.stop();
    };
  }

  start(): void {
    if (this.rafId || typeof requestAnimationFrame === 'undefined') return;
    this.lastTime = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private readonly tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const interval = this.lastTime ? now - this.lastTime : 16.67;
    this.lastTime = now;
    const info: FrameInfo = { now, dt: Math.min(250, interval), frame: this.frame++ };

    const start = performance.now();
    const tasks = this.tasks;
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        task.render(info);
      } catch (error) {
        this.tasks = this.tasks.filter((t) => t !== task);
        if (task.onError) task.onError(error);
        else console.error('Render task failed', error);
      }
    }
    const end = performance.now();
    this.lastFrameCost = end - start;
    this.interactions.resolve(end);

    this.stamps[this.cursor] = now;
    this.intervals[this.cursor] = interval;
    this.costs[this.cursor] = end - start;
    this.cursor = (this.cursor + 1) % HISTORY;
    if (this.filled < HISTORY) this.filled++;
  };

  /** FPS, mean and worst frame interval and mean render cost over the last `windowMs`. */
  stats(now = performance.now(), windowMs = 1000): { fps: number; frameTime: number; worstFrame: number; renderCost: number } {
    let frames = 0;
    let intervalSum = 0;
    let worst = 0;
    let costSum = 0;
    for (let i = 0; i < this.filled; i++) {
      const idx = (this.cursor - 1 - i + HISTORY) % HISTORY;
      if (now - this.stamps[idx] > windowMs) break;
      frames++;
      intervalSum += this.intervals[idx];
      costSum += this.costs[idx];
      if (this.intervals[idx] > worst) worst = this.intervals[idx];
    }
    if (frames === 0) return { fps: 0, frameTime: 0, worstFrame: 0, renderCost: 0 };
    const frameTime = intervalSum / frames;
    return {
      fps: Math.min(frames * (1000 / windowMs), 1000 / Math.max(1, frameTime)),
      frameTime,
      worstFrame: worst,
      renderCost: costSum / frames,
    };
  }
}

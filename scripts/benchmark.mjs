#!/usr/bin/env node
/**
 * Automated benchmark against a running production build.
 *
 *   npm run build && npm run start          # in one terminal
 *   npm run benchmark                        # in another
 *
 * Options (all optional):
 *   --url=http://localhost:3000   base URL
 *   --headed                      show the browser window (real GPU compositing; recommended)
 *   --soak=600                    also run a memory soak test for N seconds
 *   --screenshots                 save README screenshots to docs/screenshots
 *   --skip-scenarios              skip the in-app load scenarios
 *
 * Uses the locally installed Google Chrome through playwright-core (no browser download).
 * Chrome is started with --enable-precise-memory-info so performance.memory is not
 * quantised, and heap is read after a forced GC through the DevTools protocol.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);
const baseUrl = args.url ?? 'http://localhost:3000';
const soakSeconds = Number(args.soak ?? 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

async function heapAfterGc(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 1_048_576;
}

function slopePerHour(samples) {
  const n = samples.length;
  if (n < 3) return null;
  const t0 = samples[0].t;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 3_600_000;
    sx += x; sy += s.heap; sxx += x * x; sxy += x * s.heap;
  }
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.headed,
    args: [
      '--enable-precise-memory-info',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  // Tall viewport: charts skip drawing while scrolled out of view (IntersectionObserver),
  // so every chart must be on screen for the numbers to include all four renderers.
  const context = await browser.newContext({ viewport: { width: 1440, height: 2200 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const output = {
    date: new Date().toISOString(),
    url: baseUrl,
    mode: args.headed ? 'headed' : 'headless',
    userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null),
  };

  // Navigation & Web Vitals-ish timings --------------------------------------------------
  await page.addInitScript(() => {
    window.__vitals = { lcp: null, cls: 0, events: [] };
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__vitals.lcp = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__vitals.events.push({ name: e.name, duration: e.duration });
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__dashboardBenchmark), null, { timeout: 30_000 });
  await sleep(3000);
  output.userAgent = await page.evaluate(() => navigator.userAgent);
  output.navigation = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return {
      ttfbMs: nav ? nav.responseStart - nav.requestStart : null,
      domContentLoadedMs: nav ? nav.domContentLoadedEventEnd : null,
      loadMs: nav ? nav.loadEventEnd : null,
      fcpMs: fcp ? fcp.startTime : null,
      lcpMs: window.__vitals.lcp,
      cls: window.__vitals.cls,
      transferKB: performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), nav?.transferSize || 0) / 1024,
    };
  });
  console.log('navigation', output.navigation);

  if (args.screenshots) {
    const dir = join(root, 'docs', 'screenshots');
    await mkdir(dir, { recursive: true });
    for (const theme of ['dark', 'light']) {
      await page.evaluate((t) => {
        localStorage.setItem('theme', t);
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.__dashboardBenchmark));
      await sleep(4000);
      const line = page.locator('[data-chart="line"] .chart-surface');
      const box = await line.boundingBox();
      if (box) await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.4);
      await sleep(400);
      await page.screenshot({ path: join(dir, `dashboard-${theme}.png`), fullPage: true });
      console.log(`saved dashboard-${theme}.png`);
    }
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    await mobilePage.addInitScript(() => localStorage.setItem('theme', 'dark'));
    await mobilePage.goto(`${baseUrl}/dashboard`, { waitUntil: 'load' });
    await sleep(4000);
    await mobilePage.screenshot({ path: join(dir, 'dashboard-mobile.png'), fullPage: false });
    await mobile.close();
    console.log('saved dashboard-mobile.png');
    await page.evaluate(() => localStorage.removeItem('theme'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__dashboardBenchmark));
    await sleep(2000);
  }

  // Interaction latency (Event Timing API: input delay + handlers + next paint) ----------
  await page.evaluate(() => (window.__vitals.events = []));
  const line = page.locator('[data-chart="line"] .chart-surface');
  const box = await line.boundingBox();
  const interactionStarted = Date.now();
  for (let i = 0; i < 6; i++) {
    await page.getByRole('radio', { name: ['1 min', '5 min', '1 hour'][i % 3] }).click();
    await page.getByRole('button', { name: ['US East', 'EU Central', 'AP South'][i % 3], exact: true }).first().click();
    await page.getByRole('radio', { name: ['1h', '6h', 'All'][i % 3], exact: true }).click();
  }
  if (box) {
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -240);
      await page.keyboard.up('Control');
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    }
  }
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await sleep(1000);
  output.interactions = await page.evaluate(() => {
    const durations = window.__vitals.events.map((e) => e.duration).sort((a, b) => a - b);
    const pick = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.ceil((p / 100) * durations.length) - 1)] : null);
    return { eventsOver16ms: durations.length, p75Ms: pick(75), p98Ms: pick(98), maxMs: durations[durations.length - 1] ?? null };
  });
  output.interactions.scriptedInteractionSeconds = round((Date.now() - interactionStarted) / 1000);
  console.log('interactions', output.interactions);

  // Load scenarios (in-app benchmark) -----------------------------------------------------
  if (!args['skip-scenarios']) {
    console.log('running in-app benchmark scenarios…');
    const results = await page.evaluate(() => window.__dashboardBenchmark.run());
    output.scenarios = results.map((r) => ({
      scenario: r.label,
      avgFps: round(r.avgFps),
      p1LowFps: round(r.p1LowFps),
      p99FrameMs: round(r.p99FrameMs),
      maxFrameMs: round(r.maxFrameMs),
      droppedFrames: `${r.droppedFrames}/${r.frames}`,
      drawMsAvg: round(r.avgRenderMs, 2),
      drawMsP95: round(r.p95RenderMs, 2),
      workerAggregateMs: round(r.avgAggregateMs, 2),
      longTasks: r.longTasks,
      heapMB: round(r.heapEndMB),
    }));
    console.table(output.scenarios);
  }

  // Soak test -----------------------------------------------------------------------------
  if (soakSeconds > 0) {
    console.log(`soak test: ${soakSeconds}s at 10k points, 50 samples/batch…`);
    await page.getByLabel('Points in buffer').selectOption('10000');
    await page.getByLabel('Samples per batch').selectOption('50');
    await sleep(15_000); // let the buffer turn over once and JIT settle
    const samples = [];
    const started = Date.now();
    while (Date.now() - started < soakSeconds * 1000) {
      const heap = await heapAfterGc(cdp);
      const fps = Number(await page.getByTestId('fps-value').textContent());
      samples.push({ t: Date.now(), heap, fps });
      await sleep(10_000);
    }
    const heaps = samples.map((s) => s.heap);
    output.soak = {
      seconds: soakSeconds,
      samples: samples.length,
      heapStartMB: round(heaps[0], 2),
      heapEndMB: round(heaps[heaps.length - 1], 2),
      heapMinMB: round(Math.min(...heaps), 2),
      heapMaxMB: round(Math.max(...heaps), 2),
      slopeMBPerHour: round(slopePerHour(samples), 2),
      fpsMin: Math.min(...samples.map((s) => s.fps)),
      fpsAvg: round(samples.reduce((s, x) => s + x.fps, 0) / samples.length),
    };
    console.log('soak', output.soak);
  }

  const dir = join(root, 'benchmark-results');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${output.date.replace(/[:.]/g, '-')}-${output.mode}.json`);
  await writeFile(file, JSON.stringify(output, null, 2));
  console.log(`\nwrote ${file}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

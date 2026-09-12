'use client';

import {
  Profiler,
  createContext,
  startTransition,
  useContext,
  useEffect,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import { AggregationEngine } from '@/lib/aggregationEngine';
import {
  ALL_CATEGORIES_MASK,
  CATEGORY_COUNT,
  DEFAULT_CONTROLS,
  INITIAL_POINTS,
  MAX_WINDOW,
  STRESS_STREAM,
} from '@/lib/chartConfig';
import { generateHistory } from '@/lib/dataGenerator';
import { decodeBase64Columns, decodeBinaryHistory } from '@/lib/encoding';
import { CommitCounter, RateCounter } from '@/lib/performanceUtils';
import { RenderLoop } from '@/lib/renderLoop';
import { TimeSeriesStore } from '@/lib/ringBuffer';
import type { AggregationLevel, DashboardControls, GeneratorState, InitialSnapshot, StreamSettings } from '@/lib/types';
import { UiTicker } from '@/lib/uiTicker';
import { ViewportStore } from '@/lib/viewport';
import { useDataStream } from '@/hooks/useDataStream';
import { useTheme } from './ThemeProvider';

/**
 * State architecture (no external state library):
 *
 *   CoreContext      - mutable engines created once: ring buffer, viewport, render loop,
 *                      aggregation worker. The context value never changes identity, so
 *                      consuming it never causes a re-render. 60 fps paths read these
 *                      directly.
 *   ControlsContext  - user-facing settings (filters, aggregation, stream load) in a
 *                      useReducer. Changes only on user input.
 *   DispatchContext  - stable dispatch, so buttons don't re-render when controls change.
 *   BackfillContext  - loading/error state of the history fetch.
 */

export interface DashboardCore {
  store: TimeSeriesStore;
  viewport: ViewportStore;
  loop: RenderLoop;
  engine: AggregationEngine;
  generator: GeneratorState;
  ingest: RateCounter;
  commits: CommitCounter;
  ticker: UiTicker;
}

export type ControlsAction =
  | { type: 'toggleCategory'; index: number }
  | { type: 'soloCategory'; index: number }
  | { type: 'setCategoryMask'; mask: number }
  | { type: 'setValueRange'; min: number; max: number }
  | { type: 'setAggregation'; level: AggregationLevel }
  | { type: 'setStreaming'; streaming: boolean }
  | { type: 'setPointsPerTick'; value: number }
  | { type: 'setWindowSize'; value: number }
  | { type: 'setStressMode'; enabled: boolean }
  | { type: 'applyStream'; stream: StreamSettings }
  | { type: 'resetFilters' };

export interface BackfillStatus {
  state: 'idle' | 'loading' | 'error';
  message: string | null;
}

function controlsReducer(state: DashboardControls, action: ControlsAction): DashboardControls {
  switch (action.type) {
    case 'toggleCategory': {
      const mask = state.filters.categoryMask ^ (1 << action.index);
      if (mask === 0) return state; // keep at least one region visible
      return { ...state, filters: { ...state.filters, categoryMask: mask } };
    }
    case 'soloCategory': {
      const solo = 1 << action.index;
      const mask = state.filters.categoryMask === solo ? ALL_CATEGORIES_MASK : solo;
      return { ...state, filters: { ...state.filters, categoryMask: mask } };
    }
    case 'setCategoryMask':
      return action.mask === 0 ? state : { ...state, filters: { ...state.filters, categoryMask: action.mask } };
    case 'setValueRange': {
      const min = Math.max(0, Math.min(action.min, action.max - 10));
      const max = Math.max(min + 10, action.max);
      if (min === state.filters.valueMin && max === state.filters.valueMax) return state;
      return { ...state, filters: { ...state.filters, valueMin: min, valueMax: max } };
    }
    case 'setAggregation':
      return { ...state, aggregation: action.level };
    case 'setStreaming':
      return { ...state, stream: { ...state.stream, streaming: action.streaming } };
    case 'setPointsPerTick':
      return { ...state, stressMode: false, stream: { ...state.stream, pointsPerTick: action.value } };
    case 'setWindowSize':
      return { ...state, stressMode: false, stream: { ...state.stream, windowSize: Math.min(MAX_WINDOW, action.value) } };
    case 'setStressMode':
      if (action.enabled === state.stressMode) return state;
      return action.enabled
        ? { ...state, stressMode: true, preStressStream: state.stream, stream: { ...STRESS_STREAM } }
        : { ...state, stressMode: false, stream: state.preStressStream ?? DEFAULT_CONTROLS.stream, preStressStream: null };
    case 'applyStream':
      return { ...state, stream: action.stream };
    case 'resetFilters':
      return { ...state, filters: DEFAULT_CONTROLS.filters };
    default:
      return state;
  }
}

function createCore(snapshot: InitialSnapshot | null): DashboardCore {
  const store = new TimeSeriesStore(DEFAULT_CONTROLS.stream.windowSize);
  let generator: GeneratorState;

  if (snapshot) {
    const cols = decodeBase64Columns(snapshot.values, snapshot.requests, snapshot.startTime, snapshot.categories, snapshot.intervalMs);
    for (let i = 0; i < cols.length; i++) store.push(cols.timestamps[i], cols.values[i], cols.requests[i], cols.categories[i]);
    // Props are immutable: copy before the stream starts mutating generator state.
    generator = {
      ...snapshot.generator,
      levels: [...snapshot.generator.levels],
      incidentLeft: [...snapshot.generator.incidentLeft],
      incidentMagnitude: [...snapshot.generator.incidentMagnitude],
    };
  } else {
    const history = generateHistory(INITIAL_POINTS, Date.now());
    for (let r = 0; r < history.rows; r++) {
      const ts = history.startTime + r * 10_000;
      for (let c = 0; c < CATEGORY_COUNT; c++) {
        const i = r * CATEGORY_COUNT + c;
        store.push(ts, history.values[i], history.requests[i], c);
      }
    }
    generator = history.state;
  }
  store.commit();

  const viewport = new ViewportStore();
  const engine = new AggregationEngine(store, viewport);
  return {
    store,
    viewport,
    loop: new RenderLoop(),
    engine,
    generator,
    ingest: new RateCounter(),
    commits: new CommitCounter(),
    ticker: new UiTicker(() => store.version + engine.version * 1e7),
  };
}

const CoreContext = createContext<DashboardCore | null>(null);
const ControlsContext = createContext<DashboardControls | null>(null);
const DispatchContext = createContext<Dispatch<ControlsAction> | null>(null);
const BackfillContext = createContext<BackfillStatus>({ state: 'idle', message: null });

interface DataProviderProps {
  initialSnapshot: InitialSnapshot | null;
  children: ReactNode;
}

export function DataProvider({ initialSnapshot, children }: DataProviderProps) {
  // Pure objects only; anything owning a resource (worker, rAF, timers) is attached in
  // effects below so React StrictMode's mount/unmount/mount cycle is leak-free.
  const [core] = useState(() => createCore(initialSnapshot));
  const [controls, dispatch] = useReducer(controlsReducer, DEFAULT_CONTROLS);
  const [backfill, setBackfill] = useState<BackfillStatus>({ state: 'idle', message: null });
  const { theme } = useTheme();

  useEffect(() => {
    core.engine.start();
    const removeViewportTask = core.loop.add({
      priority: -100,
      render(frame) {
        if (core.viewport.advance(frame.dt, core.store.firstTimestamp(), core.store.lastTimestamp())) {
          core.engine.request();
        }
      },
    });
    return () => {
      removeViewportTask();
      core.engine.stop();
    };
  }, [core]);

  useEffect(() => {
    core.engine.configure(controls.filters, controls.aggregation, theme);
  }, [core, controls.filters, controls.aggregation, theme]);

  useDataStream(core, controls.stream);

  // Window size: shrink immediately; grow by backfilling history from the edge API.
  const windowSize = controls.stream.windowSize;
  useEffect(() => {
    const { store } = core;
    store.resize(windowSize);
    const missing = windowSize - store.size;
    const oldest = store.firstTimestamp();
    if (missing < CATEGORY_COUNT * 10 || !Number.isFinite(oldest)) return;

    const controller = new AbortController();
    setBackfill({ state: 'loading', message: `Loading ${missing.toLocaleString('en-US')} historical samples…` });
    fetch(`/api/data?points=${missing}&end=${oldest}&format=binary`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`History request failed (${response.status})`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        const older = decodeBinaryHistory(buffer);
        store.prepend(older);
        startTransition(() => setBackfill({ state: 'idle', message: null }));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setBackfill({
          state: 'error',
          message: `${error instanceof Error ? error.message : 'Backfill failed'} — the buffer will fill from the live stream instead.`,
        });
      });
    return () => controller.abort();
  }, [core, windowSize]);

  return (
    <CoreContext.Provider value={core}>
      <DispatchContext.Provider value={dispatch}>
        <ControlsContext.Provider value={controls}>
          <BackfillContext.Provider value={backfill}>
            <Profiler id="dashboard" onRender={core.commits.onRender}>
              {children}
            </Profiler>
          </BackfillContext.Provider>
        </ControlsContext.Provider>
      </DispatchContext.Provider>
    </CoreContext.Provider>
  );
}

export function useDashboardCore(): DashboardCore {
  const core = useContext(CoreContext);
  if (!core) throw new Error('useDashboardCore must be used inside <DataProvider>');
  return core;
}

export function useControls(): DashboardControls {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error('useControls must be used inside <DataProvider>');
  return controls;
}

export function useControlsDispatch(): Dispatch<ControlsAction> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error('useControlsDispatch must be used inside <DataProvider>');
  return dispatch;
}

export function useBackfillStatus(): BackfillStatus {
  return useContext(BackfillContext);
}

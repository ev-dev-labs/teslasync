// Native parity port of web/src/hooks/useTour.ts.
//
// `useTour` drives a guided, multi-step onboarding tour: it owns the active /
// current-step navigation state (start / next / prev / skip / finish), fires the
// per-step `onShow` / `onHide` side-effect callbacks, persists per-tour
// completion, and — ON THE WEB ONLY — measures the highlighted DOM element so a
// spotlight overlay can be positioned over it.
//
// What ports 1:1 (the bulk of the hook, genuinely useful on native):
//   - `isActive` / `currentStep` navigation state and the `start` / `next` /
//     `prev` / `skip` / `finish` transitions (web L57-58, L105-148).
//   - `totalSteps` and the derived current `step` (web L153-154).
//   - The `onShow` / `onHide` per-step callback effect (web L98-103) — pure
//     React logic with no DOM dependency.
//   - The `TourStep` / `TourPersistenceContext` contracts and the per-tour
//     completion persistence semantics.
//
// What is structurally browser-only and is degraded (contract rules 4, 5 & 7):
//
//   - DOM SPOTLIGHT MEASUREMENT (web L29 `targetRect: DOMRect`, L59-95):
//     `document.querySelector(step.target)` + `el.getBoundingClientRect()`, the
//     `ResizeObserver`, and the `window` `resize` / `scroll` listeners that kept
//     the measured rect fresh. React Native has no `document`, no global
//     `DOMRect`, no `ResizeObserver`, and no `window` scroll/resize events, and
//     the native tsconfig ships no `dom` lib so those types are unavailable. A
//     native tour overlay measures its target View via `onLayout` /
//     `ref.measureInWindow()` instead, which is the host component's job — so the
//     hook reports `targetRect: null` plus an explicit `targetingStatus:
//     'unavailable'` + {@link TOUR_TARGETING_UNAVAILABLE_REASON}, the same
//     return-a-value-and-let-the-native-host-render shape used by
//     useTitleBadge.ts. `DOMRect` is modelled by the local {@link TourTargetRect}
//     so a future native host could populate the same fields.
//
//   - `@/lib/tourRegistry` (web L2-6: `markTourCompleted` / `markTourSkipped` /
//     `resetAllTours`) is a browser-only `window.localStorage` module with no
//     native parity port (and porting it is out of scope — it pulls in
//     useTour itself plus eight `@/features/onboarding/tours/*` definitions). The
//     three completion writers this hook actually calls are inlined as
//     native-safe shims backed by a module-scoped `Map<string, string>`, keeping
//     the EXACT `teslasync:tour:v{version}:{id}` -> 'completed' | 'skipped'
//     storage-key schema and the legacy-flag cleanup. This is the established
//     in-memory-Map localStorage substitution (useNotificationListener.ts,
//     confirmSilence.ts, draftIndex.ts); cold-restart persistence is the only
//     behavioural loss.
//
//   - `@/lib/broadcast` (web L7) is the browser `BroadcastChannel` /
//     `localStorage` cross-tab bus. React Native is a single process with no
//     second tab to notify (the useChartPalette parity note already records
//     "no BroadcastChannel on native"), so `broadcast` is a native-safe no-op
//     that preserves the typed `tour.completed` / `tour.reset` message shape.
//
//   - The deprecated `isTourCompleted()` (web L169-176) read the legacy
//     `teslasync-tour-completed` localStorage flag; the live code no longer
//     writes it, so the web doc already promises it "always returns false". The
//     port feature-detects `localStorage` off `globalThis` (real on the
//     react-native-web target, absent on bare native) and otherwise returns
//     false, exactly matching the web result.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only react's useCallback / useEffect / useRef /
// useState. The browser DOM types are modelled by local interfaces.

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Native-safe per-tour completion persistence ────────────────────────────
// Inlined analogue of the three `@/lib/tourRegistry` writers this hook calls
// (web L2-6). The web stored each completion under
// `teslasync:tour:v{version}:{id}` -> 'completed' | 'skipped' in
// `window.localStorage`; React Native has no localStorage, so a module-scoped
// Map is the in-memory stand-in (the useNotificationListener / confirmSilence /
// draftIndex precedent). The storage-key schema and the legacy-flag cleanup of
// `resetAllTours` are preserved verbatim; only cold-restart persistence is lost.

const TOUR_STORAGE_PREFIX = 'teslasync:tour';
const LEGACY_TOUR_FLAG_KEY = 'teslasync-tour-completed';

const tourCompletionStore = new Map<string, string>();

function tourStorageKey(id: string, version: number): string {
  return `${TOUR_STORAGE_PREFIX}:v${version}:${id}`;
}

/** Native analogue of `markTourCompleted(id, version)` from `@/lib/tourRegistry`. */
function markCompletedInRegistry(id: string, version: number): void {
  tourCompletionStore.set(tourStorageKey(id, version), 'completed');
}

/** Native analogue of `markTourSkipped(id, version)` from `@/lib/tourRegistry`. */
function markSkippedInRegistry(id: string, version: number): void {
  tourCompletionStore.set(tourStorageKey(id, version), 'skipped');
}

/** Native analogue of `resetAllTours()` — clears every per-tour key + the legacy flag. */
function resetAllInRegistry(): void {
  const prefix = `${TOUR_STORAGE_PREFIX}:`;
  for (const key of Array.from(tourCompletionStore.keys())) {
    if (key.startsWith(prefix)) {
      tourCompletionStore.delete(key);
    }
  }
  // Mirror the web's removal of the pre-Prompt-65 single global flag so a reset
  // genuinely re-enables auto-start for users migrated from the legacy scheme.
  tourCompletionStore.delete(LEGACY_TOUR_FLAG_KEY);
}

// ─── Native-safe cross-tab broadcast ────────────────────────────────────────
// `@/lib/broadcast` (web L7) is the browser BroadcastChannel / localStorage
// cross-tab bus. React Native runs as a single process with no peer tab, so this
// is a documented no-op that preserves the typed message shape this hook emits.

/** Subset of the web `BroadcastMessage` union this hook emits (broadcast.ts L56-57). */
type TourBroadcastMessage =
  | { type: 'tour.completed'; tourId: string; version: number }
  | { type: 'tour.reset'; tourId?: string };

function broadcast(_msg: TourBroadcastMessage): void {
  // No-op on native: there is no second tab and no BroadcastChannel to notify.
  // The web bus also never echoes to the same tab, so in a single-process app a
  // cross-tab broadcast is a genuine no-op.
}

/**
 * A single tour step. On the web `target` is a CSS selector resolved via
 * `document.querySelector` to position a spotlight; on native it is an opaque
 * key a tour-overlay host maps to a measured View (e.g. via `onLayout`).
 */
export interface TourStep {
  /** Selector (web) / target key (native) for the element to highlight. */
  target: string;
  /** Title of the tooltip */
  title: string;
  /** Description text */
  description: string;
  /** Position of the tooltip relative to the highlighted element */
  placement: 'top' | 'bottom' | 'left' | 'right';
  /** Optional: action to perform when this step is shown (e.g., open sidebar) */
  onShow?: () => void;
  /** Optional: action to perform when leaving this step */
  onHide?: () => void;
}

/**
 * Native-safe structural model of the browser `DOMRect` the web hook stored in
 * `targetRect` (web L29). The native tsconfig has no `dom` lib so `DOMRect` is
 * unavailable; this mirrors its readable fields so a native overlay host that
 * measures a target View can supply the same shape. The hook itself reports
 * `null` because there is no `getBoundingClientRect` source on native.
 */
export interface TourTargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Spotlight-measurement availability — only ever 'unavailable' on native. */
export type TourTargetingStatus = 'unavailable';

export const TOUR_TARGETING_UNAVAILABLE_REASON =
  'React Native has no document.querySelector, getBoundingClientRect/DOMRect, ResizeObserver, or window scroll/resize events to measure a highlighted element, so the DOM spotlight rect cannot be computed here. targetRect is therefore null; a native tour-overlay host measures its target View via onLayout / ref.measureInWindow() and positions the spotlight itself. All other tour behaviour (navigation, onShow/onHide, completion persistence) runs unchanged.';

interface TourState {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  step: TourStep | null;
  /** Always null on native — see {@link TOUR_TARGETING_UNAVAILABLE_REASON}. */
  targetRect: TourTargetRect | null;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  finish: () => void;
  /** Whether DOM spotlight measurement can run. Always 'unavailable' on native. */
  targetingStatus: TourTargetingStatus;
  /** Explanation when targeting is unavailable, else null. */
  unavailableReason: string | null;
}

/**
 * Optional context used by {@link useTour} to write per-tour completion
 * status into the storage layer owned by `@/lib/tourRegistry`. When omitted,
 * the hook still works for ad-hoc tours but does not persist any state.
 *
 * The legacy single global `teslasync-tour-completed` flag is no longer
 * written by this hook — call `resetAllTours` once to clear it for
 * existing users.
 */
export interface TourPersistenceContext {
  /** Stable tour id matching {@link TourDefinition.id} */
  id: string;
  /** Tour version — bumping invalidates the previously stored flag */
  version: number;
}

export function useTour(
  steps: TourStep[],
  persistence?: TourPersistenceContext,
): TourState {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  // Web L59 held `targetRect` in state, updated from getBoundingClientRect via a
  // ResizeObserver + window scroll/resize listeners (web L60, L64-95). None of
  // those primitives exist on native, so the rect has no source and is permanently
  // null; a native overlay host measures its target View itself (see
  // TOUR_TARGETING_UNAVAILABLE_REASON).
  const targetRect: TourTargetRect | null = null;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  // Call onShow/onHide callbacks (web L98-103) — pure logic, ports 1:1.
  useEffect(() => {
    if (!isActive || currentStep >= stepsRef.current.length) {
      return;
    }
    const step = stepsRef.current[currentStep];
    step.onShow?.();
    return () => {
      step.onHide?.();
    };
  }, [isActive, currentStep]);

  const start = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const persistRef = useRef(persistence);
  persistRef.current = persistence;

  const next = useCallback(() => {
    if (currentStep < stepsRef.current.length - 1) {
      setCurrentStep(current => current + 1);
    } else {
      setIsActive(false);
      const ctx = persistRef.current;
      if (ctx) {
        markCompletedInRegistry(ctx.id, ctx.version);
        broadcast({ type: 'tour.completed', tourId: ctx.id, version: ctx.version });
      }
    }
  }, [currentStep]);

  const prev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(current => current - 1);
    }
  }, [currentStep]);

  const skip = useCallback(() => {
    setIsActive(false);
    const ctx = persistRef.current;
    if (ctx) {
      markSkippedInRegistry(ctx.id, ctx.version);
      broadcast({ type: 'tour.completed', tourId: ctx.id, version: ctx.version });
    }
  }, []);

  const finish = useCallback(() => {
    setIsActive(false);
    const ctx = persistRef.current;
    if (ctx) {
      markCompletedInRegistry(ctx.id, ctx.version);
      broadcast({ type: 'tour.completed', tourId: ctx.id, version: ctx.version });
    }
  }, []);

  return {
    isActive,
    currentStep,
    totalSteps: steps.length,
    step: isActive && currentStep < steps.length ? steps[currentStep] : null,
    targetRect,
    start,
    next,
    prev,
    skip,
    finish,
    targetingStatus: 'unavailable',
    unavailableReason: TOUR_TARGETING_UNAVAILABLE_REASON,
  };
}

/**
 * @deprecated Use `isTourCompleted(id, version)` from `@/lib/tourRegistry`.
 * Kept for one release to avoid breaking external callers; always returns
 * false now that the legacy global flag is no longer written.
 */
export function isTourCompleted(): boolean {
  const ls = (
    globalThis as {
      localStorage?: { getItem(key: string): string | null };
    }
  ).localStorage;
  if (!ls) {
    return false;
  }
  try {
    return ls.getItem('teslasync-tour-completed') === 'true';
  } catch {
    return false;
  }
}

/**
 * @deprecated Use `resetAllTours()` from `@/lib/tourRegistry` (clears every
 * per-tour key) or `resetTour(id)` for a single tour.
 */
export function resetTour(): void {
  resetAllInRegistry();
  broadcast({ type: 'tour.reset' });
}

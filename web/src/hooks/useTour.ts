import { useState, useCallback, useEffect, useRef } from 'react';
import {
  markTourCompleted as markCompletedInRegistry,
  markTourSkipped as markSkippedInRegistry,
  resetAllTours as resetAllInRegistry,
} from '@/lib/tourRegistry';
import { broadcast } from '@/lib/broadcast';

export interface TourStep {
  /** CSS selector for the element to highlight */
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

interface TourState {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  step: TourStep | null;
  targetRect: DOMRect | null;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  finish: () => void;
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
  steps: TourStep[] = [],
  persistence?: TourPersistenceContext,
): TourState {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const updateRect = useCallback(() => {
    const selector = stepsRef.current[currentStep]?.target;
    // An empty/missing selector is not a valid `querySelector` argument
    // (it throws a SyntaxError), so treat it the same as "no target".
    if (!isActive || currentStep >= stepsRef.current.length || !selector) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(selector);
    setTargetRect(el ? el.getBoundingClientRect() : null);
  }, [isActive, currentStep]);

  // Observe resize, scroll, and element dimensions
  useEffect(() => {
    if (!isActive) {
      // Clear any rect carried over from a previous step so a finished or
      // skipped tour never leaves a stale spotlight target behind.
      setTargetRect(null);
      return;
    }
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    const selector = stepsRef.current[currentStep]?.target;
    const el = selector ? document.querySelector(selector) : null;
    if (el) {
      observerRef.current = new ResizeObserver(updateRect);
      observerRef.current.observe(el);
    }

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      observerRef.current?.disconnect();
    };
  }, [isActive, currentStep, updateRect]);

  // Call onShow/onHide callbacks
  useEffect(() => {
    if (!isActive || currentStep >= stepsRef.current.length) return;
    const step = stepsRef.current[currentStep];
    step.onShow?.();
    return () => { step.onHide?.(); };
  }, [isActive, currentStep]);

  const start = useCallback(() => {
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const persistRef = useRef(persistence);
  persistRef.current = persistence;

  const next = useCallback(() => {
    if (currentStep < stepsRef.current.length - 1) {
      setCurrentStep(prev => prev + 1);
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
      setCurrentStep(prev => prev - 1);
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
  };
}

/**
 * @deprecated Use `isTourCompleted(id, version)` from `@/lib/tourRegistry`.
 * Kept for one release to avoid breaking external callers; always returns
 * false now that the legacy global flag is no longer written.
 */
export function isTourCompleted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('teslasync-tour-completed') === 'true';
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

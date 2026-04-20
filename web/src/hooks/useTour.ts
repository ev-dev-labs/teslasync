import { useState, useCallback, useEffect, useRef } from 'react';

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

const TOUR_COMPLETED_KEY = 'teslasync-tour-completed';

export function useTour(steps: TourStep[]): TourState {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const updateRect = useCallback(() => {
    if (!isActive || currentStep >= stepsRef.current.length) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(stepsRef.current[currentStep].target);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [isActive, currentStep]);

  // Observe resize, scroll, and element dimensions
  useEffect(() => {
    if (!isActive) return;
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    const el = document.querySelector(stepsRef.current[currentStep]?.target ?? '');
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

  const next = useCallback(() => {
    if (currentStep < stepsRef.current.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      setIsActive(false);
      localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    }
  }, [currentStep]);

  const prev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const skip = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
  }, []);

  const finish = useCallback(() => {
    setIsActive(false);
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
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

export function isTourCompleted(): boolean {
  return localStorage.getItem(TOUR_COMPLETED_KEY) === 'true';
}

export function resetTour(): void {
  localStorage.removeItem(TOUR_COMPLETED_KEY);
}

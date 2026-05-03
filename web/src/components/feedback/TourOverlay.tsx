import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { X, ArrowLeft, ArrowRight } from 'lucide-react';
import type { TourStep } from '@/hooks/useTour';
import { useMotionPreference } from '@/hooks/useMotionPreference';

interface TourOverlayProps {
  step: TourStep;
  targetRect: DOMRect | null;
  currentStep: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

export function TourOverlay({
  step, targetRect, currentStep, totalSteps,
  onNext, onPrev, onSkip,
}: TourOverlayProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();

  if (!targetRect) return null;

  const spotlightPadding = 6;

  const spotlight = {
    top: targetRect.top - spotlightPadding,
    left: targetRect.left - spotlightPadding,
    width: targetRect.width + spotlightPadding * 2,
    height: targetRect.height + spotlightPadding * 2,
  };

  const tooltipStyle = getTooltipPosition(step.placement, targetRect);

  return (
    // Phase-45 / Prompt 04: NOT migrated to <Modal>.
    // Rationale: full-screen tour spotlight with a transparent target cutout.
    // Has no scroll body, no dismiss chrome, and uses a clip-path for the
    // spotlight effect. New interactive dialogs MUST use <Modal>.
    // eslint-disable-next-line no-restricted-syntax
    <div className="fixed inset-0 z-[10000]" data-tour-active="true">
      {/* Dark overlay with spotlight cutout */}
      <div
        className={cn(
          'absolute inset-0 bg-black/60',
          reduce ? '' : 'transition-all duration-300',
        )}
        style={{
          clipPath: `polygon(
            0% 0%, 0% 100%,
            ${spotlight.left}px 100%,
            ${spotlight.left}px ${spotlight.top}px,
            ${spotlight.left + spotlight.width}px ${spotlight.top}px,
            ${spotlight.left + spotlight.width}px ${spotlight.top + spotlight.height}px,
            ${spotlight.left}px ${spotlight.top + spotlight.height}px,
            ${spotlight.left}px 100%,
            100% 100%, 100% 0%
          )`,
        }}
        onClick={onSkip}
      />

      {/* Spotlight border glow */}
      <div
        className={cn(
          'absolute rounded-lg border-2 border-[var(--theme-primary)]/40',
          'shadow-[0_0_20px_rgba(var(--theme-primary-rgb),0.2)] pointer-events-none',
          reduce ? '' : 'transition-all duration-300',
        )}
        style={{
          top: spotlight.top,
          left: spotlight.left,
          width: spotlight.width,
          height: spotlight.height,
        }}
      />

      {/* Tooltip */}
      <div
        className={cn(
          'absolute max-w-sm p-4 rounded-xl bg-[var(--bg-secondary)]',
          'border border-white/10 shadow-2xl backdrop-blur-xl',
          reduce ? '' : 'animate-in fade-in slide-in-from-bottom-2 duration-200',
        )}
        style={tooltipStyle}
        role="dialog"
        aria-modal="false"
        aria-label={t('tour.dialogLabel', 'Tour step {{current}} of {{total}}', {
          current: currentStep + 1,
          total: totalSteps,
        })}
      >
        {/* Close button — 44px touch target for mobile */}
        <button
          onClick={onSkip}
          className="absolute top-1 right-1 p-2.5 rounded-md text-white/30
            hover:text-white/60 hover:bg-white/5 transition-colors
            min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label={t('tour.close', 'Close tour')}
        >
          <X className="h-4 w-4" />
        </button>

        {/* Step counter */}
        <div className="text-[10px] text-white/30 mb-1">
          {currentStep + 1} / {totalSteps}
        </div>

        {/* Content */}
        <h4 className="text-sm font-semibold text-white/90 mb-1">{step.title}</h4>
        <p className="text-xs text-white/50 leading-relaxed mb-4">{step.description}</p>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={onSkip}
            className="text-xs text-white/30 hover:text-white/50 transition-colors
              py-2.5 px-2 min-h-[44px] flex items-center"
          >
            {t('tour.skip', 'Skip tour')}
          </button>
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={onPrev}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                {t('tour.prev', 'Back')}
              </Button>
            )}
            <Button size="sm" onClick={onNext}>
              {currentStep === totalSteps - 1
                ? t('tour.finish', 'Get Started!')
                : t('tour.next', 'Next')}
              {currentStep < totalSteps - 1 && (
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              )}
            </Button>
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 rounded-full transition-all',
                i === currentStep
                  ? 'w-4 bg-[var(--theme-primary)]'
                  : i < currentStep
                    ? 'w-1.5 bg-white/20'
                    : 'w-1.5 bg-white/10',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getTooltipPosition(
  placement: string,
  rect: DOMRect,
): React.CSSProperties {
  const gap = 16;
  const pad = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxW = Math.min(360, vw - pad * 2);
  const bottomNav = 72; // mobile bottom tab bar height

  const clampLeft = (x: number) =>
    Math.max(pad, Math.min(x, vw - maxW - pad));
  const clampTop = (y: number) =>
    Math.max(pad, Math.min(y, vh - bottomNav - 160));

  switch (placement) {
    case 'bottom':
      return { top: clampTop(rect.bottom + gap), left: clampLeft(rect.left), maxWidth: maxW };
    case 'top':
      return { bottom: Math.max(pad + bottomNav, vh - rect.top + gap), left: clampLeft(rect.left), maxWidth: maxW };
    case 'right':
      return { top: clampTop(rect.top), left: clampLeft(rect.right + gap), maxWidth: maxW };
    case 'left':
      return { top: clampTop(rect.top), right: Math.max(pad, vw - rect.left + gap), maxWidth: maxW };
    default:
      return { top: clampTop(rect.bottom + gap), left: clampLeft(rect.left), maxWidth: maxW };
  }
}

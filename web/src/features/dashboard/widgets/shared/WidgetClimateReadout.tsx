import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CHART_COLORS } from '@/lib/colors';
import { usePackPresentation } from '../designPacks/PackBoundary';
import { PACK_APPEARANCES } from '../designPacks/types';

export default function WidgetClimateReadout({ children }: { children: ReactNode }) {
  const pack = usePackPresentation();
  const gradient = `climate-readout-${useId().replace(/:/g, '')}`;
  if (pack === 'classic') return children;

  const appearance = PACK_APPEARANCES[pack];
  const plain = appearance === 'precision' || appearance === 'iconic' || appearance === 'expressive';
  return (
    <div data-climate-readout={appearance} className={cn(
      'relative mx-auto size-[115px] max-w-full shrink-0 @md:size-[150px]',
      appearance === 'elevated' && 'rounded-full bg-[var(--surface-2)]',
    )}>
      {/* The approved arc is decorative, not a temperature scale or command control. */}
      <svg viewBox="0 0 150 150" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <linearGradient id={gradient}>
            <stop stopColor={CHART_COLORS[0]} />
            <stop offset=".58" stopColor={CHART_COLORS[1]} />
            <stop offset="1" stopColor={CHART_COLORS[4]} />
          </linearGradient>
        </defs>
        <circle cx="75" cy="75" r="59" stroke="var(--border-subtle)"
          fill={plain ? 'none' : 'var(--surface-1)'} />
        <circle cx="75" cy="75" r="59" fill="none"
          stroke={plain || appearance === 'pixel' ? 'var(--theme-primary)' : `url(#${gradient})`}
          strokeWidth={appearance === 'precision' ? 7 : appearance === 'expressive' ? 10 : appearance === 'pixel' ? 8 : 9}
          strokeLinecap="round" strokeDasharray="285 371" transform="rotate(135 75 75)" />
        <circle cx="75" cy="75" r="46" fill={plain ? 'none' : 'var(--surface-2)'}
          stroke={plain ? 'none' : 'var(--border-subtle)'} />
      </svg>
      <div className="absolute inset-4 flex min-w-0 items-center justify-center [&_.widget-big-number]:items-center [&_.widget-big-number]:gap-1 [&_.widget-big-number]:text-center [&_.widget-big-number>div]:justify-center">
        {children}
      </div>
    </div>
  );
}

import { cn } from '@/lib/cn';
import type { PackAppearance } from '../types';
import type { StatusPresentationProps } from './Status.types';

const layouts: Record<PackAppearance, { root: string; headline: string; icon: string }> = {
  studio: { root: 'flex flex-col gap-4', headline: 'border-b border-[var(--border-subtle)] pb-3', icon: 'rounded-full border-2 border-[var(--border-default)] p-3' },
  elevated: { root: 'flex flex-col gap-4', headline: 'rounded-xl bg-[var(--surface-2)] p-4', icon: 'rounded-xl bg-[var(--surface-1)] p-3' },
  precision: { root: 'grid gap-4 @lg:grid-cols-2', headline: 'items-start @lg:flex-col @lg:justify-center', icon: 'p-1' },
  owner: { root: 'flex flex-col gap-3', headline: 'border-t border-[var(--border-subtle)] pt-3', icon: 'rounded-lg border border-[var(--border-default)] p-2' },
  iconic: { root: 'flex flex-col gap-4', headline: 'flex-col rounded-2xl border-2 border-[var(--border-subtle)] p-4 text-center', icon: 'order-first [&>svg]:size-12' },
  expressive: { root: 'flex flex-col gap-3', headline: 'rounded-t-3xl rounded-br-3xl rounded-bl-lg bg-[var(--surface-2)] p-4', icon: 'rounded-full bg-[var(--surface-1)] p-3 [&>svg]:size-8' },
  pixel: { root: 'flex flex-col gap-3 font-mono', headline: 'border-2 border-[var(--border-strong)] p-3', icon: '[&>svg]:size-8 [&>svg]:[shape-rendering:crispEdges]' },
};

export default function SecurityStatusLayout({ appearance, compact, headline, icon, details }: StatusPresentationProps) {
  const layout = layouts[appearance];
  const lead = (
    <div key="headline" className={cn('flex min-w-0 items-center justify-between gap-3', layout.headline, compact && 'gap-2 p-2')}>
      <div className="min-w-0 flex-1">{headline}</div>
      {icon && <span className={cn('shrink-0', layout.icon, compact && 'p-1 [&>svg]:size-5')}>{icon}</span>}
    </div>
  );
  const content = details != null && <div key="details" className="min-w-0">{details}</div>;
  return (
    <div data-status-appearance={appearance} className={cn('min-w-0', layout.root, compact && 'gap-2 @lg:grid-cols-1')}>
      {appearance === 'owner' ? [content, lead] : [lead, content]}
    </div>
  );
}

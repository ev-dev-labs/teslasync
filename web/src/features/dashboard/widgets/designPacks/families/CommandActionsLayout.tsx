import { cloneElement } from 'react';
import { cn } from '@/lib/cn';
import type { PackAppearance } from '../types';
import type { CommandActionsPresentationProps } from './Actions.types';
import { experimentalLayouts, isExperimentalAppearance } from '../experimentalLayouts';

const layouts: Record<PackAppearance, string> = {
  ...experimentalLayouts(({ actions }) => actions),
  studio: 'grid-cols-3 gap-3 [&>button]:min-h-20',
  elevated: 'grid-cols-2 gap-3 [&>button]:flex-row [&>button]:justify-start [&>button]:rounded-xl [&>button]:px-3',
  precision: 'grid-cols-2 gap-2 @md:grid-cols-3 [&>button]:min-h-14 [&>button]:flex-row',
  owner: 'grid-cols-2 gap-2 [&>button:first-child]:col-span-2 [&>button:first-child]:min-h-20',
  iconic: 'grid-cols-3 gap-3 [&>button]:rounded-2xl [&>button]:min-h-20 [&>button_svg]:size-6',
  expressive: 'grid-cols-2 gap-3 [&>button]:rounded-t-2xl [&>button]:rounded-br-2xl [&>button]:rounded-bl-md [&>button]:min-h-20',
  pixel: 'grid-cols-3 gap-2 [&>button]:rounded-none [&>button]:border-2 [&>button]:font-mono',
};
const pixelIcons: Record<string, string> = {
  unlock: 'M6 1h6v2H8v4h6v8H2V7h4zm0 8v4h4V9z',
  climate_on: 'M6 1h4v8h2v5H4V9h2zm2 2v8H6v1h4v-1H8V3z',
  frunk: 'M2 5h12v10H2zm2 2v6h8V7zM4 1h8v2H4z',
  trunk: 'M2 1h12v10H2zm2 2v6h8V3zM4 13h8v2H4z',
  flash: 'M8 1h5L9 6h4L4 15l2-7H2z',
  honk: 'M2 6h4l5-4v12l-5-4H2zm11-2h2v8h-2z',
};

export default function CommandActionsLayout({ appearance, compact, actions }: CommandActionsPresentationProps) {
  return (
    <div data-actions-appearance={appearance} className={cn(
      'grid min-w-0',
      compact && !isExperimentalAppearance(appearance) ? 'h-full grid-cols-3 items-center gap-1.5' : layouts[appearance],
      compact && isExperimentalAppearance(appearance) && 'gap-2 [&>button]:min-h-11',
    )}>
      {actions.map(action => appearance === 'pixel' && !action.busy && pixelIcons[action.id]
        ? cloneElement(action.button, {
            key: action.id,
            icon: <svg viewBox="0 0 16 16" className="size-5 shrink-0" fill="currentColor" aria-hidden="true" shapeRendering="crispEdges">
              <path d={pixelIcons[action.id]} />
            </svg>,
          })
        : action.button)}
    </div>
  );
}

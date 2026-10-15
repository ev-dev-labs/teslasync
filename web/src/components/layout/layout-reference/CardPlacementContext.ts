import { createContext, useContext } from 'react';
import type { CardSize } from './layoutPolicy';

export const CardPlacementContext = createContext<{
  size: CardSize;
  span: number;
  width: number;
} | null>(null);

const spanClasses: Record<number, string> = {
  1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4',
  5: 'col-span-5', 6: 'col-span-6', 7: 'col-span-7', 8: 'col-span-8',
  9: 'col-span-9', 10: 'col-span-10', 11: 'col-span-11', 12: 'col-span-12',
};

export function useCardPlacement() {
  const placement = useContext(CardPlacementContext);
  return placement && { ...placement, className: spanClasses[placement.span] };
}

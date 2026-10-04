import { createContext } from 'react';
import type { CardSize } from './layoutPolicy';

export const CardPlacementContext = createContext<{
  size: CardSize;
  span: number;
  width: number;
} | null>(null);

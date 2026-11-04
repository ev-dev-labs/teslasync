import { createContext } from 'react';

export const CardHeaderContext = createContext<{
  target: HTMLElement | null;
  summaryTarget?: HTMLElement | null;
  title: string;
} | null>(null);

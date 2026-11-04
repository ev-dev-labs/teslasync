import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ChartSlotPortal({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return target ? createPortal(children, target) : children;
}

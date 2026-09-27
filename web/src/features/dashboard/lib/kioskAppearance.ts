import type { CSSProperties } from 'react';

type KioskBackgroundStyle = CSSProperties & { '--kiosk-background-opacity': string };
type KioskPanelStyle = CSSProperties & { '--kiosk-panel-opacity': string };

function opacity(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

export function kioskBackgroundStyle(value: number): KioskBackgroundStyle {
  return { '--kiosk-background-opacity': `${opacity(value, 1) * 100}%` };
}

export function kioskPanelStyle(value: number): KioskPanelStyle {
  const level = opacity(value, 1);
  return {
    '--kiosk-panel-opacity': `${level * 100}%`,
    backdropFilter: `blur(${(4 + level * 12).toFixed(1)}px)`,
  };
}

import { useLayoutEffect, useState } from 'react';

interface MeasuredAxisWidthOptions {
  labels: readonly string[];
  fontSize: number;
  enabled?: boolean;
  minWidth?: number;
  padding?: number;
  fallbackCharacterRatio?: number;
}

export function measureAxisLabelWidth(
  labels: readonly string[],
  measure: (label: string) => number,
  minWidth = 35,
  padding = 12,
): number {
  const widest = labels.reduce((width, label) => Math.max(width, measure(label)), 0);
  return Math.max(minWidth, Math.ceil(widest) + padding);
}

export function useMeasuredAxisWidth({
  labels,
  fontSize,
  enabled = true,
  minWidth = 35,
  padding = 12,
  fallbackCharacterRatio = 0.75,
}: MeasuredAxisWidthOptions): number {
  const key = JSON.stringify([labels, fontSize, minWidth, padding]);
  const [measurement, setMeasurement] = useState<{ key: string; width: number } | null>(null);
  const fallback = measureAxisLabelWidth(
    labels,
    label => label.length * fontSize * fallbackCharacterRatio,
    minWidth,
    padding,
  );

  useLayoutEffect(() => {
    if (!enabled) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const context = document.createElement('canvas').getContext('2d');
      if (!context) return;
      context.font = `${fontSize}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
      const width = measureAxisLabelWidth(labels, label => context.measureText(label).width, minWidth, padding);
      setMeasurement(previous => previous?.key === key && previous.width === width ? previous : { key, width });
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => { active = false; };
  }, [enabled, fontSize, key, labels, minWidth, padding]);

  return enabled && measurement?.key === key ? measurement.width : fallback;
}

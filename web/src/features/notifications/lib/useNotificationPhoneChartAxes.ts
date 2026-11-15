import { useLayoutEffect, useMemo, useState } from 'react';

import { measureAxisLabelWidth } from '@/components/charts';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getChartFontFamily, getChartFontScale } from '@/lib/chartTypography';

export function useNotificationPhoneChartAxes() {
  const phone = useMediaQuery('(max-width: 767px)');
  const [typography, setTypography] = useState({ owned: false, size: 16, family: '', revision: 0 });

  useLayoutEffect(() => {
    const root = document.documentElement;
    let active = true;
    const update = (fontLoaded = false) => {
      const rootSize = parseFloat(getComputedStyle(root).fontSize) || 16;
      const next = {
        owned: root.hasAttribute('data-app-design-pack') && root.hasAttribute('data-app-design-owner'),
        size: rootSize * Math.max(1, getChartFontScale()),
        family: getChartFontFamily(),
      };
      setTypography(previous => !fontLoaded && previous.owned === next.owned
        && previous.size === next.size && previous.family === next.family
        ? previous : { ...next, revision: previous.revision + (fontLoaded ? 1 : 0) });
    };
    const observer = new MutationObserver(() => update());
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-app-design-pack', 'data-app-design-owner'] });
    const onFontsLoaded = () => update(true);
    document.fonts?.addEventListener('loadingdone', onFontsLoaded);
    void document.fonts?.ready.then(() => { if (active) onFontsLoaded(); });
    update();
    return () => {
      active = false;
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', onFontsLoaded);
    };
  }, []);

  return useMemo(() => {
    if (!phone || !typography.owned) return null;
    const { size, family, revision } = typography;
    const context = document.createElement('canvas').getContext('2d');
    if (context) context.font = `${size}px ${family}`;
    const measure = (label: string) => context?.measureText(label).width ?? label.length * size;
    const numericWidth = (max: number, format: (value: number) => string = String) => {
      const digits = String(Math.max(0, Math.ceil(max))).length + 1;
      const labels = Array.from({ length: 10 }, (_, digit) => format(Number(String(digit).repeat(digits))));
      return measureAxisLabelWidth(labels, measure);
    };
    const categoryAxis = (labels: string[]) => {
      const width = Math.min(measureAxisLabelWidth(labels, measure), Math.ceil(size * 6 + 12));
      const available = width - 12;
      return {
        width,
        format: (label: string) => {
          if (measure(label) <= available) return label;
          const characters = Array.from(label);
          while (characters.length > 0 && measure(`${characters.join('')}…`) > available) characters.pop();
          return `${characters.join('')}…`;
        },
      };
    };
    return {
      key: `${size}-${family}-${revision}`,
      tick: { fill: 'var(--text-muted)', fontSize: size, fontFamily: family },
      className: '[&_.recharts-cartesian-axis-tick-value]:!text-[length:var(--app-body-size)]',
      margin: { top: Math.ceil(size * 0.75), right: Math.ceil(size / 2), bottom: 0, left: 0 },
      xHeight: Math.ceil(size * 3),
      minTickGap: Math.ceil(size / 2),
      tickMargin: Math.ceil(size),
      numericWidth,
      categoryAxis,
    };
  }, [phone, typography]);
}

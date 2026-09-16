import { useTranslation } from 'react-i18next';

export const SCIENCE_ACCENT = '#0891b2';

export type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

export function useT(): Translate {
  const { t: translate } = useTranslation();
  return (key, fallback, options) => String(translate(key, fallback, options));
}

export function unknown(t: Translate) {
  return t('science.unknown', 'unknown');
}

export function downsample<T>(rows: readonly T[], budget: number): T[] {
  if (rows.length <= budget) return [...rows];
  const step = rows.length / budget;
  const out: T[] = [];
  for (let i = 0;i < budget;i += 1) out.push(rows[Math.floor(i * step)]);
  return out;
}

export function ciLabel(t: Translate, lo: number | null | undefined, hi: number | null | undefined, format: (v: number) => string) {
  if (lo == null || hi == null) return unknown(t);
  return `${format(lo)} … ${format(hi)}`;
}

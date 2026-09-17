import { useTranslation } from 'react-i18next';

export const LEDGER_ACCENT = '#0891b2';

export const LEDGER_SECONDARY = '#0d9488';

export const LEDGER_TERTIARY = '#d97706';

export type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

export function useT(): Translate {
  const { t: translate } = useTranslation();
  return (key, fallback, options) => String(translate(key, fallback, options));
}

export function unknownLabel(t: Translate) {
  return t('common.unknown', 'Unknown');
}

export function asList<T>(rows: readonly T[] | null | undefined): T[] {
  return Array.isArray(rows) ? [...rows] : [];
}

export function downsample<T>(rows: readonly T[] | null | undefined, budget: number): T[] {
  const list = asList(rows);
  if (list.length <= budget) return list;
  const step = list.length / budget;
  const out: T[] = [];
  for (let i = 0; i < budget; i += 1) out.push(list[Math.floor(i * step)]);
  return out;
}

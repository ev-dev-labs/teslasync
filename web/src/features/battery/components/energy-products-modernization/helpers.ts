import { Battery, Sun, Zap } from 'lucide-react';
import { fmtNumber } from '@/lib/numberFormat';

type TranslateFn = (key: string, fallback: string) => string;

export function fmtEnergy(wh: number | null | undefined): string {
  if (wh == null || !Number.isFinite(wh)) return '—';
  return Math.abs(wh) >= 1000 ? `${fmtNumber(wh / 1000)} kWh` : `${fmtNumber(wh)} Wh`;
}

export function fmtPower(w: number | null | undefined): string {
  if (w == null || !Number.isFinite(w)) return '—';
  return Math.abs(w) >= 1000 ? `${fmtNumber(w / 1000)} kW` : `${fmtNumber(w)} W`;
}

export function resourceIcon(type: string) {
  return type === 'battery' ? Battery : type === 'solar' ? Sun : Zap;
}

export function resourceLabel(type: string, t: TranslateFn): string {
  if (type === 'battery') return t('energy.products.resourceType.powerwall', 'Powerwall');
  if (type === 'solar') return t('energy.products.resourceType.solar', 'Solar');
  return type;
}

export function operationModeLabel(mode: string | undefined, t: TranslateFn): string {
  if (mode === 'self_consumption') return t('energy.siteInfo.mode.selfConsumption', 'Self-Powered');
  if (mode === 'autonomous') return t('energy.siteInfo.mode.autonomous', 'Time-Based Control');
  if (mode === 'backup') return t('energy.siteInfo.mode.backup', 'Backup Only');
  return mode ?? '—';
}

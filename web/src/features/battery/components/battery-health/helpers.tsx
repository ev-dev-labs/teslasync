import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  CheckCircle,
  Info,
  Target,
} from 'lucide-react';

import { CHART_COLORS } from '@/lib/colors';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type {
  BatteryChargingAnalysis,
  BatteryHealthAnalytics,
  DegradationPrediction,
} from '@/types/energy';

export interface InsightItem {
  icon: ReactNode;
  title: string;
  description: string;
  status: 'good' | 'warning' | 'critical';
}

export interface EnergyBreakdown {
  pieData: { name: string; value: number; fill: string }[];
  acCount: number;
  dcCount: number;
  totalEnergy: number;
  totalSessions: number;
}

export function gaugeColor(score: number): string {
  if (score >= 90) return CHART_COLORS[1];
  if (score >= 70) return CHART_COLORS[3];
  return CHART_COLORS[5];
}

export function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'danger';
}

export function healthLabel(score: number, t: (key: string, fallback: string) => string): string {
  if (score >= 90) return t('battery.health.excellent', 'Excellent');
  if (score >= 70) return t('battery.health.good', 'Good');
  return t('battery.health.degraded', 'Degraded');
}

export function degradationColor(pct: number): string {
  if (pct <= 5) return '#10b981';
  if (pct <= 15) return '#f59e0b';
  return '#ef4444';
}

export function buildInsights(
  health: BatteryHealthAnalytics,
  charging: BatteryChargingAnalysis | null,
  t: TFunction,
): InsightItem[] {
  const items: InsightItem[] = [];

  if (health.current_soh >= 90) {
    items.push({
      icon: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.excellentTitle', 'Excellent Health'),
      description: t('battery.insight.excellentDesc', {
        soh: fmtNumber(health.current_soh, 0),
        defaultValue: 'Battery health is {{soh}}/100 — performing above average.',
      }),
      status: 'good',
    });
  } else if (health.current_soh >= 70) {
    items.push({
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.goodTitle', 'Good Health'),
      description: t('battery.insight.goodDesc', {
        soh: fmtNumber(health.current_soh, 0),
        defaultValue: 'Battery health is {{soh}}/100 — normal degradation for age.',
      }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.concernTitle', 'Health Concern'),
      description: t('battery.insight.concernDesc', {
        soh: fmtNumber(health.current_soh, 0),
        defaultValue: 'Battery health dropped to {{soh}}/100 — consider service check.',
      }),
      status: 'critical',
    });
  }

  if (health.fast_charge_pct > 50) {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.highFastChargeTitle', 'High Fast-Charge Usage'),
      description: t('battery.insight.highFastChargeDesc', {
        pct: fmtPercent(health.fast_charge_pct),
        defaultValue: '{{pct}} of sessions are fast-charging. Mix in slow charging for longevity.',
      }),
      status: 'warning',
    });
  } else {
    items.push({
      icon: <CheckCircle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.goodHabitsTitle', 'Good Charging Habits'),
      description: t(
        'battery.insight.goodHabitsDesc',
        'Most charges are slow/AC — ideal for battery longevity.',
      ),
      status: 'good',
    });
  }

  if (charging?.deep_discharge_count != null && charging.deep_discharge_count > 3) {
    items.push({
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.deepDischargeTitle', 'Deep Discharges Detected'),
      description: t('battery.insight.deepDischargeDesc', {
        count: charging.deep_discharge_count,
        defaultValue: '{{count}} recent sessions started below 10%. Avoid deep discharges when possible.',
      }),
      status: 'warning',
    });
  }

  if (
    charging != null &&
    charging.total_sessions > 0 &&
    charging.supercharger_count > charging.total_sessions * 0.6
  ) {
    items.push({
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.highSuperchargerTitle', 'High Supercharger Usage'),
      description: t('battery.insight.highSuperchargerDesc', {
        count: charging.supercharger_count,
        defaultValue: '{{count}} Supercharger sessions. Occasional slow charging helps battery health.',
      }),
      status: 'warning',
    });
  }

  if (health.degradation_rate_pct_per_year < 3) {
    items.push({
      icon: <Target className="h-4 w-4" aria-hidden="true" />,
      title: t('battery.insight.lowDegTitle', 'Low Degradation Rate'),
      description: t('battery.insight.lowDegDesc', {
        rate: fmtNumber(health.degradation_rate_pct_per_year, 1),
        defaultValue: '{{rate}}% per year — well below industry average of 3–5%.',
      }),
      status: 'good',
    });
  }

  return items;
}

export function buildRecommendations(
  health: BatteryHealthAnalytics,
  t: (key: string, fallback: string) => string,
): string[] {
  const tips: string[] = [];
  if (health.fast_charge_pct > 30) {
    tips.push(t('battery.tip.reduceFast', 'Reduce fast charging frequency to slow degradation.'));
  }
  if (health.full_charge_pct > 40) {
    tips.push(t('battery.tip.avoid100', 'Avoid charging to 100% regularly — keep the limit at 80–90%.'));
  }
  if (health.avg_depth_of_discharge_pct > 70) {
    tips.push(t('battery.tip.avoidDeep', 'Try to avoid deep discharges below 20%.'));
  }
  if (health.degradation_rate_pct_per_year > 3) {
    tips.push(t('battery.tip.aboveAvg', 'Your degradation rate is above average — review charging habits.'));
  }
  if (tips.length === 0) {
    tips.push(t('battery.tip.great', 'Your battery health looks great — keep up the good habits!'));
  }
  return tips;
}

export function computeEnergyBreakdown(
  charging: BatteryChargingAnalysis,
): EnergyBreakdown | null {
  if (charging.total_sessions === 0) return null;
  const acEnergy = convertEnergyFromSI(charging.ac_energy_wh, 'kWh');
  const dcEnergy = convertEnergyFromSI(charging.dc_energy_wh, 'kWh');
  return {
    pieData: [
      { name: 'AC', value: roundTo1(acEnergy), fill: '#10b981' },
      { name: 'DC', value: roundTo1(dcEnergy), fill: '#f59e0b' },
    ],
    acCount: charging.ac_session_count,
    dcCount: charging.dc_session_count,
    totalEnergy: acEnergy + dcEnergy,
    totalSessions: charging.total_sessions,
  };
}

export function isProjectionTrustworthy(prediction: DegradationPrediction | null | undefined): boolean {
  if (!prediction?.has_enough_data) return false;
  const slope = Math.abs(prediction.slope_per_year ?? 0);
  if (!Number.isFinite(slope) || slope > 50) return false;
  const yearsTo80 = prediction.years_to_80_pct;
  return yearsTo80 != null && Number.isFinite(yearsTo80) && yearsTo80 > 0;
}

function roundTo1(value: number): number {
  return Math.round(value * 10) / 10;
}

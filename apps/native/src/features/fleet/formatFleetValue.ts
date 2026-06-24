import type { ChargingSession } from '../../api/types';
import {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatPower,
} from '../../lib/format';

export {
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEnergy,
  formatPower,
};

export function formatPercent(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return `${value.toFixed(digits)}%`;
}

export function formatSpeed(mps: number | null | undefined): string {
  if (mps == null || Number.isNaN(mps)) {
    return '-';
  }

  return `${(mps * 3.6).toFixed(0)} km/h`;
}

function normaliseTpmsToPa(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  if (raw >= 50_000) {
    return raw;
  }
  if (raw >= 100) {
    return raw * 1_000;
  }
  if (raw >= 10) {
    return raw * 6_894.757;
  }
  return raw * 100_000;
}

export function formatPressure(raw: number | null | undefined): string {
  const pressurePa = normaliseTpmsToPa(raw);
  if (pressurePa == null) {
    return '-';
  }

  return `${(pressurePa / 1000).toFixed(0)} kPa`;
}

export function formatTemperatureC(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return '-';
  }

  return `${value.toFixed(1)} °C`;
}

export function formatSystemValue(
  value: string | number | boolean | null | undefined,
): string {
  if (value == null) {
    return '-';
  }

  if (typeof value === 'boolean') {
    return value ? 'Enabled' : 'Disabled';
  }

  return String(value);
}

export function formatSocRange(
  startPct: number | null | undefined,
  endPct: number | null | undefined,
): string {
  return `${formatPercent(startPct)} -> ${formatPercent(endPct)}`;
}

export function formatEfficiency(
  energyWh: number | null | undefined,
  distanceM: number | null | undefined,
): string {
  if (
    energyWh == null ||
    distanceM == null ||
    Number.isNaN(energyWh) ||
    Number.isNaN(distanceM) ||
    distanceM <= 0
  ) {
    return '-';
  }

  return `${(energyWh / (distanceM / 1000)).toFixed(0)} Wh/km`;
}

export function formatLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): string {
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return '-';
  }

  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

export function formatCost(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount == null || Number.isNaN(amount)) {
    return '-';
  }

  return `${currency ?? 'USD'} ${amount.toFixed(2)}`;
}

export function formatChargingDuration(
  session: ChargingSession | null | undefined,
): string {
  if (!session?.started_at || !session.ended_at) {
    return session?.live ? 'Live' : '-';
  }

  const startedAt = new Date(session.started_at).getTime();
  const endedAt = new Date(session.ended_at).getTime();
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt < startedAt
  ) {
    return '-';
  }

  return formatDuration((endedAt - startedAt) / 1000);
}

export function shortVin(vin: string | null | undefined): string {
  return vin ? `...${vin.slice(-6)}` : '-';
}

export function formatNumber(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

export function formatCount(value: number | null | undefined): string {
  return formatNumber(value, 0);
}

export function formatPercent(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return `${formatNumber(value, digits)}%`;
}

export function formatCurrency(
  value: number | null | undefined,
  currency = 'USD',
): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatEnergyWh(
  wh: number | null | undefined,
  digits = 1,
): string {
  if (wh == null || !Number.isFinite(wh)) {
    return '-';
  }

  return `${formatNumber(wh / 1000, digits)} kWh`;
}

export function formatDistanceM(
  meters: number | null | undefined,
  digits = 1,
): string {
  if (meters == null || !Number.isFinite(meters)) {
    return '-';
  }

  return `${formatNumber(meters / 1000, digits)} km`;
}

export function formatDistanceKm(
  km: number | null | undefined,
  digits = 1,
): string {
  if (km == null || !Number.isFinite(km)) {
    return '-';
  }

  return `${formatNumber(km, digits)} km`;
}

export function formatEfficiencyWhKm(
  value: number | null | undefined,
  digits = 0,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return `${formatNumber(value, digits)} Wh/km`;
}

export function formatBatteryPctPer100Km(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return `${formatNumber(value, 1)} pp/100km`;
}

export function formatSpeedMps(mps: number | null | undefined): string {
  if (mps == null || !Number.isFinite(mps)) {
    return '-';
  }

  return `${formatNumber(mps * 3.6, 0)} km/h`;
}

export function formatTemperatureC(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '-';
  }

  return `${formatNumber(value, 1)} C`;
}

export function formatDurationSeconds(
  seconds: number | null | undefined,
): string {
  if (seconds == null || !Number.isFinite(seconds)) {
    return '-';
  }

  if (seconds < 3600) {
    return `${formatNumber(seconds / 60, 0)} min`;
  }

  return `${formatNumber(seconds / 3600, 1)} h`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

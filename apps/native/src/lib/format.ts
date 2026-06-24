export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters == null || Number.isNaN(meters)) {
    return '-';
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatEnergy(wh: number | null | undefined): string {
  if (wh == null || Number.isNaN(wh)) {
    return '-';
  }

  return `${(wh / 1000).toFixed(1)} kWh`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) {
    return '-';
  }

  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }

  return `${(seconds / 3600).toFixed(1)} h`;
}

export function formatPower(watts: number | null | undefined): string {
  if (watts == null || Number.isNaN(watts)) {
    return '-';
  }

  return `${(watts / 1000).toFixed(1)} kW`;
}

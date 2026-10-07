export function notificationEventTypeFallback(value: string): string {
  return value
    .split(/[._-]+/)
    .filter(Boolean)
    .map(word => word.toLowerCase() === 'fsd' ? 'FSD' : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || value;
}

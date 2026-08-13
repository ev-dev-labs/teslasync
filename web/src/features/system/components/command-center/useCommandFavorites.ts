import { useCallback, useState } from 'react';
import { COMMANDS } from '../../commands';

function defaultFavorites(): string[] {
  return COMMANDS.filter((command) => command.defaultFavorite).map((command) => command.id);
}

function readFavorites(vehicleId: number): string[] {
  try {
    const stored = localStorage.getItem(`teslasync-cmd-favorites-${vehicleId}`);
    if (!stored) return defaultFavorites();
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : defaultFavorites();
  } catch {
    return defaultFavorites();
  }
}

export function useCommandFavorites(vehicleId: number) {
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites(vehicleId));

  const toggleFavorite = useCallback((commandId: string) => {
    setFavorites((current) => {
      const next = current.includes(commandId)
        ? current.filter((id) => id !== commandId)
        : [...current, commandId];
      try {
        localStorage.setItem(
          `teslasync-cmd-favorites-${vehicleId}`,
          JSON.stringify(next),
        );
      } catch {
        // Storage can be unavailable in private mode. The in-memory state still
        // provides a fully usable favorite control for the current session.
      }
      return next;
    });
  }, [vehicleId]);

  return { favorites, toggleFavorite };
}

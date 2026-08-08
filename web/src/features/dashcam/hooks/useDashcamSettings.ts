import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashcamDb } from './useDashcamDb';
import { useMutationToast } from '@/api/hooks/_toastHelpers';
import type { DashcamSettings } from '../lib/types';

export const dashcamSettingsKey = ['dashcam', 'settings'] as const;

/** Reads the feature's locally-stored settings (timezone assumption, thresholds, pre/post-roll seconds). */
export function useDashcamSettings() {
  const { db } = useDashcamDb();
  return useQuery({
    queryKey: dashcamSettingsKey,
    queryFn: () => db.getSettings(),
    staleTime: Infinity,
  });
}

/** Persists an update to the feature's local settings. */
export function useUpdateDashcamSettings() {
  const { db } = useDashcamDb();
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: (settings: DashcamSettings) => db.putSettings(settings).then(() => settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashcamSettingsKey });
      success('dashcam.settings.success', 'Settings saved locally');
    },
    onError: (e) => error(e, 'dashcam.settings.error', 'Failed to save settings'),
  });
}

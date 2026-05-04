import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, ShieldQuestion } from 'lucide-react';
import { GlassPanel, IconBox, Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { listSilenced, unsilence, clearAllSilenced } from '@/lib/confirmSilence';

/**
 * Friendly labels for known silenceKey ids. Falls back to the raw key
 * when an unknown id appears (forward-compat for new adopters that
 * haven't shipped a translation yet).
 */
function useSilenceKeyLabel(): (key: string) => string {
  const { t } = useTranslation();
  return useCallback(
    (key: string) => {
      switch (key) {
        case 'discard-draft':
          return t('settings.advanced.restoreConfirms.keys.discardDraft', 'Discard unsaved draft');
        case 'unsaved-navigation':
          return t('settings.advanced.restoreConfirms.keys.unsavedNavigation', 'Leave page with unsaved changes');
        default:
          return key;
      }
    },
    [t],
  );
}

/**
 * "Restore confirmation prompts" panel — surfaces every action id the
 * user previously silenced via the `<ConfirmDialog>` "Don't ask again"
 * checkbox and lets them re-enable individual prompts or all at once.
 *
 * Lives in `<SettingsPage>` (mounted under the `#advanced` anchor) so
 * users can find the toggles via Settings search → "restore confirm".
 */
export function AdvancedSettings() {
  const { t } = useTranslation('settings');
  // Local bumper so each unsilence/clear re-reads localStorage without
  // wiring a global pub/sub. The only writers are this component itself.
  const [tick, setTick] = useState(0);
  const labelFor = useSilenceKeyLabel();
  const silenced = listSilenced();

  const handleRestore = useCallback(
    (key: string) => {
      unsilence(key);
      setTick((n) => n + 1);
    },
    [],
  );

  const handleRestoreAll = useCallback(() => {
    clearAllSilenced();
    setTick((n) => n + 1);
  }, []);

  // tick is referenced so the linter understands the re-render dependency
  // without requiring a useMemo around `silenced`.
  void tick;

  return (
    <FadeIn delay={0.24}>
      <GlassPanel className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <ShieldQuestion className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('advanced.restoreConfirms.title', 'Confirmation prompts')}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {t(
                'advanced.restoreConfirms.description',
                'Re-enable “Don’t ask again” prompts you previously silenced.',
              )}
            </p>
          </div>
          {silenced.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRestoreAll}
              icon={<RotateCcw className="h-4 w-4" />}
            >
              {t('advanced.restoreConfirms.restoreAll', 'Restore all')}
            </Button>
          )}
        </div>

        {silenced.length === 0 ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t(
              'advanced.restoreConfirms.empty',
              'No silenced prompts. Tick “Don’t ask again” on a confirmation dialog to silence it.',
            )}
          />
        ) : (
          <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.06] bg-white/[0.02]">
            {silenced.map((key) => (
              <li key={key} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-[var(--text-primary)] truncate">{labelFor(key)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRestore(key)}
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                >
                  {t('advanced.restoreConfirms.restore', 'Restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

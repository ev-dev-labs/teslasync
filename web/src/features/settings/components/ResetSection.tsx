/**
 * Reset to defaults UI.
 *
 * Renders two stacked panels under <section id="reset"> on the
 * Settings page:
 *
 *   1. "Reset by section" — a list of every whitelisted section with
 *      a per-row "Reset" button. Clicking pops a ConfirmDialog
 *      (variant=danger, NO silenceKey) describing what that reset
 *      will do. On confirm we POST /settings/reset { section } —
 *      sudo gating is handled transparently by the shared
 *      `request()` client.
 *
 *   2. "Danger zone" — a single big button "Reset ALL settings"
 *      that requires the user to type "RESET" before the confirm
 *      button enables (`requireTypedConfirmation="RESET"`).
 *
 * A third read-only panel lists sections that are NOT user-resettable
 * (the deny-list — currently `tariffs` and `sound_prefs`) along with
 * the reason and the alternative path the user should take.
 *
 * Toasts are surfaced for both success ("X sections reset") and
 * failure (handled by `useMutationToast` in the hook). On
 * SudoCanceledError we no-op silently — the user already saw the
 * dialog and decided not to proceed.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Calendar,
  Cog,
  LayoutDashboard,
  MapPin,
  Palette,
  Shield,
  Workflow,
  RotateCcw,
} from 'lucide-react';

import {
  GlassPanel,
  IconBox,
  Button,
  Heading,
  Text,
  HelperText,
  ConfirmDialog,
} from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useToast } from '@/components/feedback/Toast';
import {
  useResetSection,
  useResetAllSettings,
  SudoCanceledError,
  type SettingsResetResult,
} from '@/api/hooks/useSettingsReset';

interface SectionRow {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface DeniedRow {
  id: string;
  title: string;
  reason: string;
}

function useSectionRows(): SectionRow[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: 'general',
        icon: Cog,
        title: t('settingsReset.section.general.title', 'General preferences'),
        description: t(
          'settingsReset.section.general.desc',
          'Units, language, currency, timezone, and energy/gas pricing defaults.',
        ),
      },
      {
        id: 'appearance',
        icon: Palette,
        title: t('settingsReset.section.appearance.title', 'Appearance'),
        description: t(
          'settingsReset.section.appearance.desc',
          'Theme, density, chart palette, and notification badge / flash preferences.',
        ),
      },
      {
        id: 'alert_rules',
        icon: Bell,
        title: t('settingsReset.section.alertRules.title', 'Alert rules'),
        description: t(
          'settingsReset.section.alertRules.desc',
          'Delete every alert rule you have authored. Cannot be undone.',
        ),
      },
      {
        id: 'geofences',
        icon: MapPin,
        title: t('settingsReset.section.geofences.title', 'Geofences'),
        description: t(
          'settingsReset.section.geofences.desc',
          'Delete every geofence and its electricity-rate overrides. Vehicle home assignments will be cleared.',
        ),
      },
      {
        id: 'notification_channels',
        icon: Bell,
        title: t(
          'settingsReset.section.notificationChannels.title',
          'Notification channels',
        ),
        description: t(
          'settingsReset.section.notificationChannels.desc',
          'Delete every webhook, Discord, Slack, email, and push channel along with their delivery history.',
        ),
      },
      {
        id: 'dashboard_layout',
        icon: LayoutDashboard,
        title: t(
          'settingsReset.section.dashboardLayout.title',
          'Dashboard layouts',
        ),
        description: t(
          'settingsReset.section.dashboardLayout.desc',
          'Delete every saved dashboard layout preset.',
        ),
      },
      {
        id: 'automations',
        icon: Workflow,
        title: t('settingsReset.section.automations.title', 'Automations'),
        description: t(
          'settingsReset.section.automations.desc',
          'Delete every automation, including its triggers, conditions, actions, variables, and run history.',
        ),
      },
      {
        id: 'quiet_hours',
        icon: Calendar,
        title: t('settingsReset.section.quietHours.title', 'Quiet hours'),
        description: t(
          'settingsReset.section.quietHours.desc',
          'Delete every quiet-hours window for your account.',
        ),
      },
    ],
    [t],
  );
}

function useDeniedRows(): DeniedRow[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      {
        id: 'tariffs',
        title: t('settingsReset.denied.tariffs.title', 'Charge cost tariffs'),
        reason: t(
          'settingsReset.denied.tariffs.reason',
          'Tariffs are stored per-vehicle. Reset the assignment from the Vehicle Settings page on the vehicle detail screen.',
        ),
      },
      {
        id: 'sound_prefs',
        title: t(
          'settingsReset.denied.soundPrefs.title',
          'Notification sound preferences',
        ),
        reason: t(
          'settingsReset.denied.soundPrefs.reason',
          'Notification sound preferences are stored in your browser. Clear them via your browser’s site-data controls.',
        ),
      },
    ],
    [t],
  );
}

interface SectionRowItemProps {
  row: SectionRow;
  onRequestReset: (row: SectionRow) => void;
  busy: boolean;
}

function SectionRowItem({ row, onRequestReset, busy }: SectionRowItemProps) {
  const { t } = useTranslation();
  const Icon = row.icon;
  return (
    <li
      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 border-b border-[var(--border-subtle)] last:border-b-0"
      data-testid={`reset-section-row-${row.id}`}
    >
      <IconBox color="cyan" size="sm">
        <Icon className="h-4 w-4" />
      </IconBox>
      <div className="flex-1 min-w-0">
        <Heading level="sub" className="text-[var(--text-primary)]">
          {row.title}
        </Heading>
        <HelperText className="text-[var(--text-muted)]">
          {row.description}
        </HelperText>
      </div>
      <Button
        variant="ghost"
        onClick={() => onRequestReset(row)}
        disabled={busy}
        data-testid={`reset-section-button-${row.id}`}
      >
        <RotateCcw className="h-4 w-4 mr-2" />
        {t('settingsReset.actions.reset', 'Reset')}
      </Button>
    </li>
  );
}

export function ResetSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const sections = useSectionRows();
  const deniedRows = useDeniedRows();

  // Per-section confirm — we render a single ConfirmDialog whose
  // `pending` state tracks which section the user is confirming.
  const [pending, setPending] = useState<SectionRow | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);

  // The hook is keyed by section name so we re-create the mutation
  // once per pending row. Lifting the hook to top-level requires
  // passing the section as a mutate() arg, which we deliberately
  // avoid for ergonomics in the consumer (one hook per section).
  // Render-time we keep two stable mutations: one for the active
  // pending section and one for the global reset.
  const sectionMut = useResetSection(pending?.id ?? '__none__');
  const allMut = useResetAllSettings();

  const sectionBusy = sectionMut.isPending;
  const allBusy = allMut.isPending;

  const announceSuccess = (
    result: SettingsResetResult,
    fallbackTitle: string,
  ) => {
    const count = result.reset;
    toast.success(
      t('settingsReset.toasts.successTitle', fallbackTitle),
      t(
        'settingsReset.toasts.successDetail',
        '{{count}} item(s) reset across {{sections}} section(s).',
        {
          count,
          sections: result.sections.length,
        },
      ),
    );
  };

  const handleConfirmSection = async () => {
    if (!pending) return;
    try {
      const result = await sectionMut.mutateAsync();
      announceSuccess(result, 'Section reset');
    } catch (e) {
      // Non-cancel errors are toasted by useMutationToast inside
      // the hook. We only need to swallow the cancel here so the
      // dialog closes cleanly without an error toast.
      if (!(e instanceof SudoCanceledError)) {
        console.warn('[ResetSection] section reset failed', e);
      }
    } finally {
      setPending(null);
    }
  };

  const handleConfirmAll = async () => {
    try {
      const result = await allMut.mutateAsync();
      announceSuccess(result, 'All settings reset');
    } catch (e) {
      if (!(e instanceof SudoCanceledError)) {
        console.warn('[ResetSection] all-reset failed', e);
      }
    } finally {
      setResetAllOpen(false);
    }
  };

  return (
    <FadeIn delay={0.24}>
      <div className="space-y-6" data-testid="reset-section-root">
        {/* By-section panel */}
        <GlassPanel className="p-5" data-testid="reset-section-by-section">
          <div className="flex items-start gap-3 mb-4">
            <IconBox color="amber">
              <RotateCcw className="h-5 w-5" />
            </IconBox>
            <div className="flex-1 min-w-0">
              <Heading level="section" className="text-[var(--text-primary)]">
                {t('settingsReset.title', 'Reset to defaults')}
              </Heading>
              <Text variant="bodySm" className="text-[var(--text-muted)]">
                {t(
                  'settingsReset.subtitle',
                  'Restore an individual section to its default state. Each reset is destructive and cannot be undone — export your settings first if you want a backup.',
                )}
              </Text>
            </div>
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {sections.map((row) => (
              <SectionRowItem
                key={row.id}
                row={row}
                busy={sectionBusy && pending?.id === row.id}
                onRequestReset={setPending}
              />
            ))}
          </ul>
        </GlassPanel>

        {/* Deny-list / read-only panel */}
        <GlassPanel className="p-5" data-testid="reset-section-denied">
          <div className="flex items-start gap-3 mb-3">
            <IconBox color="cyan">
              <Shield className="h-5 w-5" />
            </IconBox>
            <div className="flex-1 min-w-0">
              <Heading level="panel" className="text-[var(--text-primary)]">
                {t(
                  'settingsReset.deniedTitle',
                  'Sections that aren’t user-resettable',
                )}
              </Heading>
              <Text variant="bodySm" className="text-[var(--text-muted)]">
                {t(
                  'settingsReset.deniedSubtitle',
                  'These sections live outside this server’s preference store. The Settings page can’t reset them, but the linked instructions tell you where to go.',
                )}
              </Text>
            </div>
          </div>
          <ul className="space-y-3">
            {deniedRows.map((row) => (
              <li
                key={row.id}
                className="flex items-start gap-3"
                data-testid={`reset-section-denied-row-${row.id}`}
              >
                <AlertTriangle
                  className="h-4 w-4 mt-0.5 text-amber-300 shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <Heading level="sub" className="text-[var(--text-primary)]">
                    {row.title}
                  </Heading>
                  <HelperText className="text-[var(--text-muted)]">
                    {row.reason}
                  </HelperText>
                </div>
              </li>
            ))}
          </ul>
        </GlassPanel>

        {/* Danger zone */}
        <GlassPanel
          className="p-5 border border-tesla-red/30"
          data-testid="reset-section-danger-zone"
        >
          <div className="flex items-start gap-3 mb-4">
            <IconBox color="red">
              <AlertOctagon className="h-5 w-5" />
            </IconBox>
            <div className="flex-1 min-w-0">
              <Heading level="section" className="text-[var(--text-primary)]">
                {t('settingsReset.dangerZone.title', 'Danger zone')}
              </Heading>
              <Text variant="bodySm" className="text-[var(--text-muted)]">
                {t(
                  'settingsReset.dangerZone.subtitle',
                  'Wipe every user-discoverable preference at once. Alert rules, geofences, channels, automations, dashboard layouts, and your typed preference rows are all deleted in a single transaction.',
                )}
              </Text>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <HelperText className="text-[var(--text-muted)]">
              {t(
                'settingsReset.dangerZone.help',
                'You will be asked to type RESET to confirm.',
              )}
            </HelperText>
            <Button
              variant="danger"
              onClick={() => setResetAllOpen(true)}
              disabled={allBusy}
              data-testid="reset-section-reset-all"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('settingsReset.dangerZone.cta', 'Reset ALL settings')}
            </Button>
          </div>
        </GlassPanel>

        {/* Per-section confirm dialog */}
        <ConfirmDialog
          open={pending !== null}
          variant="danger"
          loading={sectionBusy}
          title={t(
            'settingsReset.confirm.sectionTitle',
            'Reset {{name}}?',
            { name: pending?.title ?? '' },
          )}
          message={
            pending
              ? t(
                  'settingsReset.confirm.sectionMessage',
                  '{{description}} This action is permanent.',
                  { description: pending.description },
                )
              : ''
          }
          confirmLabel={t('settingsReset.confirm.confirmLabel', 'Reset')}
          cancelLabel={t('settingsReset.confirm.cancelLabel', 'Cancel')}
          onConfirm={handleConfirmSection}
          onCancel={() => setPending(null)}
        />

        {/* Danger-zone typed-confirmation dialog */}
        <ConfirmDialog
          open={resetAllOpen}
          variant="danger"
          loading={allBusy}
          title={t(
            'settingsReset.confirm.allTitle',
            'Reset every user-discoverable setting?',
          )}
          message={t(
            'settingsReset.confirm.allMessage',
            'Every alert rule, geofence, channel, automation, dashboard layout preset, and preference row will be permanently deleted. This cannot be undone.',
          )}
          confirmLabel={t('settingsReset.confirm.allConfirmLabel', 'Reset everything')}
          cancelLabel={t('settingsReset.confirm.cancelLabel', 'Cancel')}
          requireTypedConfirmation="RESET"
          typedConfirmationLabel={t(
            'settingsReset.confirm.typedLabel',
            'Type RESET to confirm',
          )}
          onConfirm={handleConfirmAll}
          onCancel={() => setResetAllOpen(false)}
        />
      </div>
    </FadeIn>
  );
}

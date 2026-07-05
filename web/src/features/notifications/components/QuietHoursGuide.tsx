/**
 * QuietHoursGuide — static "how it works" context panel for the Quiet hours
 * page right rail. Explains the deferral model and the severity vocabulary the
 * CRUD form uses, so the bento fills the width on desktop without a dead
 * column. No data dependency — purely presentational and i18n-driven.
 */

import { useTranslation } from 'react-i18next';
import { useId, type ReactNode } from 'react';
import { Info, Moon, ShieldCheck, Sparkles } from 'lucide-react';
import { GlassPanel, IconBox, PanelTitle, Badge, Text } from '@/components/ui';
import type { BadgeProps } from '@/components/ui';

interface GuideStep {
  key: string;
  icon: ReactNode;
  text: string;
}

interface SeverityRow {
  key: string;
  variant: BadgeProps['variant'];
  label: string;
  desc: string;
}

export function QuietHoursGuide() {
  const { t } = useTranslation();
  // Stable ids so the panel exposes itself as a labelled region and the
  // severity legend's list is programmatically tied to its (non-heading)
  // caption — both improve screen-reader navigation of this static panel.
  const titleId = useId();
  const severityTitleId = useId();

  const steps: GuideStep[] = [
    {
      key: 'defer',
      icon: <Moon className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'notifications.quietHours.guide.stepDefer',
        'Each window mutes non-critical notifications during a local-time range on the weekdays you pick.',
      ),
    },
    {
      key: 'bypass',
      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'notifications.quietHours.guide.stepBypass',
        'Severities on the "always allow" list still break through, so you never miss a critical alert.',
      ),
    },
    {
      key: 'helix',
      icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'notifications.quietHours.guide.stepHelix',
        'Helix can propose a window from your recent history — review it, then save to apply.',
      ),
    },
  ];

  const severities: SeverityRow[] = [
    {
      key: 'critical',
      variant: 'danger',
      label: t('notifications.quietHours.guide.severityCritical', 'Critical'),
      desc: t('notifications.quietHours.guide.severityCriticalDesc', 'Urgent — usually always allowed.'),
    },
    {
      key: 'warn',
      variant: 'warning',
      label: t('notifications.quietHours.guide.severityWarn', 'Warning'),
      desc: t('notifications.quietHours.guide.severityWarnDesc', 'Notable, non-urgent events.'),
    },
    {
      key: 'info',
      variant: 'info',
      label: t('notifications.quietHours.guide.severityInfo', 'Info'),
      desc: t('notifications.quietHours.guide.severityInfoDesc', 'Routine status updates.'),
    },
  ];

  return (
    <GlassPanel role="region" aria-labelledby={titleId} className="space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <IconBox color="purple">
          <Info className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div className="min-w-0">
          <PanelTitle id={titleId}>{t('notifications.quietHours.guide.title', 'How quiet hours work')}</PanelTitle>
          <Text as="p" variant="caption">
            {t('notifications.quietHours.guide.subtitle', 'Defer non-critical alerts on your own schedule.')}
          </Text>
        </div>
      </div>

      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 text-[var(--text-muted)]">{step.icon}</span>
            <Text as="p" variant="bodySm">
              {step.text}
            </Text>
          </li>
        ))}
      </ul>

      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
        <Text as="p" variant="label" id={severityTitleId}>
          {t('notifications.quietHours.guide.severityTitle', 'Severity levels')}
        </Text>
        <ul className="space-y-2" aria-labelledby={severityTitleId}>
          {severities.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <Badge variant={row.variant} size="sm" className="shrink-0">
                {row.label}
              </Badge>
              <Text as="span" variant="bodySm">
                {row.desc}
              </Text>
            </li>
          ))}
        </ul>
      </div>
    </GlassPanel>
  );
}

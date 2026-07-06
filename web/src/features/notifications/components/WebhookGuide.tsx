/**
 * WebhookGuide — static "how it works" context panel for the Webhooks page
 * right rail. Explains the HMAC-signing + delivery model and lists the delivery
 * reference (signature header, algorithm, methods) and JSON payload fields the
 * receiver gets, so the bento fills the width on desktop without a dead column.
 * No data dependency — purely presentational and i18n-driven.
 */

import { useTranslation } from 'react-i18next';
import { useId, type ReactNode } from 'react';
import { Info, Send, ShieldCheck, Webhook } from 'lucide-react';
import { Badge, Code, GlassPanel, IconBox, PanelTitle, Text } from '@/components/ui';

interface GuideStep {
  key: string;
  icon: ReactNode;
  text: string;
}

interface ReferenceRow {
  key: string;
  label: string;
  value: string;
}

interface PayloadField {
  key: string;
  field: string;
  desc: string;
}

export function WebhookGuide() {
  const { t } = useTranslation();

  // Stable ids so the panel is a properly named landmark and each labelled
  // sub-list is announced with its heading text by assistive technology.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const referenceLabelId = `${baseId}-reference`;
  const payloadLabelId = `${baseId}-payload`;

  const steps: GuideStep[] = [
    {
      key: 'sign',
      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'notifications.webhooks.guide.stepSign',
        'Every payload is HMAC-SHA256 signed and sent in the X-TeslaSync-Signature header so receivers can verify authenticity.',
      ),
    },
    {
      key: 'deliver',
      icon: <Webhook className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'notifications.webhooks.guide.stepDeliver',
        'TeslaSync POSTs a compact JSON envelope on each event; failed deliveries are retried with backoff.',
      ),
    },
    {
      key: 'verify',
      icon: <Send className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'notifications.webhooks.guide.stepVerify',
        'Use Test on any endpoint to fire a sample event and preview the signature before you rely on it.',
      ),
    },
  ];

  const reference: ReferenceRow[] = [
    {
      key: 'header',
      label: t('notifications.webhooks.guide.refHeader', 'Signature header'),
      value: 'X-TeslaSync-Signature',
    },
    {
      key: 'algo',
      label: t('notifications.webhooks.guide.refAlgo', 'Algorithm'),
      value: 'HMAC-SHA256 · sha256=…',
    },
    {
      key: 'methods',
      label: t('notifications.webhooks.guide.refMethods', 'Methods'),
      value: 'POST · PUT · PATCH',
    },
  ];

  const payload: PayloadField[] = [
    {
      key: 'title',
      field: 'title',
      desc: t('notifications.webhooks.guide.payloadTitle', 'Short event headline.'),
    },
    {
      key: 'message',
      field: 'message',
      desc: t('notifications.webhooks.guide.payloadMessage', 'Long-form event body.'),
    },
    {
      key: 'source',
      field: 'source',
      desc: t('notifications.webhooks.guide.payloadSource', 'Always "teslasync".'),
    },
    {
      key: 'timestamp',
      field: 'timestamp',
      desc: t('notifications.webhooks.guide.payloadTimestamp', 'RFC3339 server time.'),
    },
  ];

  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5" role="region" aria-labelledby={titleId}>
      <div className="flex items-center gap-3">
        <IconBox color="cyan">
          <Info className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div className="min-w-0">
          <PanelTitle id={titleId}>{t('notifications.webhooks.guide.title', 'How webhooks work')}</PanelTitle>
          <Text as="p" variant="caption">
            {t('notifications.webhooks.guide.subtitle', 'Forward events to any HTTP receiver, signed and verifiable.')}
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
        <Text as="p" variant="label" id={referenceLabelId}>
          {t('notifications.webhooks.guide.referenceTitle', 'Delivery reference')}
        </Text>
        <ul className="space-y-2" aria-labelledby={referenceLabelId}>
          {reference.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center justify-between gap-2">
              <Text as="span" variant="bodySm">
                {row.label}
              </Text>
              <Code className="break-all">{row.value}</Code>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
        <Text as="p" variant="label" id={payloadLabelId}>
          {t('notifications.webhooks.guide.payloadTitleLabel', 'Payload fields')}
        </Text>
        <ul className="space-y-2" aria-labelledby={payloadLabelId}>
          {payload.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <Badge variant="info" size="sm" className="shrink-0">
                {row.field}
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

import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import {
  SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES,
  SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS,
} from '../lib/serviceEvidencePack';

export interface ServiceEvidencePrivacyPanelProps {
  className?: string;
}

/**
 * Static privacy-manifest panel: exactly which vehicle fields the pack
 * includes (id + display name only) and the representative categories of
 * sensitive data it never includes (VIN, coordinates, address, tokens, raw
 * location history, ...). Content is derived from the same exported
 * constants `buildServiceEvidencePackCore` uses to populate the pack's own
 * `privacy` block, so this panel can never drift from what actually ships.
 */
export function ServiceEvidencePrivacyPanel({ className }: ServiceEvidencePrivacyPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceEvidencePack.privacy.title', 'Privacy Manifest')}
      </PanelTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="body" weight="semibold" className="mb-1.5 block">
            {t('serviceEvidencePack.privacy.includedTitle', 'Included')}
          </Text>
          <ul className="list-disc space-y-1 pl-5">
            {SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS.map((field) => (
              <li key={field}>
                <Caption>{field}</Caption>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text variant="body" weight="semibold" className="mb-1.5 block">
            {t('serviceEvidencePack.privacy.excludedTitle', 'Never included')}
          </Text>
          <ul className="list-disc space-y-1 pl-5">
            {SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES.map((field) => (
              <li key={field}>
                <Caption>{field}</Caption>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Text variant="bodySm" as="p" className="mt-3">
        {t(
          'serviceEvidencePack.privacy.notes',
          'This pack references the vehicle by its numeric id and display name only. Signal evidence is limited to statistical summaries — raw telemetry payloads are never embedded.',
        )}
      </Text>
    </GlassPanel>
  );
}

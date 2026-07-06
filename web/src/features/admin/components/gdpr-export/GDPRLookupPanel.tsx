import { useTranslation } from 'react-i18next';
import { Search, Info } from 'lucide-react';

import { GlassPanel, Button, Input } from '@/components/ui';
import { PanelTitle, Caption, Text } from '@/components/ui/Typography';

interface GDPRLookupPanelProps {
  idInput: string;
  onIdChange: (value: string) => void;
  onLookup: () => void;
}

/**
 * Artifact-ID lookup form. Full-width panel; the form itself is a
 * constrained reading column for legibility while an adjacent hint fills
 * the remaining width on large screens.
 */
export function GDPRLookupPanel({ idInput, onIdChange, onLookup }: GDPRLookupPanelProps) {
  const { t } = useTranslation();

  // A single source of truth for "is there something to look up?". Both the
  // button's disabled state AND the Enter-key shortcut gate on this so the two
  // activation paths stay consistent (previously Enter fired even when the
  // button was disabled). `?? ''` keeps the control safe if a caller ever
  // passes an undefined value.
  const trimmedId = (idInput ?? '').trim();

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-4">{t('admin.gdprExport.lookupTitle', 'Lookup artifact')}</PanelTitle>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-8">
        <div className="max-w-2xl">
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label={t('admin.gdprExport.idLabel', 'Artifact ID')}
                placeholder={t('admin.gdprExport.idPlaceholder', 'e.g. 8f4c…')}
                value={idInput ?? ''}
                onChange={(e) => onIdChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && trimmedId) onLookup();
                }}
              />
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={onLookup}
              disabled={!trimmedId}
              className="min-h-11 sm:w-auto"
            >
              <Search className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('admin.gdprExport.lookupButton', 'Look up')}
            </Button>
          </div>
          <Caption className="mt-2">
            {t(
              'admin.gdprExport.lookupHint',
              'IDs come from the GDPR export queue email or the request response. The artifact polls while queued/running.',
            )}
          </Caption>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-[var(--glass-border)] bg-white/[0.02] p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
          <Text variant="bodySm">
            {t(
              'admin.gdprExport.lookupBlurb',
              'Bundles are streamed straight from the backend and expire after the configured retention window. Look one up to track its status live.',
            )}
          </Text>
        </div>
      </div>
    </GlassPanel>
  );
}

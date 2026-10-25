import { useTranslation } from 'react-i18next';
import { Search, Info } from 'lucide-react';

import { GlassPanel, Button, Input, PanelTitle, Caption, Text } from '@/components/ui';

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
              'Enter an artifact ID to look up its saved metadata. Use Refresh to request an updated snapshot; this page does not poll automatically.',
            )}
          </Caption>
        </div>

        <div className="flex items-start gap-2 rounded-panel border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
          <Text variant="bodySm">
            {t(
              'admin.gdprExport.lookupBlurb',
              'Lookup and Refresh only read artifact metadata; they do not create exports or download bundles. Bundles expire after the configured retention window. A saved manifest does not confirm current download availability or storage support.',
            )}
          </Text>
        </div>
      </div>
    </GlassPanel>
  );
}

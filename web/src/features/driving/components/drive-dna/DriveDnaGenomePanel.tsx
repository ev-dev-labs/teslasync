import {
  Download,
  Gauge,
  Leaf,
  Mountain,
  Snowflake,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KVList, type KVItem } from '@/components/data-display';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type {
  DriveDnaModel,
  DriveDnaTraitId,
} from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import { downloadDriveDnaSvg } from './driveDnaSvg';
import type { DriveDnaSectionState } from './types';

const TRAIT_ICONS = {
  spirited: Gauge,
  gentle: Leaf,
  mountainous: Mountain,
  'regen-observed': Leaf,
  'cold-start': Snowflake,
  'low-demand': Leaf,
  balanced: Sparkles,
} as const;

interface DriveDnaGenomePanelProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  driveLabel: string;
  units: UseUnitsResult;
}

export function DriveDnaGenomePanel({
  model,
  state,
  driveLabel,
  units,
}: DriveDnaGenomePanelProps) {
  const { t } = useTranslation();
  const canDownload =
    state.telemetry.isResolved && model.genome.petals.length > 0;
  const traitLabel = (id: DriveDnaTraitId): string => {
    switch (id) {
      case 'spirited':
        return t('driveDna.traits.spirited', 'Spirited-speed pattern');
      case 'gentle':
        return t('driveDna.traits.gentle', 'Gentle-speed pattern');
      case 'mountainous':
        return t('driveDna.traits.mountainous', 'Mountain elevation pattern');
      case 'regen-observed':
        return t(
          'driveDna.traits.regenObserved',
          'Regen-observed emissions',
        );
      case 'cold-start':
        return t('driveDna.traits.coldStart', 'Cold-start context');
      case 'low-demand':
        return t('driveDna.traits.lowDemand', 'Low-demand power pattern');
      case 'balanced':
        return t('driveDna.traits.balanced', 'Balanced observed pattern');
    }
  };
  const stats: KVItem[] = [
    {
      label: t('driveDna.genome.validRows', 'Valid timestamp rows'),
      value: fmtInt(model.sample.validRows),
    },
    {
      label: t('driveDna.genome.encodedPetals', 'Encoded petals'),
      value: fmtInt(model.genome.encodedPointCount),
    },
    {
      label: t('driveDna.genome.medianSpeed', 'Sampled median speed'),
      value: units.formatSpeed(model.stats.medianSpeedMps, { precision: 1 }),
    },
    {
      label: t('driveDna.genome.peakRegen', 'Peak regen magnitude'),
      value: units.formatPower(model.stats.peakRegenW, { precision: 1 }),
    },
    {
      label: t('driveDna.genome.climb', 'Positive measured climb'),
      value:
        model.stats.positiveElevationClimbM != null
          ? t('driveDna.genome.metres', '{{value}} m', {
              value: fmtNumber(model.stats.positiveElevationClimbM, 0),
            })
          : '—',
    },
  ];

  return (
    <section
      aria-label={t(
        'driveDna.genome.sectionAria',
        'Genome identity and export',
      )}
      data-testid="drive-dna-genome"
      className="h-full"
    >
      <GlassPanel className="flex h-full flex-col p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.genome.title', 'Genome identity')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'driveDna.genome.subtitle',
            'The signature and traits are reproducible artistic encodings of this returned telemetry—not a driving grade.',
          )}
        </Text>

        <DriveDnaSectionBody
          state={state}
          validRows={model.sample.validRows}
          returnedRows={model.sample.returnedRows}
          className="mt-4"
        >
          <div className="flex items-center gap-2 font-mono text-xl tabular-nums text-cyan-300">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <Text as="span" mono weight="bold">
              {model.genome.signature}
            </Text>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {model.genome.traits.length > 0 ? (
              model.genome.traits.map((entry) => {
                const Icon = TRAIT_ICONS[entry.id];
                return (
                  <Badge key={entry.id} variant="info">
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    {traitLabel(entry.id)}
                  </Badge>
                );
              })
            ) : (
              <Text as="p" variant="caption">
                {t(
                  'driveDna.genome.noTraits',
                  'No artistic trait was assigned; unavailable speed or power never creates a substitute trait.',
                )}
              </Text>
            )}
          </div>

          <KVList items={stats} columns={1} className="mt-4" />
        </DriveDnaSectionBody>

        <Button
          type="button"
          variant="secondary"
          className="mt-4 w-full"
          disabled={!canDownload}
          onClick={() => downloadDriveDnaSvg(model.genome, driveLabel)}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {t('driveDna.genome.download', 'Download safe SVG')}
        </Button>
      </GlassPanel>
    </section>
  );
}

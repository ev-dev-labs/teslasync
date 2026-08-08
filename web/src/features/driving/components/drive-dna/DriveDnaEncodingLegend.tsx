import type { ReactNode } from 'react';
import { BatteryMedium, Gauge, Mountain, Route, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type {
  DriveDnaEncodingDimension,
  DriveDnaModel,
} from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import type { DriveDnaSectionState } from './types';

const ENCODING_COLUMNS = { default: 1, sm: 2, xl: 5 } as const;

interface DriveDnaEncodingLegendProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
}

interface EncodingRow {
  title: string;
  influence: string;
  evidence: string;
  icon: ReactNode;
  dimension: DriveDnaEncodingDimension;
}

export function DriveDnaEncodingLegend({
  model,
  state,
  units,
}: DriveDnaEncodingLegendProps) {
  const { t } = useTranslation();
  const range = (
    dimension: DriveDnaEncodingDimension,
    format: (value: number) => string,
  ): string =>
    dimension.canonicalMin != null && dimension.canonicalMax != null
      ? t('driveDna.encoding.range', '{{min}} to {{max}}', {
          min: format(dimension.canonicalMin),
          max: format(dimension.canonicalMax),
        })
      : t('driveDna.encoding.noRange', 'No available range');
  const normalized = (dimension: DriveDnaEncodingDimension): string =>
    dimension.normalizedMin != null && dimension.normalizedMax != null
      ? t(
          'driveDna.encoding.normalizedRange',
          'Normalized {{min}}–{{max}}',
          {
            min: fmtNumber(dimension.normalizedMin, 2),
            max: fmtNumber(dimension.normalizedMax, 2),
          },
        )
      : t('driveDna.encoding.noNormalizedRange', 'No normalized range');
  const availability = (count: number): {
    label: string;
    variant: 'success' | 'warning' | 'neutral';
  } => {
    if (count === 0) {
      return {
        label: t('driveDna.encoding.unavailable', 'Unavailable'),
        variant: 'neutral',
      };
    }
    if (count === model.sample.validRows) {
      return {
        label: t('driveDna.encoding.available', 'Available'),
        variant: 'success',
      };
    }
    return {
      label: t('driveDna.encoding.partial', 'Partial'),
      variant: 'warning',
    };
  };
  const rows: EncodingRow[] = [
    {
      title: t('driveDna.encoding.progressTitle', 'Journey progress'),
      influence: t('driveDna.encoding.progressEffect', 'Petal angle and opacity'),
      evidence: t(
        'driveDna.encoding.progressEvidence',
        '{{value}} valid timestamp rows',
        { value: fmtInt(model.sample.validRows) },
      ),
      icon: <Route className="h-4 w-4" aria-hidden="true" />,
      dimension: model.dimensions.journeyProgress,
    },
    {
      title: t('driveDna.encoding.speedTitle', 'Speed'),
      influence: t('driveDna.encoding.speedEffect', 'Petal radius'),
      evidence: range(model.dimensions.speed, (value) =>
        units.formatSpeed(value, { precision: 1 })),
      icon: <Gauge className="h-4 w-4" aria-hidden="true" />,
      dimension: model.dimensions.speed,
    },
    {
      title: t('driveDna.encoding.powerTitle', 'Pack power'),
      influence: t('driveDna.encoding.powerEffect', 'Hue and stroke width'),
      evidence: range(model.dimensions.power, (value) =>
        units.formatPower(value, { precision: 1 })),
      icon: <Zap className="h-4 w-4" aria-hidden="true" />,
      dimension: model.dimensions.power,
    },
    {
      title: t('driveDna.encoding.socTitle', 'State of charge'),
      influence: t('driveDna.encoding.socEffect', 'Petal lightness'),
      evidence: range(
        model.dimensions.soc,
        (value) => `${fmtNumber(value, 1)}%`,
      ),
      icon: <BatteryMedium className="h-4 w-4" aria-hidden="true" />,
      dimension: model.dimensions.soc,
    },
    {
      title: t('driveDna.encoding.elevationTitle', 'Elevation'),
      influence: t('driveDna.encoding.elevationEffect', 'Terrain rings'),
      evidence: range(
        model.dimensions.elevation,
        (value) =>
          t('driveDna.encoding.metres', '{{value}} m', {
            value: fmtNumber(value, 0),
          }),
      ),
      icon: <Mountain className="h-4 w-4" aria-hidden="true" />,
      dimension: model.dimensions.elevation,
    },
  ];

  return (
    <section
      aria-label={t(
        'driveDna.encoding.sectionAria',
        'Fingerprint encoding evidence',
      )}
      data-testid="drive-dna-encoding"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.encoding.title', 'Encoding legend & evidence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'driveDna.encoding.subtitle',
            'Each available channel is normalized only for artwork geometry; canonical measurements remain unchanged in the analytical model.',
          )}
        </Text>
        <DriveDnaSectionBody
          state={state}
          validRows={model.sample.validRows}
          returnedRows={model.sample.returnedRows}
          className="mt-4"
        >
          <Grid cols={ENCODING_COLUMNS} gap={3}>
            {rows.map((row) => {
              const status = availability(row.dimension.availableCount);
              return (
                <div
                  key={row.title}
                  className="rounded-xl border border-white/[0.05] bg-white/[0.025] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-cyan-300">{row.icon}</div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <MetricValue className="mt-3 text-base">{row.title}</MetricValue>
                  <MetricLabel className="mt-1">{row.influence}</MetricLabel>
                  <Text as="p" variant="caption" className="mt-3">
                    {row.evidence}
                  </Text>
                  <Text as="p" variant="caption" className="mt-1">
                    {normalized(row.dimension)}
                  </Text>
                </div>
              );
            })}
          </Grid>
        </DriveDnaSectionBody>
      </GlassPanel>
    </section>
  );
}

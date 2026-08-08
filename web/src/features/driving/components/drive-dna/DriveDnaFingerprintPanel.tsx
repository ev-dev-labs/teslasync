import { Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';

import {
  DNA_CENTER,
  DNA_VIEWBOX,
  petalLine,
  type DriveDnaModel,
} from '../../lib/driveDNA';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import type { DriveDnaSectionState } from './types';

interface DriveDnaFingerprintPanelProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
}

export function DriveDnaFingerprintPanel({
  model,
  state,
}: DriveDnaFingerprintPanelProps) {
  const { t } = useTranslation();
  const hasNeutralSpeed = model.coverage.speed.availableCount === 0;
  const hasNeutralPower = model.coverage.power.availableCount === 0;

  return (
    <section
      aria-label={t(
        'driveDna.fingerprint.sectionAria',
        'Deterministic fingerprint artwork',
      )}
      data-testid="drive-dna-fingerprint"
      className="h-full"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.fingerprint.title', 'Emission fingerprint')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'driveDna.fingerprint.subtitle',
            'A deterministic visual encoding of observed telemetry emissions—not a score or personality assessment.',
          )}
        </Text>

        <DriveDnaSectionBody
          state={state}
          validRows={model.sample.validRows}
          returnedRows={model.sample.returnedRows}
          className="mt-4 flex flex-col items-center justify-center"
          skeletonHeight={380}
        >
          <svg
            viewBox={`0 0 ${DNA_VIEWBOX} ${DNA_VIEWBOX}`}
            className="h-auto max-h-[430px] w-full max-w-[430px] rounded-2xl"
            role="img"
            aria-label={t(
              'driveDna.fingerprint.artAlt',
              'Drive DNA deterministic emission artwork, signature {{signature}}',
              { signature: model.genome.signature },
            )}
          >
            <rect
              width={DNA_VIEWBOX}
              height={DNA_VIEWBOX}
              rx={3}
              fill={model.genome.haloColor}
            />
            <circle
              cx={DNA_CENTER}
              cy={DNA_CENTER}
              r={DNA_CENTER - 2}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={0.5}
            />
            {model.genome.rings.map((ring, index) => (
              <circle
                key={`ring-${index}`}
                cx={DNA_CENTER}
                cy={DNA_CENTER}
                r={ring.r}
                fill="none"
                stroke={ring.color}
                strokeWidth={0.4}
              />
            ))}
            {model.genome.petals.map((petal, index) => {
              const line = petalLine(petal);
              return (
                <line
                  key={`petal-${index}`}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={petal.color}
                  strokeWidth={petal.width}
                  strokeLinecap="round"
                  opacity={petal.opacity}
                />
              );
            })}
          </svg>

          {hasNeutralSpeed || hasNeutralPower ? (
            <AlertBanner className="mt-4 w-full" variant="info">
              <Text as="p" variant="caption">
                {t(
                  'driveDna.fingerprint.neutralChannels',
                  'Unavailable speed or power channels use neutral geometry and color; they are not encoded as measured zero.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
          {model.genome.sourcePointCount > model.genome.encodedPointCount ? (
            <Text as="p" variant="caption" className="mt-3 text-center">
              {t(
                'driveDna.fingerprint.artBound',
                'Artwork uses {{encoded}} deterministic representative emissions from {{source}} valid rows; the signature uses all valid rows.',
                {
                  encoded: model.genome.encodedPointCount,
                  source: model.genome.sourcePointCount,
                },
              )}
            </Text>
          ) : null}
        </DriveDnaSectionBody>
      </GlassPanel>
    </section>
  );
}

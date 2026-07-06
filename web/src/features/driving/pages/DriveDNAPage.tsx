import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Download, Gauge, Mountain, Snowflake, Leaf, Fingerprint } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Button, Badge, Select } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useDrives, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';

import {
  generateDriveDNA,
  petalLine,
  DNA_VIEWBOX,
  DNA_CENTER,
  type DriveGenome,
} from '../lib/driveDNA';

const TRAIT_ICON: Record<string, typeof Gauge> = {
  Spirited: Gauge,
  Gentle: Leaf,
  Mountainous: Mountain,
  'Regen-rich': Leaf,
  'Cold-start': Snowflake,
  Efficient: Leaf,
  Balanced: Sparkles,
};

/** Build a standalone, downloadable SVG document string from a genome. */
function genomeToSvg(g: DriveGenome, label: string): string {
  const rings = g.rings
    .map((r) => `<circle cx="${DNA_CENTER}" cy="${DNA_CENTER}" r="${r.r.toFixed(2)}" fill="none" stroke="${r.color}" stroke-width="0.4"/>`)
    .join('');
  const petals = g.petals
    .map((p) => {
      const l = petalLine(p);
      return `<line x1="${l.x1.toFixed(2)}" y1="${l.y1.toFixed(2)}" x2="${l.x2.toFixed(2)}" y2="${l.y2.toFixed(2)}" stroke="${p.color}" stroke-width="${p.width.toFixed(2)}" stroke-linecap="round" opacity="${p.opacity.toFixed(2)}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DNA_VIEWBOX} ${DNA_VIEWBOX}" width="512" height="512">`
    + `<rect width="${DNA_VIEWBOX}" height="${DNA_VIEWBOX}" fill="${g.haloColor}"/>`
    + `<circle cx="${DNA_CENTER}" cy="${DNA_CENTER}" r="${DNA_CENTER - 2}" fill="none" stroke="${g.haloColor}" stroke-width="1"/>`
    + rings + petals
    + `<text x="${DNA_CENTER}" y="${DNA_VIEWBOX - 4}" fill="rgba(255,255,255,0.5)" font-size="3.2" text-anchor="middle" font-family="monospace">${label} · ${g.signature}</text>`
    + `</svg>`;
}

export default function DriveDNAPage() {
  const { t } = useTranslation();
  usePageTitle(t('driveDna.title', 'Drive DNA'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const drivesQuery = useDrives(vehicleIdStr);
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const [selectedId, setSelectedId] = useState<string>('');
  const activeId = selectedId || (drives[0] ? String(drives[0].id) : '');

  const telemetryQuery = useDriveTelemetry(activeId);
  const genome = useMemo(() => generateDriveDNA(telemetryQuery.data), [telemetryQuery.data]);

  const driveOptions = useMemo(
    () =>
      drives.map((d) => ({
        value: String(d.id),
        label: `${formatDateShort(d.startTs)} · ${(d.distanceM / 1000).toFixed(1)} km`,
      })),
    [drives],
  );

  const activeDrive = drives.find((d) => String(d.id) === activeId);
  const label = activeDrive ? formatDateShort(activeDrive.startTs) : t('driveDna.title', 'Drive DNA');

  function handleDownload() {
    if (!genome.petals.length) return;
    const svg = genomeToSvg(genome, label);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drive-dna-${genome.signature}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <PageContainer title={t('driveDna.title', 'Drive DNA')}>
      <FadeIn>
        <GlassPanel className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <PanelTitle><Fingerprint size={16} className="mr-1 inline text-cyan-400" aria-hidden /> {t('driveDna.heading', 'Generative telemetry art')}</PanelTitle>
              <Text variant="bodySm" className="text-white/60">
                {t(
                  'driveDna.blurb',
                  'Every drive has a unique signature. This bloom encodes speed, power flow, elevation and battery into a reproducible fingerprint.',
                )}
              </Text>
            </div>
            <div className="flex items-center gap-2">
              <VehicleSelect />
              {driveOptions.length > 0 && (
                <Select
                  aria-label={t('driveDna.pickDrive', 'Choose a drive')}
                  value={activeId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  options={driveOptions}
                />
              )}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Art */}
        <FadeIn className="lg:col-span-2">
          <GlassPanel className="flex min-h-[420px] items-center justify-center">
            {drivesQuery.isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : telemetryQuery.isError ? (
              <QueryError error={telemetryQuery.error} onRetry={() => telemetryQuery.refetch()} />
            ) : drivesQuery.isLoading || telemetryQuery.isLoading ? (
              <Skeleton className="h-[380px] w-[380px] rounded-full" />
            ) : !activeId ? (
              <EmptyState message={t('driveDna.noDrives', 'No drives found for this vehicle yet.')} />
            ) : genome.petals.length === 0 ? (
              <EmptyState message={t('driveDna.noTelemetry', 'This drive has no telemetry to synthesize.')} />
            ) : (
              <svg
                viewBox={`0 0 ${DNA_VIEWBOX} ${DNA_VIEWBOX}`}
                className="h-[380px] w-[380px] rounded-xl"
                style={{ background: genome.haloColor }}
                role="img"
                aria-label={t('driveDna.artAlt', 'Drive DNA visualization, signature {{sig}}', { sig: genome.signature })}
              >
                {genome.rings.map((r, i) => (
                  <circle key={`ring-${i}`} cx={DNA_CENTER} cy={DNA_CENTER} r={r.r} fill="none" stroke={r.color} strokeWidth={0.4} />
                ))}
                {genome.petals.map((p, i) => {
                  const l = petalLine(p);
                  return (
                    <line
                      key={`petal-${i}`}
                      x1={l.x1}
                      y1={l.y1}
                      x2={l.x2}
                      y2={l.y2}
                      stroke={p.color}
                      strokeWidth={p.width}
                      strokeLinecap="round"
                      opacity={p.opacity}
                    />
                  );
                })}
              </svg>
            )}
          </GlassPanel>
        </FadeIn>

        {/* Genome panel */}
        <FadeIn>
          <GlassPanel className="flex h-full flex-col gap-4">
            <div>
              <PanelTitle><Sparkles size={16} className="mr-1 inline text-cyan-400" aria-hidden /> {t('driveDna.genome', 'Genome')}</PanelTitle>
              <div className="mt-2 flex items-center gap-2 font-mono text-lg text-cyan-300">
                <Fingerprint size={18} className="text-cyan-400" aria-hidden />
                {genome.signature}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {genome.traits.map((trait) => {
                const Icon = TRAIT_ICON[trait] ?? Sparkles;
                return (
                  <Badge key={trait} variant="info">
                    <Icon size={12} aria-hidden /> {trait}
                  </Badge>
                );
              })}
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-white/50">{t('driveDna.samples', 'Samples')}</dt>
                <dd className="text-white/90">{genome.stats.points}</dd>
              </div>
              <div>
                <dt className="text-white/50">{t('driveDna.topSpeed', 'Top speed')}</dt>
                <dd className="text-white/90">
                  {genome.stats.topSpeedKph != null ? `${genome.stats.topSpeedKph} km/h` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-white/50">{t('driveDna.climb', 'Elevation climb')}</dt>
                <dd className="text-white/90">{genome.stats.climbM != null ? `${genome.stats.climbM} m` : '—'}</dd>
              </div>
              <div>
                <dt className="text-white/50">{t('driveDna.regen', 'Regen share')}</dt>
                <dd className="text-white/90">
                  {genome.stats.regenShare != null ? `${Math.round(genome.stats.regenShare * 100)}%` : '—'}
                </dd>
              </div>
            </dl>

            <div className="mt-auto">
              <Button
                variant="secondary"
                onClick={handleDownload}
                disabled={genome.petals.length === 0}
                className="w-full"
              >
                <Download size={16} aria-hidden /> {t('driveDna.download', 'Download SVG')}
              </Button>
            </div>
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  );
}

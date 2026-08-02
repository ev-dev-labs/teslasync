import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Download, Gauge, Mountain, Snowflake, Leaf, Fingerprint } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Button, Badge, Select } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { KVList, type KVItem } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useDrives, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
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

/**
 * i18n keys for the trait vocabulary emitted by `generateDriveDNA`.
 *
 * The model returns stable English identifiers (they double as the `TRAIT_ICON`
 * lookup and as part of the shareable genome), so translation happens here at
 * the display boundary rather than in the lib.
 */
const TRAIT_I18N: Record<string, string> = {
  Spirited: 'driveDna.traitSpirited',
  Gentle: 'driveDna.traitGentle',
  Mountainous: 'driveDna.traitMountainous',
  'Regen-rich': 'driveDna.traitRegenRich',
  'Cold-start': 'driveDna.traitColdStart',
  Efficient: 'driveDna.traitEfficient',
  Balanced: 'driveDna.traitBalanced',
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
  // The exported artwork is a self-contained document with its own dark halo
  // background, so its caption colour is intentionally a literal white alpha —
  // it is not themed by the app and must stay legible standalone.
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
  const { formatDistance, formatSpeed } = useUnits();

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
        label: `${formatDateShort(d.startTs)} · ${formatDistance(d.distanceM, { precision: 1 })}`,
      })),
    [drives, formatDistance],
  );

  const activeDrive = drives.find((d) => String(d.id) === activeId);
  const label = activeDrive ? formatDateShort(activeDrive.startTs) : t('driveDna.title', 'Drive DNA');

  const genomeStats = useMemo<KVItem[]>(
    () => [
      {
        label: t('driveDna.samples', 'Samples'),
        value: genome.stats.points,
      },
      {
        label: t('driveDna.topSpeed', 'Top speed'),
        value:
          genome.stats.topSpeedKph != null
            // The model reports km/h; the shared formatters take SI. Divide back
            // to m/s at the display boundary so the value honours the user's
            // speed preference (mph / km/h) like every other page.
            ? formatSpeed(genome.stats.topSpeedKph / 3.6, { precision: 0 })
            : '—',
      },
      {
        // Elevation climb stays in metres — there is no elevation formatter, and
        // routing it through `formatDistance` would render a 150 m climb as
        // "0.2 km". Vertical gain is conventionally read in metres here.
        label: t('driveDna.climb', 'Elevation climb'),
        value: genome.stats.climbM != null ? `${genome.stats.climbM} m` : '—',
      },
      {
        label: t('driveDna.regen', 'Regen share'),
        value:
          genome.stats.regenShare != null
            ? `${Math.round(genome.stats.regenShare * 100)}%`
            : '—',
      },
    ],
    [genome.stats, t, formatSpeed],
  );

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

  const loading = drivesQuery.isLoading || telemetryQuery.isLoading;

  return (
    <PageContainer
      title={t('driveDna.title', 'Drive DNA')}
      subtitle={t('driveDna.subtitle', 'A generative fingerprint synthesized from one drive')}
      query={[drivesQuery, telemetryQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
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
      }
    >
      <FadeIn>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Art */}
          <GlassPanel className="flex min-h-[420px] items-center justify-center p-4 sm:p-5 xl:col-span-2">
            {drivesQuery.isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : telemetryQuery.isError ? (
              <QueryError error={telemetryQuery.error} onRetry={() => telemetryQuery.refetch()} />
            ) : loading ? (
              <Skeleton height={380} width="380px" className="rounded-full" />
            ) : !activeId ? (
              <EmptyState
                icon={<Fingerprint className="h-8 w-8" />}
                message={t('driveDna.noDrives', 'No drives found for this vehicle yet.')}
                actionTo={{ label: t('driveDna.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : genome.petals.length === 0 ? (
              <EmptyState /* no-action: nothing the user can do — this drive was imported without telemetry samples. The drive picker in the header is the recovery surface. */
                icon={<Fingerprint className="h-8 w-8" />}
                message={t('driveDna.noTelemetry', 'This drive has no telemetry to synthesize.')}
              />
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

          {/* Genome panel */}
          <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5 xl:col-span-1">
            <div>
              <PanelTitle className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('driveDna.genome', 'Genome')}
              </PanelTitle>
              <Text variant="caption" as="p" className="mb-3">
                {t(
                  'driveDna.blurb',
                  'Every drive has a unique signature. This bloom encodes speed, power flow, elevation and battery into a reproducible fingerprint.',
                )}
              </Text>
              <div className="flex items-center gap-2 font-mono text-lg tabular-nums text-cyan-300">
                <Fingerprint className="h-4 w-4 shrink-0" aria-hidden="true" />
                {genome.signature}
              </div>
            </div>

            {genome.traits.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {genome.traits.map((trait) => {
                  const Icon = TRAIT_ICON[trait] ?? Sparkles;
                  const key = TRAIT_I18N[trait];
                  return (
                    <Badge key={trait} variant="info">
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      {key ? t(key, trait) : trait}
                    </Badge>
                  );
                })}
              </div>
            )}

            <KVList items={genomeStats} columns={2} />

            <div className="mt-auto">
              <Button
                variant="secondary"
                onClick={handleDownload}
                disabled={genome.petals.length === 0}
                className="w-full"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                {t('driveDna.download', 'Download SVG')}
              </Button>
            </div>
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}

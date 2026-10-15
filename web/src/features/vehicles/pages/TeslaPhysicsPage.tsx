import { useLocation } from 'react-router-dom';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';

import { PhysicsInvestigation } from '../components/tesla-physics/PhysicsInvestigation';
import { PhysicsInvestigationNav } from '../components/tesla-physics/PhysicsInvestigationNav';
import { features, hours, PhysicsPageShell, unknown, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { VehicleEvidenceBrief } from '../components/operationalbrief-n-z/VehicleEvidenceBrief';

export default function TeslaPhysicsPage() {
  const { fmtNumber } = useNumberFormatting();
  const { pathname } = useLocation();
  const slug = features.find((item) => pathname === `/tesla-physics/${item.slug}`)?.slug;
  const physics = usePhysicsPage(slug);
  const { report, t } = physics;
  const evidence = report?.evidence;
  const limited = !evidence || !evidence.history_available || !evidence.black_box_available ||
    evidence.history_truncated || evidence.black_box_truncated ||
    evidence.drive_sessions_truncated || evidence.charge_sessions_truncated;
  const summaryStatus = physics.state.status === 'ok' && limited ? 'partial' : physics.state.status;
  const coverage = report?.unknown_os;
  const percentage = coverage?.window_hours && coverage.sample_hours != null
    ? Math.min(100, Math.max(0, 100 * coverage.sample_hours / coverage.window_hours)) : null;
  const findings = report?.contradictions?.findings;
  const drops = report?.meters?.resets;
  const attention = report?.nervous_system?.nerves?.filter((nerve) => nerve.status !== 'alive');
  return <PhysicsPageShell physics={physics} navigation={<PhysicsInvestigationNav activeSlug={slug} t={t} />}>
    <LayoutCard title={slug ? t('teslaOnly.workbench.summary', 'Evidence at a glance') : t('teslaOnly.whereToStart', 'Where to start')}>
      {!slug && <Text as="p" variant="bodySm">{t('teslaOnly.hubGuide', 'Choose a focused investigation. Each section explains its measurements, interpretation limits, related evidence, and optional timestamp-level drilldowns. Start by checking source coverage.')}</Text>}
      <VehicleEvidenceBrief id="tesla-physics-evidence-summary" refreshFailed={physics.state.refreshError != null}
        title={t('teslaOnly.returnedEvidence', 'Returned evidence')}
        description={t('teslaOnly.zeroScope', 'A zero means no finding in the returned evidence, not proof that nothing happened outside the observed window.')}
        status={summaryStatus}
        scope={t('teslaOnly.hubWindow', 'Exclusive history is bounded to at most 14 days')}
        provenance={t('teslaOnly.briefSource', 'Bounded exclusive physics report')}
        metrics={[
          { metricId: 'percent', occurrenceId: 'coverage', label: t('teslaOnly.sampleCoverage', 'Sampled window'),
            rawValue: percentage, missingReason: unknown(t),
            display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
          { metricId: 'duration', occurrenceId: 'unknown-hours', label: t('teslaOnly.unknownHours', 'Unknown'),
            rawValue: coverage?.unknown_hours == null ? null : coverage.unknown_hours * 3600, missingReason: unknown(t),
            display: { formatter: raw => ({ value: hours(raw / 3600, t), unit: '' }) } },
          { metricId: 'count', occurrenceId: 'episodes', label: t('teslaOnly.contradictionEpisodes', 'Returned episodes'),
            rawValue: findings ? findings.length : null, missingReason: unknown(t) },
          { metricId: 'count', occurrenceId: 'meter-drops', label: t('teslaOnly.workbench.resetCount', 'Returned meter drops'),
            rawValue: drops ? drops.length : null, missingReason: unknown(t) },
          { metricId: 'count', occurrenceId: 'attention', label: t('teslaOnly.hubSignalsLabel', 'Non-alive returned signals'),
            rawValue: attention?.length, context: attention ? t('teslaOnly.hubSignals', 'Non-alive returned signals: {{count}}', { count: attention.length }) : undefined },
        ]}
      />
    </LayoutCard>
    {slug && <PhysicsInvestigation slug={slug} physics={physics} />}
  </PhysicsPageShell>;
}

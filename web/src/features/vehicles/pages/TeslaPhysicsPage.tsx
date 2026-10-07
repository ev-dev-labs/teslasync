import { useLocation } from 'react-router-dom';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { PhysicsInvestigation } from '../components/tesla-physics/PhysicsInvestigation';
import { PhysicsInvestigationNav } from '../components/tesla-physics/PhysicsInvestigationNav';
import { features, hours, PhysicsPageShell, unknown, usePhysicsPage } from '../components/tesla-physics/PhysicsPageShell';

export default function TeslaPhysicsPage() {
  const { pathname } = useLocation();
  const slug = features.find((item) => pathname === `/tesla-physics/${item.slug}`)?.slug;
  const physics = usePhysicsPage(slug);
  const { report, t } = physics;
  const coverage = report?.unknown_os;
  const percentage = coverage?.window_hours && coverage.sample_hours != null
    ? Math.min(100, Math.max(0, 100 * coverage.sample_hours / coverage.window_hours)) : null;
  const findings = report?.contradictions?.findings;
  const drops = report?.meters?.resets;
  const attention = report?.nervous_system?.nerves?.filter((nerve) => nerve.status !== 'alive');
  return <PhysicsPageShell physics={physics} navigation={<PhysicsInvestigationNav activeSlug={slug} t={t} />}>
    <GlassPanel className="space-y-4 p-4 sm:p-6">
      <PanelTitle>{slug ? t('teslaOnly.workbench.summary', 'Evidence at a glance') : t('teslaOnly.whereToStart', 'Where to start')}</PanelTitle>
      {!slug && <Text as="p" variant="bodySm">{t('teslaOnly.hubGuide', 'Choose a focused investigation. Each section explains its measurements, interpretation limits, related evidence, and optional timestamp-level drilldowns. Start by checking source coverage.')}</Text>}
      <Grid cols={{ default: 1, md: 2, xl: 4 }} gap={3}>
        <MetricCard label={t('teslaOnly.sampleCoverage', 'Sampled window')} value={percentage == null ? unknown(t) : `${fmtNumber(percentage, 1)}%`} color="cyan" />
        <MetricCard label={t('teslaOnly.unknownHours', 'Unknown')} value={hours(coverage?.unknown_hours, t)} color="amber" />
        <MetricCard label={t('teslaOnly.contradictionEpisodes', 'Returned episodes')} value={findings ? findings.length : unknown(t)} color="purple" />
        <MetricCard label={t('teslaOnly.workbench.resetCount', 'Returned meter drops')} value={drops ? drops.length : unknown(t)} color="green" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        {attention && <Badge variant="warning" size="sm">{t('teslaOnly.hubSignals', 'Non-alive returned signals: {{count}}', { count: attention.length })}</Badge>}
        <Badge variant="neutral" size="sm">{t('teslaOnly.hubWindow', 'Exclusive history is bounded to at most 14 days')}</Badge>
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.zeroScope', 'A zero means no finding in the returned evidence, not proof that nothing happened outside the observed window.')}</Text>
    </GlassPanel>
    {slug && <PhysicsInvestigation slug={slug} physics={physics} />}
  </PhysicsPageShell>;
}

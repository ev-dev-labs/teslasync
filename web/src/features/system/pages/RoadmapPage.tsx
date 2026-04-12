import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { RoadmapPhase, RoadmapItem } from '@/types/admin';

const phaseConfig: Record<RoadmapPhase, { variant: 'success' | 'info' | 'warning' | 'neutral'; label: string }> = {
  done: { variant: 'success', label: 'Completed' },
  current: { variant: 'info', label: 'In Progress' },
  next: { variant: 'warning', label: 'Up Next' },
  future: { variant: 'neutral', label: 'Future' },
};

const ROADMAP: RoadmapItem[] = [
  {
    title: 'Core Platform',
    description: 'Foundation: vehicle tracking, charging, driving, and data pipeline',
    phase: 'done',
    features: ['Multi-vehicle support', 'Real-time SSE updates', 'Charging analytics', 'Drive history', 'Battery health tracking', 'Data export (CSV/JSON)'],
  },
  {
    title: 'Smart Notifications',
    description: 'Multi-channel alert system with rule builder',
    phase: 'done',
    features: ['Alert Studio with templates', 'Discord/Slack/Telegram/Email', 'Quiet hours & digest mode', 'Severity-based routing'],
  },
  {
    title: 'Intelligence & Observability',
    description: 'System monitoring, debugging, and AI assistant',
    phase: 'done',
    features: ['System Status dashboard', 'State Machine Debugger', 'DB Health monitoring', 'AI Chatbot'],
  },
  {
    title: 'Fleet Telemetry',
    description: 'Live signal streaming and MQTT integration',
    phase: 'done',
    features: ['Signal Explorer', 'Live Signal Monitor', 'MQTT Inspector', 'Signal Gap Detector', 'Signal Diff'],
  },
  {
    title: 'External Integrations',
    description: 'Third-party service connections and data sync',
    phase: 'next',
    features: ['Home Assistant integration', 'Grafana data source', 'IFTTT webhooks', 'Google Sheets sync', 'Zapier connector'],
  },
  {
    title: 'Enhanced Visualization',
    description: 'Advanced charts, maps, and data exploration',
    phase: 'next',
    features: ['3D battery cell viewer', 'Heatmap overlays', 'Custom dashboards', 'Shareable reports'],
  },
  {
    title: 'AI & Predictive Analytics',
    description: 'Machine learning for battery prediction and driving patterns',
    phase: 'future',
    features: ['Battery degradation prediction', 'Range estimation ML model', 'Anomaly detection', 'Driving behavior scoring'],
  },
  {
    title: 'Enterprise & Scale',
    description: 'Multi-tenant, fleet management for organizations',
    phase: 'future',
    features: ['Multi-tenant support', 'Role-based access', 'Fleet-wide dashboards', 'Audit compliance reports', 'SSO integration'],
  },
  {
    title: 'Mobile App',
    description: 'Native mobile experience for iOS and Android',
    phase: 'future',
    features: ['Push notifications', 'Quick commands', 'Widget support', 'Offline mode'],
  },
];

export default function RoadmapPage() {
  const { t } = useTranslation();

  const phases: RoadmapPhase[] = ['done', 'current', 'next', 'future'];
  const phaseCounts = phases.reduce<Record<string, number>>((acc, p) => {
    acc[p] = ROADMAP.filter((r) => r.phase === p).length;
    return acc;
  }, {});

  return (
    <PageContainer title={t('Roadmap')} subtitle={t('Product roadmap and upcoming features')}>
      <div className="flex gap-3 flex-wrap">
        {phases.map((p) => (
          <Badge key={p} variant={phaseConfig[p].variant} size="sm">
            {phaseConfig[p].label}: {phaseCounts[p]}
          </Badge>
        ))}
      </div>

      {phases.filter((p) => ROADMAP.some((r) => r.phase === p)).map((phase) => (
        <div key={phase} className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Badge variant={phaseConfig[phase].variant}>{phaseConfig[phase].label}</Badge>
          </h2>
          <Grid cols={{ default: 1, md: 2 }} gap={4}>
            {ROADMAP.filter((r) => r.phase === phase).map((item) => (
              <Card key={item.title}>
                <CardHeader title={item.title} subtitle={item.description} />
                <ul className="list-disc list-inside px-4 pb-4 space-y-1 text-sm text-gray-300">
                  {item.features.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </Card>
            ))}
          </Grid>
        </div>
      ))}
    </PageContainer>
  );
}

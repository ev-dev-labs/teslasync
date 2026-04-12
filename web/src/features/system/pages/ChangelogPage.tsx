import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { ChangelogEntry } from '@/types/admin';

const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v2.10.0',
    date: '2024-12-15',
    changes: [
      'Fleet Telemetry integration with live signal streaming',
      'MQTT Inspector for real-time connection monitoring',
      'Signal Gap Detector for stale signal identification',
      'Live Signal Monitor with buffer management',
      'Signal Diff comparison across time ranges',
    ],
  },
  {
    version: 'v2.8.0',
    date: '2024-10-01',
    changes: [
      'Alert Studio with visual rule builder',
      'Multi-channel notification system (Discord, Slack, Telegram, Email)',
      'Quiet hours and digest mode preferences',
      'Backup & Restore with S3/Azure/GCS support',
    ],
  },
  {
    version: 'v2.5.0',
    date: '2024-07-15',
    changes: [
      'AI Chatbot for fleet data queries',
      'State Machine Debugger with transition timeline',
      'Database Health Dashboard with migration tracking',
      'Data Repair tool for stale sessions',
    ],
  },
  {
    version: 'v2.2.0',
    date: '2024-04-01',
    changes: [
      'Security Access page with SVG car visualization',
      'API Logs with filtering and export',
      'Developer Tools with Fleet API configuration',
      'Software Updates timeline view',
    ],
  },
  {
    version: 'v2.0.0',
    date: '2024-01-15',
    changes: [
      'Complete UI rewrite with new component system',
      'TanStack Query for data fetching',
      'Dark mode with glass-morphism design',
      'Multi-vehicle support across all pages',
    ],
  },
];

export default function ChangelogPage() {
  const { t } = useTranslation();

  return (
    <PageContainer title={t('Changelog')} subtitle={t('Release notes and feature history')}>
      <div className="relative">
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-cyan-400 via-amber-400 to-transparent" />

        <div className="space-y-6 pl-10">
          {CHANGELOG.map((entry) => (
            <div key={entry.version} className="relative">
              <div className="absolute -left-[1.65rem] top-1 h-3 w-3 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/30" />
              <Card>
                <CardHeader
                  title={entry.version}
                  action={<Badge variant="neutral" size="sm">{entry.date}</Badge>}
                />
                <ul className="list-disc list-inside px-4 pb-4 space-y-1 text-sm text-gray-300">
                  {entry.changes.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

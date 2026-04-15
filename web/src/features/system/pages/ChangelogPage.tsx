import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import type { ChangelogEntry } from '@/types/admin';

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2.10.0',
    date: '2024-12-15',
    changes: [
      'Custom Prometheus metrics for vehicle polls, alerts, and charging energy',
      'HTTP request duration and size tracking middleware',
      'Database migration status endpoint',
      'Configuration validation endpoint',
      'Health check history with ring buffer',
      'Structured request tracing with correlation IDs',
      'Configurable per-package log verbosity',
      'Graceful degradation mode detection',
      'Startup readiness delay for /readyz',
      'Carbon offset tracker on Energy page',
      'Trip planner with battery estimation',
      'Social share for drive summaries',
      'Charging station finder link via OpenChargeMap',
      'Weather impact info card on Efficiency page',
      'Favorite vehicles with localStorage persistence',
      'Onboarding wizard for first-time users',
      'Vehicle photo placeholder SVGs by model',
      'Changelog and Release Notes pages',
    ],
  },
  {
    version: '2.9.0',
    date: '2024-11-20',
    changes: [
      'API key management with CRUD and revocation',
      'Audit logging for security-sensitive actions',
      'Fleet analytics dashboard improvements',
      'Tire pressure monitoring page',
      'Vampire drain analysis',
      'Mileage tracking (daily/monthly)',
    ],
  },
  {
    version: '2.8.0',
    date: '2024-10-10',
    changes: [
      'SSE real-time event stream',
      'Chatbot assistant for vehicle queries',
      'Software update tracking',
      'Enhanced drive detail with elevation charts',
      'Notification channels with multi-provider support',
    ],
  },
  {
    version: '2.7.0',
    date: '2024-09-01',
    changes: [
      'Geofence management with map UI',
      'Battery health projections',
      'Command center for remote vehicle control',
      'Energy cost comparison (EV vs gas)',
      'Export functionality (CSV/JSON)',
    ],
  },
  {
    version: '2.0.0',
    date: '2024-06-01',
    changes: [
      'Complete UI rewrite with glassmorphism design',
      'Dark mode with neon accents',
      'Live map with real-time vehicle tracking',
      'Resilience layer with circuit breakers and retry',
      'MQTT integration for IoT publishing',
    ],
  },
];

export default function ChangelogPage() {
  const { t } = useTranslation();
  usePageTitle(t('changelog.title', 'Changelog'));

  return (
    <PageContainer
      title={t('changelog.title', 'Changelog')}
      subtitle={t('changelog.subtitle', 'History of features, improvements, and fixes')}
    >
      <div className="relative mt-4">
        {/* Timeline line */}
        <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-400/25 via-purple-500/25 to-transparent" />

        <div className="space-y-8">
          {CHANGELOG.map((entry, idx) => (
            <FadeIn key={entry.version} delay={idx * 0.05}>
              <div className="relative pl-16">
                {/* Timeline dot */}
                <div className="absolute left-[18px] top-5 h-4 w-4 rounded-full border-2 border-cyan-400 bg-gray-900 shadow-lg shadow-cyan-400/30" />

                <GlassPanel className="p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <Badge variant="info" size="sm">v{entry.version}</Badge>
                    <span className="flex items-center gap-1.5 text-xs text-white/40">
                      <Calendar className="h-3 w-3" />
                      {entry.date}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {entry.changes.map((change, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-white/60">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/40" />
                        {change}
                      </li>
                    ))}
                  </ul>
                </GlassPanel>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}

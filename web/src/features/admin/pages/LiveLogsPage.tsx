// LiveLogsPage — modern-ui full-width redesign
//
// Operator-facing live log tail. Streams the API server's structured
// zerolog events via the SSE endpoint at GET /admin/logs/stream (see
// internal/api/adminlogstream/handler.go) and renders them in a
// virtualized DataTable so the browser stays responsive even when the
// server is gushing thousands of lines per minute.
//
// Full-bleed bento layout (mobile-first, reflows to more columns on wide
// screens — never a centered narrow strip):
//   1. KPI band    — connection / visible / buffered / received / drops / level
//   2. Filters     — level (server), grep (server), vehicle id (client)
//   3. AI summary  — opt-in Helix log/trace summarization (self-hiding)
//   4. Live stream — the hero: virtualized log table (full width, tall)
//
// The page intentionally NEVER auto-runs anything destructive — it is
// a read-only window onto the existing log pipeline. Filters are:
//   - level (debug/info/warn/error) — server-side, restarts subscription
//   - grep  (regular expression)    — server-side, restarts subscription
//   - vehicle_id                    — client-side, applied to current buffer
//
// Pause/Resume holds the buffer steady on the client without dropping
// the connection (server keeps fanning out, page just stops appending).
// Auto-scroll follows new events to the bottom; toggling it off — or
// scrolling up manually — pins the table at the user's position.

import { PageLayout } from '@/components/layout';
import { CodeBlock, Modal } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { AILogTraceSummarization } from '@/components/ai';
import { LiveLogsToolbar } from '../components/structural-closure/live-logs/LiveLogsToolbar';
import { LiveLogsOperationalBrief } from '../components/operationalbrief-h-q/LiveLogsOperationalBrief';
import { LiveLogsFilters } from '../components/structural-closure/live-logs/LiveLogsFilters';
import { LiveLogsError } from '../components/structural-closure/live-logs/LiveLogsError';
import { LiveLogsStream } from '../components/structural-closure/live-logs/LiveLogsStream';
import { useLiveLogsPage, type LiveLogsPageProps } from '../hooks/useLiveLogsPage';

export { parseCanonicalVehicleId, deriveAiVehicleScope } from '../components/structural-closure/live-logs/helpers';
export type { LiveLogsPageProps } from '../hooks/useLiveLogsPage';

export default function LiveLogsPage(props: LiveLogsPageProps = {}) {
  const controller = useLiveLogsPage(props);
  const { t, inspectedEvent, setInspectedEvent, stream, aiFromUnix, aiToUnix, aiVehicleId } = controller;
  return (
    <PageLayout
      title={t('liveLogs.title', 'Live logs')}
      subtitle={t(
        'liveLogs.subtitle',
        "Stream the API server's structured log events in real time. Filter by severity and an optional regular expression. The connection is dropped when you navigate away.",
      )}
      secondaryActions=<LiveLogsToolbar controller={controller} />
    >
      <div className="space-y-4 sm:space-y-6">
        <FadeIn><LiveLogsOperationalBrief controller={controller} /></FadeIn>
        <FadeIn delay={0.05}><LiveLogsFilters controller={controller} /></FadeIn>
        <AILogTraceSummarization
          fromUnix={aiFromUnix}
          toUnix={aiToUnix}
          vehicleId={aiVehicleId}
        />
        {stream.error ? <FadeIn delay={0.1}><LiveLogsError controller={controller} /></FadeIn> : null}
        <FadeIn delay={0.15}><LiveLogsStream controller={controller} /></FadeIn>
      </div>
      <Modal
        open={inspectedEvent !== null}
        onClose={() => setInspectedEvent(null)}
        title={t('liveLogs.table.fullEvent', 'Full log event')}
      >
        <CodeBlock
          text={inspectedEvent?.payload ?? ''}
          language="json"
          wrap
          ariaLabel={t('liveLogs.table.fullEvent', 'Full log event')}
        />
      </Modal>
    </PageLayout>
  );
}

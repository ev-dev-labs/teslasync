/**
 * QuietHoursPage — modern-ui full-width redesign of the quiet-hours /
 * Do-Not-Disturb scheduler.
 *
 * Orchestrates three sections in a responsive bento that fills the viewport
 * on every breakpoint (1 column on phones → a 3-column bento on `xl`+):
 *   1. QuietHoursSummary — full-width KPI band derived from useQuietHours().
 *   2. QuietHoursPanel   — the deterministic CRUD hero (spans 2/3 on `xl`).
 *   3. Right rail        — the Helix advisor + a static how-it-works guide.
 *
 * The propose-only contract (ADR-015 §I8) is preserved: the AI advisor only
 * seeds the panel's draft via `pendingSeed`; QuietHoursPanel keeps the sole
 * Save write path. Seeding still works across grid columns because the pending
 * seed lives in this parent's state.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useQuietHours } from '@/api/hooks/useNotifications';
import { QuietHoursPanel } from '@/features/settings/components/QuietHoursPanel';
import { AIQuietHoursSuggestion } from '@/components/ai/AIQuietHoursSuggestion';
import { QuietHoursSummary } from '../components/QuietHoursSummary';
import { QuietHoursGuide } from '../components/QuietHoursGuide';
import type { QuietHoursWindowInput } from '@/api/types';

export default function QuietHoursPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.quietHours.title', 'Quiet hours'));

  // Shared with QuietHoursPanel's own fetch via TanStack's queryKey dedupe, so
  // the KPI band and the freshness chip cost no extra request.
  const quietHoursQuery = useQuietHours();

  // Pending seed handed across from the AI advisor's "Apply to form" handler.
  // QuietHoursPanel consumes it via useEffect on identity change and fires
  // onSeedConsumed, which clears it back to null so the panel does not re-seed
  // on subsequent renders. The propose-only contract (ADR-015 §I8) means the
  // baseline panel still owns the canonical Save button — this hand-off only
  // pre-fills the form fields.
  const [pendingSeed, setPendingSeed] = useState<QuietHoursWindowInput | null>(
    null,
  );
  const handleApplyDraft = useCallback((patch: QuietHoursWindowInput) => {
    setPendingSeed(patch);
  }, []);
  const handleSeedConsumed = useCallback(() => {
    setPendingSeed(null);
  }, []);

  return (
    <PageContainer
      title={t('notifications.quietHours.title', 'Quiet hours')}
      subtitle={t('notifications.quietHours.subtitle', 'Suppress non-critical notifications during a configurable window.')}
      query={quietHoursQuery}
      copyLink
    >
      <FadeIn>
        <QuietHoursSummary query={quietHoursQuery} />
      </FadeIn>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
        <div className="min-w-0 xl:col-span-2">
          <QuietHoursPanel
            seedDraft={pendingSeed}
            onSeedConsumed={handleSeedConsumed}
          />
        </div>
        <div className="min-w-0 space-y-4 xl:space-y-5">
          <AIQuietHoursSuggestion onApplyDraft={handleApplyDraft} />
          <FadeIn delay={0.2}>
            <QuietHoursGuide />
          </FadeIn>
        </div>
      </div>
    </PageContainer>
  );
}

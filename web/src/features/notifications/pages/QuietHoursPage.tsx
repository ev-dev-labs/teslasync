/**
 * QuietHoursPage — Server-backed quiet hours / Do-Not-Disturb schedule.
 * Wraps QuietHoursPanel. Was a Settings sub-section.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { QuietHoursPanel } from '@/features/settings/components/QuietHoursPanel';
import { AIQuietHoursSuggestion } from '@/components/ai/AIQuietHoursSuggestion';
import type { QuietHoursWindowInput } from '@/api/types';

export default function QuietHoursPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.quietHours.title', 'Quiet hours'));

  // Pending seed handed across from the AI advisor's "Apply to
  // form" handler. QuietHoursPanel consumes it via useEffect on
  // identity change and fires onSeedConsumed, which clears it
  // back to null so the panel does not re-seed on subsequent
  // renders. The propose-only contract (ADR-015 §I8) means the
  // baseline panel still owns the canonical Save button — this
  // hand-off only pre-fills the form fields.
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
      copyLink
    >
      <AIQuietHoursSuggestion onApplyDraft={handleApplyDraft} />
      <QuietHoursPanel
        seedDraft={pendingSeed}
        onSeedConsumed={handleSeedConsumed}
      />
    </PageContainer>
  );
}

/**
 * Phase-46 / Prompt 12 — Global announcer mount point.
 *
 * Renders the two visually-hidden live regions (one polite, one
 * assertive) that `useAnnouncer()` writes into. Mount exactly once
 * per app — `Layout.tsx` does that for the production tree. Tests
 * that need to observe announcements should mount this manually
 * around the unit under test.
 *
 * The two regions live as siblings rather than a single shared one
 * because some screen readers (notably JAWS pre-2024) ignore
 * `aria-live` value changes after the first announcement. Splitting
 * by priority keeps each region's `aria-live` value static.
 */

import { useEffect, useState } from 'react';
import { subscribeAnnouncer } from '@/hooks/useAnnouncer';
import { VisuallyHidden } from './VisuallyHidden';

export function AnnouncerRegion() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  useEffect(() => {
    return subscribeAnnouncer((message, priority) => {
      if (priority === 'assertive') {
        setAssertive(message);
      } else {
        setPolite(message);
      }
    });
  }, []);

  return (
    <>
      <VisuallyHidden
        liveRegion
        priority="polite"
        data-testid="announcer-polite"
      >
        {polite}
      </VisuallyHidden>
      <VisuallyHidden
        liveRegion
        priority="assertive"
        data-testid="announcer-assertive"
      >
        {assertive}
      </VisuallyHidden>
    </>
  );
}

import {
  Ban,
  CircleSlash,
  Database,
  GitCommitHorizontal,
  RotateCcw,
  Ruler,
  ShieldQuestion,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import type { FsdInsightsQuality } from '@/types/fsd';

interface FsdMethodologyNotesProps {
  quality: FsdInsightsQuality | undefined;
}

/**
 * The "how this was computed, and what it cannot tell you" list.
 *
 * Kept as its own component so the confidence panel stays readable and so the
 * limitations copy has one home that reviewers can diff.
 */
export function FsdMethodologyNotes({ quality }: FsdMethodologyNotesProps) {
  const { t } = useTranslation();

  const notes: { icon: ReactNode; text: string }[] = [
    {
      icon: <GitCommitHorizontal className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'fsd.method.delta',
        'Distance is the difference between consecutive counter readings, never the counter value itself. New subscriptions request both counters together; historical observations may still be sparse.',
      ),
    },
    {
      icon: <CircleSlash className="h-4 w-4" aria-hidden="true" />,
      text: quality != null && !quality.fsd_distance_derivable
        ? t(
            'fsd.method.absenceActive',
            'The self-driving counter produced no derivable reading in this window, so its distances read “not reported”. Absence of a derivable counter reading is not evidence of zero supervised self-driving distance.',
          )
        : t(
            'fsd.method.absence',
            'A day shows “not reported” when the self-driving counter has nothing to say about it. A measured zero requires an actual unchanged self-driving counter observation; driving-only silence is never converted to zero.',
          ),
    },
    {
      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
      text: quality && quality.fsd_reset_count + quality.driving_reset_count > 0
        ? t(
            'fsd.method.resetSeen',
            'A counter reset was detected in this period. The drop contributes zero distance — the distance travelled between the reset and the next reading cannot be known.',
          )
        : t(
            'fsd.method.reset',
            'The counters are user-resettable trip meters. When a value drops, the decrease is recorded as a reset and contributes zero distance rather than a negative or inflated number.',
          ),
    },
    {
      icon: <Ruler className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'fsd.method.baseline',
        'Attribution needs a reading from before the window. Without one, the first in-window reading is an anchor, not distance travelled. Usage share is shown only when both counters have the same provable basis.',
      ),
    },
    {
      icon: <ShieldQuestion className="h-4 w-4" aria-hidden="true" />,
      text:
        quality != null && !quality.share_basis_available
          ? t(
              'fsd.method.shareUnavailable',
              'The two counters do not cover the same provable span in this period. Their standalone distances remain available, but dividing them would be misleading, so usage share is not reported.',
            )
          : t(
              'fsd.method.share',
              'Usage share divides supervised self-driving distance by observed-driving distance only when both counters cover the same provable span. An unavailable share is never rendered as zero.',
            ),
    },
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'fsd.method.provenance',
        'Only signal-history rows carrying a proven canonical normalization version are used. Legacy rows with unknown unit provenance are excluded rather than guessed or silently rescaled.',
      ),
    },
    {
      icon: <Ban className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'fsd.method.limits',
        'No intervention, disengagement, safety, autonomy-quality, or exact FSD-active route segment is available. Drive attribution is bounded by observation intervals, includes only completed drives fully inside the period, and always carries confidence.',
      ),
    },
  ];

  return (
    <ul className="space-y-3" data-testid="fsd-methodology-notes">
      {notes.map((note) => (
        <li key={note.text} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 text-cyan-300">{note.icon}</span>
          <Text as="span" variant="bodySm">
            {note.text}
          </Text>
        </li>
      ))}
    </ul>
  );
}

import { AlertTriangle, CalendarRange, Database, Info, RotateCcw, Ruler } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import type { FsdInsightsQuality } from '@/types/fsd';

interface FsdConfidenceFootnotesProps {
  quality: FsdInsightsQuality | undefined;
}

/**
 * The caveats that always follow the confidence table.
 *
 * Two are conditional (no derivable self-driving data, clamped share) and
 * three are unconditional — the scope, timezone, and unit statements are part
 * of the page's honesty contract and are never hidden.
 */
export function FsdConfidenceFootnotes({ quality }: FsdConfidenceFootnotesProps) {
  const { t } = useTranslation();

  const notes: { key: string; icon: ReactNode; tone: 'warning' | 'info'; text: string }[] = [];

  if (quality != null && !quality.fsd_distance_derivable) {
    notes.push({
      key: 'noFsdData',
      tone: 'warning',
      icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.noFsdData',
        'Every supervised self-driving distance on this page is shown as “not reported”, because the counter produced no derivable reading in this window. That is not the same as the vehicle driving itself zero metres.',
      ),
    });
  }

  if (quality?.share_clamped) {
    notes.push({
      key: 'clamped',
      tone: 'warning',
      icon: <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.clamped',
        'A raw share exceeded 100% because the two counters were reset independently, so it was capped at 100%.',
      ),
    });
  }

  if (
    quality != null &&
    quality.fsd_distance_derivable &&
    quality.driving_denominator_available &&
    !quality.share_basis_available
  ) {
    notes.push({
      key: 'shareBasis',
      tone: 'warning',
      icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.shareBasisWarning',
        'Usage share is unavailable because the two counters begin from different provable points. Standalone distances are not affected.',
      ),
    });
  }

  const untrustedCount =
    (quality?.fsd_untrusted_sample_count ?? 0) +
    (quality?.driving_untrusted_sample_count ?? 0);
  if (untrustedCount > 0) {
    notes.push({
      key: 'historicalGuard',
      tone: 'warning',
      icon: <Database className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.historicalGuardWarning',
        '{{count}} legacy distance-counter observations were excluded because their unit-normalization provenance cannot be proven.',
        { count: untrustedCount },
      ),
    });
  }

  notes.push(
    {
      key: 'scope',
      tone: 'info',
      icon: <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.scopeNote',
        'This is supervised self-driving distance telemetry. It cannot describe interventions, disengagements, safety performance, or per-drive attribution.',
      ),
    },
    {
      key: 'timezone',
      tone: 'info',
      icon: <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.timezoneNote',
        'Days are your browser’s local calendar days; each observed change is attributed to the day of the later reading.',
      ),
    },
    {
      key: 'unit',
      tone: 'info',
      icon: <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />,
      text: t(
        'fsd.confidence.unitNote',
        'The API stores and returns canonical SI meters; values are converted to your display unit only when rendered.',
      ),
    },
  );

  return (
    <div className="mt-4 space-y-2" data-testid="fsd-confidence-footnotes">
      {notes.map((note) => (
        <Text key={note.key} as="p" variant="caption" className="flex items-start gap-2">
          {note.icon}
          {note.text}
        </Text>
      ))}
    </div>
  );
}

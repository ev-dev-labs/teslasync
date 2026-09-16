import type {
  PhysicsTerm
} from '@/api/types';
import { Caption, Text } from '@/components/ui';
import { unknownLabel, useT } from './helpers';

export function TermRow({
  label,
  term,
  format,
  highlight,
}: {
  label: string;
  term: PhysicsTerm;
  format: (wh: number) => string;
  highlight?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Text as="span" size="sm">
          {label}
        </Text>{' '}
        <Caption>
          {term.method}
          {term.missing_signals?.length ? ` · ${t('physicsLedger.missing', 'missing')}: ${term.missing_signals.join(', ')}` : ''}
        </Caption>
      </div>
      <Text
        as="span"
        size="sm"
        className={highlight ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-primary)] tabular-nums'}
      >
        {term.unknown || term.value_wh == null ? unknownLabel(t) : format(term.value_wh)}
      </Text>
    </div>
  );
}

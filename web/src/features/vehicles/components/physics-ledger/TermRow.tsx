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
  term?: PhysicsTerm | null;
  format: (wh: number) => string;
  highlight?: boolean;
}) {
  const t = useT();
  return (
    <tr>
      <th scope="row" className="min-w-0 font-normal">
        <Text as="span" size="sm">
          {label}
        </Text>{' '}
        <Caption>
          {term?.method ?? unknownLabel(t)}
          {term?.missing_signals?.length ? ` · ${t('physicsLedger.missing', 'missing')}: ${term.missing_signals.join(', ')}` : ''}
        </Caption>
      </th>
      <td className="text-right tabular-nums">
        <Text
          as="span"
          size="sm"
          className={highlight ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-primary)]'}
        >
          {!term || term.unknown || term.value_wh == null ? unknownLabel(t) : format(term.value_wh)}
        </Text>
      </td>
    </tr>
  );
}

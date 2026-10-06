// Static "working with queries" reference panel shown beside the SQL editor.
//
// Replaces the old single intro paragraph with a richer, always-visible help
// surface that fills the workspace sidebar on wide screens: a read-only
// callout, a short tips list, and a copy-ready example query. Purely
// presentational and self-contained — no data fetching or query execution.

import { useMemo, useState } from 'react';
import { FileCode, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CodeBlock, CopyButton, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { InlineCallout } from '@/components/feedback';

// A literal, copy-ready SQL example. This is code (not translatable prose), so
// it is intentionally hard-coded rather than routed through i18n.
const EXAMPLE_QUERY =
  "SELECT COUNT(*)\nFROM drives\nWHERE started_at >= NOW() - INTERVAL '7 days'";

// Stable identities for the tips. Keying the list on these ids (instead of the
// translated sentence) keeps React keys unique and stable even if a locale
// leaves a string empty or reuses the same copy across two tips.
const TIP_DEFS = [
  {
    id: 'catalog',
    key: 'powerSql.info.tip1',
    fallback:
      'Reference the catalog below for exact column names before you write a query.',
  },
  {
    id: 'si-units',
    key: 'powerSql.info.tip2',
    fallback:
      'Values are stored in SI — meters, seconds, watt-hours. Convert to your units in your client.',
  },
  {
    id: 'copy',
    key: 'powerSql.info.tip3',
    fallback:
      'Use Copy query, then paste into psql, DBeaver, or TablePlus to execute.',
  },
  {
    id: 'helix',
    key: 'powerSql.info.tip4',
    fallback:
      'With Helix enabled, describe the question in plain English and apply the drafted SQL above.',
  },
] as const;

export function QueryReferencePanel() {
  const { t } = useTranslation();
  const [copyFailed, setCopyFailed] = useState(false);

  const tips = useMemo(
    () => TIP_DEFS.map(({ id, key, fallback }) => ({ id, text: t(key, fallback) })),
    [t],
  );

  return (
    <GlassPanel className="min-w-0 max-w-full space-y-3 p-4 sm:p-5">
      <PanelTitle className="flex min-w-0 items-center gap-2 break-words">
        <FileCode className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
        {t('powerSql.info.title', 'Working with queries')}
      </PanelTitle>
      <InlineCallout variant="info" icon={<Info className="h-4 w-4" />}>
        {t(
          'powerSql.info.readonly',
          'This is a read-only composing surface. Nothing runs in the browser.',
        )}
      </InlineCallout>
      <ul className="space-y-2">
        {tips.map((tip) => (
          <li key={tip.id} className="flex items-start gap-2">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/60"
              aria-hidden="true"
            />
            <Text variant="bodySm" as="p">
              {tip.text}
            </Text>
          </li>
        ))}
      </ul>
      <figure>
        <Text as="figcaption" variant="caption">
          {t('powerSql.info.exampleLabel', 'Example')}
        </Text>
        <CodeBlock
          text={EXAMPLE_QUERY}
          language="sql"
          wrap
          action={
            <CopyButton
              text={EXAMPLE_QUERY}
              onCopy={() => setCopyFailed(false)}
              onCopyError={() => setCopyFailed(true)}
            />
          }
        />
      </figure>
      {copyFailed && (
        <InlineCallout variant="warning">
          {t(
            'powerSql.editor.copyFailed',
            'Clipboard write failed. Select the text manually and copy with ctrl+C / cmd+C.',
          )}
        </InlineCallout>
      )}
    </GlassPanel>
  );
}

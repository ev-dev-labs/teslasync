import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from '@/components/ui';
import type { KnowledgeEvidence } from './knowledgeEvidence';

interface KnowledgeCitationsProps {
  evidence: KnowledgeEvidence[];
  answer: string;
}

export function KnowledgeCitations({ evidence, answer }: KnowledgeCitationsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const sourcesId = useId();
  if (evidence.length === 0) return null;

  const cited = evidence.filter((source) => answer.includes(source.sourceId));
  return (
    <section data-app-part="conversation-sources" className="mt-3 border-t border-[var(--border-subtle)] pt-3"
      aria-label={t('chatbot.knowledge.title', 'Retrieved documentation')}>
      <Button type="button" variant="ghost" size="sm" wrapLabel
        className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
        onClick={() => setExpanded(!expanded)}
        aria-controls={expanded ? sourcesId : undefined}
        aria-expanded={expanded}>
        {t('chatbot.knowledge.inspect', 'Inspect retrieved sources')} ({evidence.length})
      </Button>
      {expanded && (
        <div id={sourcesId} className="mt-2 space-y-2">
          <Text as="p" variant="caption">
            {t('chatbot.knowledge.freshness', 'Bundled documentation from this deployment; publication dates are unavailable. Only sources named in the answer are marked cited.')}
          </Text>
          <div data-app-part="list conversation-source-list" data-app-list="sources" role="list" className="space-y-2">
          {evidence.map((source) => (
            <div key={`${source.sourceType}:${source.sourceId}:${source.chunkIdx}`}
              data-app-part="list-row conversation-source"
              role="listitem"
              className="rounded-shape-sm border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-d-pad-x">
              <Text as="p" variant="label" className="break-all">
                {source.sourceType}: {source.sourceId} · {t('chatbot.knowledge.part', 'chunk')} {source.chunkIdx + 1}
                {' · '}
                {cited.includes(source)
                  ? t('chatbot.knowledge.cited', 'Cited in answer')
                  : t('chatbot.knowledge.retrieved', 'Retrieved, not cited')}
              </Text>
              <Text as="p" variant="bodySm" className="mt-1 whitespace-pre-wrap break-words">
                {source.excerpt}
              </Text>
            </div>
          ))}
          </div>
        </div>
      )}
    </section>
  );
}

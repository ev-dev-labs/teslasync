import { describe, expect, it } from 'vitest';
import { extractKnowledgeEvidence, mergeKnowledgeEvidence } from './knowledgeEvidence';

describe('extractKnowledgeEvidence', () => {
  it('accepts only uniquely identified, relevant chunks actually returned by retrieval', () => {
    const chunk = {
      source_type: 'docs', source_id: 'guide/charging.md', chunk_idx: 2,
      text: 'Charge settings are available in the charging view.', score: 0.73,
    };
    expect(extractKnowledgeEvidence({ chunks: [
      chunk, chunk,
      { ...chunk, source_id: '../outside.md' },
      { ...chunk, source_id: 'https://untrusted.example/file.md' },
      { ...chunk, score: 0 },
      { ...chunk, text: '' },
      { ...chunk, source_type: 'user_note' },
      { ...chunk, chunk_idx: -1 },
    ] })).toEqual([{
      sourceType: 'docs', sourceId: 'guide/charging.md', chunkIdx: 2,
      excerpt: chunk.text,
    }]);
  });

  it('treats malformed tool outputs as no evidence', () => {
    expect(extractKnowledgeEvidence(null)).toEqual([]);
    expect(extractKnowledgeEvidence({ chunks: 'invented' })).toEqual([]);
  });

  it('shows a query-relevant excerpt rather than an unrelated document prefix', () => {
    const text = `${'Overview. '.repeat(90)}To configure notifications open Settings.`;
    const [source] = extractKnowledgeEvidence({ chunks: [
      { source_type: 'docs', source_id: 'guide/settings.md', chunk_idx: 0, text, score: 0.8 },
    ] }, 'configure notifications');
    expect(source.excerpt).toContain('configure notifications');
    expect(source.excerpt).toMatch(/^…/);
  });

  it('does not repeat a chunk retrieved by multiple tool calls', () => {
    const source = { sourceType: 'docs' as const, sourceId: 'guide/start.md', chunkIdx: 0, excerpt: 'Getting started.' };
    expect(mergeKnowledgeEvidence([source], [source])).toEqual([source]);
  });
});

export interface KnowledgeEvidence {
  sourceType: 'docs' | 'runbooks';
  sourceId: string;
  chunkIdx: number;
  excerpt: string;
}

/** Only tool-returned, nonempty document chunks can become inspectable evidence. */
export function extractKnowledgeEvidence(data: unknown, query = ''): KnowledgeEvidence[] {
  if (typeof data !== 'object' || data === null || !('chunks' in data) || !Array.isArray(data.chunks)) {
    return [];
  }

  const seen = new Set<string>();
  const result: KnowledgeEvidence[] = [];
  for (const item of data.chunks) {
    if (typeof item !== 'object' || item === null) continue;
    const { source_type, source_id, chunk_idx, text, score } = item;
    if (
      (source_type !== 'docs' && source_type !== 'runbooks') ||
      typeof source_id !== 'string' ||
      !/^[\w./-]+\.md$/.test(source_id) ||
      source_id.split('/').includes('..') ||
      !Number.isInteger(chunk_idx) || chunk_idx < 0 ||
      typeof text !== 'string' || !text.trim() ||
      typeof score !== 'number' || !Number.isFinite(score) || score <= 0
    ) continue;
    const key = `${source_type}:${source_id}:${chunk_idx}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const passage = text.trim();
    const terms = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const position = terms
      .map((term) => passage.toLowerCase().indexOf(term))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, position - 100);
    const excerpt = passage.slice(start, start + 500);
    result.push({
      sourceType: source_type,
      sourceId: source_id,
      chunkIdx: chunk_idx,
      excerpt: `${start > 0 ? '…' : ''}${excerpt}${start + 500 < passage.length ? '…' : ''}`,
    });
  }
  return result;
}

export function mergeKnowledgeEvidence(
  existing: KnowledgeEvidence[],
  incoming: KnowledgeEvidence[],
): KnowledgeEvidence[] {
  const seen = new Set(existing.map(({ sourceType, sourceId, chunkIdx }) => `${sourceType}:${sourceId}:${chunkIdx}`));
  return [...existing, ...incoming.filter(({ sourceType, sourceId, chunkIdx }) => {
    const key = `${sourceType}:${sourceId}:${chunkIdx}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })];
}

export function LogHighlightedText({ text, pattern }: { text: string; pattern: RegExp | null }) {
  if (!pattern || text.length === 0) return <>{text}</>;
  const segments: Array<{ text: string; match: boolean }> = [];
  let last = 0;
  let working: RegExp;
  try {
    working = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  } catch {
    return <>{text}</>;
  }
  let match: RegExpExecArray | null;
  while ((match = working.exec(text)) !== null) {
    const matched = match[0] ?? '';
    if (matched.length === 0) {
      const point = text.codePointAt(working.lastIndex);
      working.lastIndex += working.unicode && point != null && point > 0xffff ? 2 : 1;
      continue;
    }
    if (match.index > last) segments.push({ text: text.slice(last, match.index), match: false });
    segments.push({ text: matched, match: true });
    last = match.index + matched.length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), match: false });
  return (
    <>
      {segments.map((segment, index) => segment.match
        ? <mark key={index} className="rounded bg-[var(--theme-primary)]/20 px-0.5 text-[var(--text-primary)] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]">{segment.text}</mark>
        : <span key={index}>{segment.text}</span>)}
    </>
  );
}

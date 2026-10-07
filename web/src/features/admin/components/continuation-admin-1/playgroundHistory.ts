import type { ParsedEndpoint } from '../EndpointSidebar';
import type { HistoryEntry } from '../ResponseViewer';

const HISTORY_KEY = 'teslasync-api-playground-history';
export const MAX_HISTORY = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // A full session store must not prevent viewing the response.
  }
}

function pathMatchesTemplate(template: string, concrete: string): boolean {
  if (template === concrete) return true;
  const templateSegments = template.split('/');
  const concreteSegments = concrete.split('/');
  if (templateSegments.length !== concreteSegments.length) return false;
  for (let index = 0; index < templateSegments.length; index++) {
    const templateSegment = templateSegments[index];
    const concreteSegment = concreteSegments[index];
    if (templateSegment.startsWith('{') && templateSegment.endsWith('}')) {
      if (concreteSegment.length === 0) return false;
      continue;
    }
    if (templateSegment !== concreteSegment) return false;
  }
  return true;
}

/** Replay selects the exact route before considering templates; it never sends a request. */
export function findReplayEndpoint(endpoints: ParsedEndpoint[], entry: HistoryEntry): ParsedEndpoint | undefined {
  const sameMethod = (endpoints ?? []).filter(endpoint => endpoint.method === entry.method);
  return sameMethod.find(endpoint => endpoint.path === entry.path)
    ?? sameMethod.find(endpoint => pathMatchesTemplate(endpoint.path, entry.path));
}

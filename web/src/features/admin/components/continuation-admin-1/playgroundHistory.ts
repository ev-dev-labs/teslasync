import type { ParsedEndpoint } from '../EndpointSidebar';
import type { HistoryEntry } from '../ResponseViewer';
import { reportFrontendError } from '@/lib/errorReporter';

const HISTORY_KEY = 'teslasync-api-playground-history';
export const MAX_HISTORY = 20;

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.method === 'string' && entry.method.trim().length > 0
    && typeof entry.path === 'string' && entry.path.startsWith('/')
    && typeof entry.status === 'number' && Number.isInteger(entry.status)
    && entry.status >= 100 && entry.status <= 599
    && typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration >= 0
    && typeof entry.timestamp === 'string' && Number.isFinite(Date.parse(entry.timestamp));
}

function historyMetadata(entry: HistoryEntry): HistoryEntry {
  return {
    method: entry.method,
    path: entry.path.split(/[?#]/, 1)[0],
    status: entry.status,
    duration: entry.duration,
    timestamp: entry.timestamp,
  };
}

/** Invalid envelopes reach the existing render boundary; salvageable rows are reported and filtered. */
export function loadHistory(): HistoryEntry[] {
  const raw = sessionStorage.getItem(HISTORY_KEY);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Parser messages can contain stored request secrets.
    throw new SyntaxError('API playground history is not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new TypeError('API playground history must be an array');
  }
  const entries: HistoryEntry[] = [];
  let hasInvalidEntries = false;
  for (const value of parsed) {
    if (!isHistoryEntry(value)) {
      hasInvalidEntries = true;
      continue;
    }
    if (entries.length < MAX_HISTORY) entries.push(historyMetadata(value));
  }
  if (hasInvalidEntries) {
    const error = new TypeError('API playground history contains invalid entries');
    if (entries.length === 0) throw error;
    reportFrontendError(error, 'react');
  }
  return entries;
}

export function saveHistory(entries: HistoryEntry[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY).map(historyMetadata)));
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

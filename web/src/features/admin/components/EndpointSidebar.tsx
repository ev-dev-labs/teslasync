import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button as UiButton, Input as UiInput, Text } from '@/components/ui';

/* ─── types ───────────────────────────────────────────────────────────── */

export interface ParsedParam {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  type: string;
  description: string;
  default?: string;
}

export interface ParsedBody {
  contentType: string;
  example?: unknown;
  schema?: Record<string, unknown>;
}

export interface ParsedEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  tag: string;
  summary: string;
  description: string;
  operationId: string;
  parameters: ParsedParam[];
  requestBody?: ParsedBody;
  responses: Record<string, { description: string }>;
}

interface EndpointSidebarProps {
  endpoints: ParsedEndpoint[];
  selected: ParsedEndpoint | null;
  onSelect: (ep: ParsedEndpoint) => void;
}

/* ─── method badge ────────────────────────────────────────────────────── */

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-500/20 text-green-400',
  POST: 'bg-blue-500/20 text-blue-400',
  PUT: 'bg-amber-500/20 text-amber-400',
  DELETE: 'bg-red-500/20 text-red-400',
  PATCH: 'bg-purple-500/20 text-purple-400',
};

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center px-1.5 py-0.5 rounded text-2xs font-mono font-bold w-12 text-center shrink-0',
        METHOD_COLORS[method] ?? 'bg-gray-500/20 text-[var(--text-muted)]',
        className,
      )}
    >
      {method}
    </span>
  );
}

/* ─── collapsible tag group ──────────────────────────────────────────── */

function TagGroup({
  tag,
  endpoints,
  selected,
  onSelect,
  defaultOpen,
}: {
  tag: string;
  endpoints: ParsedEndpoint[];
  selected: ParsedEndpoint | null;
  onSelect: (ep: ParsedEndpoint) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Reveal the group that owns the currently selected endpoint even when the
  // selection changes after mount (e.g. history replay picks an endpoint in a
  // collapsed group) — otherwise the highlighted row stays hidden.
  useEffect(() => {
    if (selected?.tag === tag) setOpen(true);
  }, [selected, tag]);

  return (
    <div>
      <UiButton
        type="button"
        variant="ghost"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-left hover:!bg-white/[0.03]"
      >
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-3 w-3 text-[var(--text-muted)] transition-transform duration-normal',
            open && 'rotate-180',
          )}
        />
        <Text size="xs" weight="semibold" color="secondary" className="flex-1 uppercase tracking-wider">
          {tag}
        </Text>
        <Text size="2xs" color="muted" mono>{endpoints.length}</Text>
      </UiButton>
      {open && (
        <div>
          {endpoints.map(ep => {
              const isSelected =
                selected?.path === ep.path && selected?.method === ep.method;
              return (
                <UiButton
                  key={`${ep.method}-${ep.path}`}
                  type="button"
                  variant="ghost"
                  onClick={() => onSelect(ep)}
                  className={cn(
                    '!h-auto !w-full !justify-start !rounded-none !px-3 !py-1.5 text-left text-xs',
                    'hover:!bg-white/[0.05]',
                    isSelected && '!bg-white/[0.07] border-l-2 border-cyan-400',
                  )}
                  title={ep.summary}
                >
                  <MethodBadge method={ep.method} />
                  <Text size="xs" color="secondary" mono className="truncate">
                    {ep.path}
                  </Text>
                </UiButton>
              );
            })}
          </div>
        )}
    </div>
  );
}

/* ─── sidebar ─────────────────────────────────────────────────────────── */

export default function EndpointSidebar({ endpoints, selected, onSelect }: EndpointSidebarProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const list = endpoints ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      e =>
        (e.path ?? '').toLowerCase().includes(q) ||
        (e.summary ?? '').toLowerCase().includes(q) ||
        (e.operationId ?? '').toLowerCase().includes(q),
    );
  }, [endpoints, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ParsedEndpoint[]>();
    for (const ep of filtered) {
      const tag = ep.tag || 'Other';
      const list = map.get(tag) ?? [];
      list.push(ep);
      map.set(tag, list);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full border-r border-white/[0.06]">
      {/* Search */}
      <div className="p-2 border-b border-white/[0.06]">
        <UiInput
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('playground.search', 'Search endpoints...')}
          aria-label={t('playground.search', 'Search endpoints...')}
          icon={<Search className="h-3.5 w-3.5" aria-hidden="true" />}
          className="!text-xs !py-1.5 !bg-white/[0.03]"
        />
      </div>

      {/* Endpoint count */}
      <Text as="div" size="2xs" color="muted" className="px-3 py-1.5 border-b border-white/[0.04]">
        {filtered.length} {t('playground.endpoints', 'endpoints')}
      </Text>

      {/* Tag groups */}
      <div className="flex-1 overflow-y-auto">
        {Array.from(grouped.entries()).map(([tag, eps]) => (
          <TagGroup
            key={tag}
            tag={tag}
            endpoints={eps}
            selected={selected}
            onSelect={onSelect}
            defaultOpen={selected?.tag === tag || grouped.size <= 5}
          />
        ))}

        {filtered.length === 0 && (
          <Text as="p" variant="caption" className="px-3 py-6 text-center">
            {t('playground.noResults', 'No matching endpoints')}
          </Text>
        )}
      </div>
    </div>
  );
}

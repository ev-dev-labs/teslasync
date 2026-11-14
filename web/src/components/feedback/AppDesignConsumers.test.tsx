import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricBar } from '../data-display/MetricBar';
import { UsageCard } from '../data-display/UsageCard';
import { Card } from '../ui/Card';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs';
import SignalHealthWidget from '@/features/dashboard/widgets/SignalHealthWidget';
import { PackBoundary } from '@/features/dashboard/widgets/designPacks/PackBoundary';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import { SessionList } from '@/features/system/components/chatbot/SessionList';
import { ChatMessageItem } from '@/features/system/components/chatbot/ChatMessageItem';
import { SuggestedPrompts } from '@/features/system/components/chatbot/SuggestedPrompts';
import type { ChatSessionInfo } from '@/api/types';

const observations = vi.hoisted(() => ({
  gaps: {} as Record<string, { timestamp: string }>,
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 7 }] }),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalStats: () => ({
    data: { count: 1 }, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: 1, refetch: vi.fn(),
  }),
  useSignalGaps: () => ({ data: observations.gaps }),
  useSignals: () => ({ data: [] }),
}));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const rules: Rule[] = [];
postcss.parse(readFileSync(
  resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8',
)).walkRules(rule => { rules.push(rule); });

function matchingRules(node: Element, contract = '') {
  return rules.filter(rule => rule.selector.includes(contract)
    && rule.selectors.some(selector => [...node.ownerDocument.querySelectorAll(selector)].includes(node)));
}

function declarations(rule: Rule) {
  const result: Record<string, string> = {};
  rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  return result;
}

function setProfile(host: Element, pack: PackId) {
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
}

beforeEach(() => {
  observations.gaps = {};
});

describe('real data-mode consumers without native CSS scope', () => {
  it.each(['classic', 'v3', 'v2', 'v1'] as const)(
    '%s preserves semantic and embedded metric surfaces while styling ordinary tiles', pack => {
      const { container } = render(
        <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
          <UsageCard bands={[
            { label: 'Normal usage', value: '1' },
            { label: 'Warning usage', value: '2', intent: 'warn' },
            { label: 'Danger usage', value: '3', intent: 'danger' },
          ]} />
          <Card variant="embedded" data-app-part="metric" data-app-metric="card">
            <div data-app-part="metric" data-app-metric="tile">
              <span data-app-part="metric-value">Embedded reading</span>
            </div>
          </Card>
        </div>,
      );
      const host = container.firstElementChild!;
      const release = observeAppDesignScopes(host);
      try {
        const normal = screen.getByText('Normal usage').closest('[data-app-metric="tile"]')!;
        expect(matchingRules(normal).some(rule => 'background' in declarations(rule))).toBe(true);

        const warning = screen.getByText('Warning usage').closest('[data-app-metric="tile"]')!;
        const danger = screen.getByText('Danger usage').closest('[data-app-metric="tile"]')!;
        const embedded = screen.getByText('Embedded reading').closest('[data-surface-variant="embedded"]')!;
        expect(warning).toHaveClass('bg-[var(--semantic-warning-bg)]', 'border-[var(--semantic-warning-border)]');
        expect(danger).toHaveClass('bg-[var(--semantic-danger-bg)]', 'border-[var(--semantic-danger-border)]');
        expect(embedded).toHaveClass('bg-transparent', 'border-0');
        for (const root of [warning, danger, embedded]) {
          for (const element of [root, ...root.querySelectorAll('[data-app-part]')]) {
            for (const rule of matchingRules(element).filter(rule => rule.selector.includes('[data-app-data='))) {
              const style = declarations(rule);
              for (const property of [
                'background', 'border', 'padding', 'display', 'align-items', 'gap',
                'grid-template-columns', 'font-size', 'text-align',
              ]) expect(style).not.toHaveProperty(property);
            }
          }
        }
      } finally {
        release();
      }
    },
  );

  it.each(PACK_IDS)('%s keeps unknown fill absence and observed-zero geometry in native tracks', async pack => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const tree = (
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <PackBoundary requestedPackId="classic">
              <SignalHealthWidget vehicleId={7} size={{ cols: 2, rows: 2 }} />
            </PackBoundary>
            <MetricBar value={0} max={100} color="var(--semantic-warning)" ariaLabel="Stored counter" />
          </MemoryRouter>
        </QueryClientProvider>
      </div>
    );
    const view = render(tree);
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const track = screen.getByRole('progressbar', { name: 'Reporting coverage' });
      const originalClasses = track.className;
      expect(track).toHaveClass('h-1.5', 'bg-[var(--track)]');
      expect(track).not.toHaveAttribute('aria-valuenow');
      expect(track.querySelector('[data-metric-fill]')).toBeNull();
      const modeRules = matchingRules(track, '[data-metric-track]')
        .filter(rule => rule.selector.includes('[data-app-data='));
      expect(modeRules).toHaveLength(1);
      expect(modeRules[0].selector).toContain(`[data-app-design-owner~="data-${APPLICATION_DESIGNS[pack].data}"]`);
      expect(declarations(modeRules[0])).toHaveProperty('outline');

      const sharedTrack = screen.getByRole('progressbar', { name: 'Stored counter' })
        .querySelector('[data-metric-track]')!;
      expect(sharedTrack).toHaveClass('h-2.5');
      expect(matchingRules(sharedTrack, '[data-metric-track]')
        .some(rule => rule.selector.includes(`[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`))).toBe(true);

      observations.gaps = { Unreported: { timestamp: '2000-01-01T00:00:00Z' } };
      view.rerender(
        <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <PackBoundary requestedPackId="classic">
                <SignalHealthWidget vehicleId={7} size={{ cols: 2, rows: 2 }} />
              </PackBoundary>
              <MetricBar value={0} max={100} color="var(--semantic-warning)" ariaLabel="Stored counter" />
            </MemoryRouter>
          </QueryClientProvider>
        </div>,
      );
      const zero = screen.getByRole('progressbar', { name: 'Reporting coverage' });
      const fill = zero.querySelector('[data-metric-fill]') as HTMLElement;
      await waitFor(() => expect(fill).toHaveAttribute('data-app-design-owner'));
      expect(zero).toHaveAttribute('aria-valuenow', '0');
      expect(zero.className).toBe(originalClasses);
      expect(fill).toHaveStyle({ width: '0%' });
      expect(fill).toHaveClass('bg-[var(--semantic-danger)]');
      expect(matchingRules(fill, '[data-metric-fill]')).toHaveLength(1);
      for (const rule of [...matchingRules(zero), ...matchingRules(fill)]) {
        for (const property of Object.keys(declarations(rule))) {
          expect(['outline', 'outline-offset', 'min-inline-size', 'box-sizing']).toContain(property);
        }
      }
    } finally {
      release();
      client.clear();
    }
  });

  it.each(PACK_IDS)('%s composes actual selectable sessions and keeps their editor/actions', async pack => {
    const fullName = 'A complete conversation name with meaningful retained evidence and no discarded suffix';
    const sessions: ChatSessionInfo[] = [
      { id: 'active', title: fullName, first_message: '', message_count: 0, last_message_at: null, created_at: '2026-01-01' },
      { id: 'idle', title: 'Review observations', first_message: '', message_count: 2, last_message_at: null, created_at: '2026-01-01' },
    ];
    const select = vi.fn();
    const rename = vi.fn();
    const retry = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <div data-app-design-preview="" {...getAppDesignAttributes(pack)} dir="rtl">
          <SessionList sessions={sessions} activeSessionId="active" onSelect={select} onNewChat={vi.fn()}
            onRename={rename} onDelete={vi.fn()} source={{ data: sessions, isError: true, refetch: retry }} />
        </div>
      </MemoryRouter>,
    );
    const host = container.querySelector('[data-app-design-preview]')!;
    const release = observeAppDesignScopes(host);
    try {
      const entries = host.querySelectorAll('[data-app-part~="conversation-session"]');
      expect(entries).toHaveLength(2);
      const active = within(entries[0] as HTMLElement).getByRole('button', { name: new RegExp(fullName) });
      expect(active).toHaveAttribute('aria-current', 'true');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
      const mode = APPLICATION_DESIGNS[pack].data;
      const entryRules = matchingRules(entries[0], '[data-app-part~="conversation-session"]')
        .filter(rule => rule.selector.includes('[data-app-data='));
      expect(entryRules).toHaveLength(1);
      expect(declarations(entryRules[0]).display).toBe(mode === 'cards' ? 'flex' : 'grid');
      expect(entryRules[0].selector).toContain(`[data-app-design-owner~="data-${mode}"]`);
      expect(host.querySelector('[data-data-state="stale"]')).toHaveAttribute('data-app-tone', 'warning');
      fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Sessions' }));
      expect(retry).toHaveBeenCalledOnce();
      fireEvent.click(within(entries[1] as HTMLElement).getByRole('button', { name: /Review observations/ }));
      expect(select).toHaveBeenCalledWith('idle');
      fireEvent.click(within(entries[1] as HTMLElement).getByRole('button', { name: 'Rename conversation' }));
      const editor = host.querySelector('[data-app-part~="conversation-session-revision"]')!;
      await waitFor(() => expect(editor).toHaveAttribute('data-app-design-owner'));
      expect(matchingRules(editor).some(rule => declarations(rule)['grid-column'] === '1 / -1')).toBe(true);
      expect(screen.getByRole('textbox', { name: 'Rename conversation' })).toHaveValue('Review observations');
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(rename).not.toHaveBeenCalled();
    } finally {
      release();
    }
  });

  it.each(['classic', 'blueprint', 'v2', 'v1'] as const)(
    '%s does not repaint/reflow transcripts, bubbles, retrieved excerpts or suggestions as generic records',
    async pack => {
      const { container } = render(
        <MemoryRouter>
          <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
            <div data-app-part="list conversation-log" data-app-list="conversation" role="log">
              <ChatMessageItem
                message={{ id: 1, session_id: 'a', role: 'assistant', content: 'Retained answer',
                  created_at: '2026-01-01', knowledgeEvidence: [
                    { sourceType: 'docs', sourceId: 'config.md', chunkIdx: 0, excerpt: 'First line\nSecond line' },
                  ] }}
                isFirstInGroup isLastInGroup isLastAssistant isLastUser={false}
              />
            </div>
            <SuggestedPrompts onPick={vi.fn()} />
          </div>
        </MemoryRouter>,
      );
      const host = container.querySelector('[data-app-design-preview]')!;
      const release = observeAppDesignScopes(host);
      try {
        fireEvent.click(screen.getByRole('button', { name: /Inspect retrieved sources/ }));
        const source = host.querySelector('[data-app-part~="conversation-source"]')!;
        await waitFor(() => expect(source).toHaveAttribute('data-app-design-owner'));
        const protectedNodes = host.querySelectorAll(
          '[data-app-list="conversation"], [data-app-card-kind="conversation"], '
          + '[data-app-part~="conversation-source-list"], [data-app-part~="conversation-source"], '
          + '[data-app-part~="conversation-suggestions"]',
        );
        expect(protectedNodes).toHaveLength(5);
        for (const node of protectedNodes) {
          for (const rule of matchingRules(node)) {
            expect(Object.keys(declarations(rule))).toEqual(['min-inline-size']);
          }
        }
        expect(source.textContent).toContain('First line\nSecond line');
        expect(source.querySelector('.whitespace-pre-wrap')).toBeInTheDocument();
        expect(screen.getByRole('log')).toHaveTextContent('Retained answer');
      } finally {
        release();
      }
    },
  );

  it('uses the nearest complete profile, not a conflicting live-root mode or incomplete preview', async () => {
    const root = document.documentElement;
    const original = Object.keys(getAppDesignAttributes('classic')).map(name => [name, root.getAttribute(name)] as const);
    setProfile(root, 'v1');
    const { container } = render(
      <div>
        <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')} data-testid="valid">
          <div data-app-part="metric" data-app-metric="bar" data-metric-track />
          <div data-app-part="conversation-session" data-app-session-state="idle" />
        </div>
        <div data-app-design-preview="" data-app-design-pack="v1" data-testid="incomplete">
          <div data-app-part="metric" data-app-metric="bar" data-metric-track />
        </div>
      </div>,
    );
    const release = observeAppDesignScopes(root);
    try {
      const preview = screen.getByTestId('valid');
      const track = preview.querySelector('[data-metric-track]')!;
      const session = preview.querySelector('[data-app-part~="conversation-session"]')!;
      for (const node of [track, session]) {
        const modeRules = matchingRules(node).filter(rule => rule.selector.includes('[data-app-data='));
        expect(modeRules).toHaveLength(1);
        expect(modeRules[0].selector).toContain('[data-app-data="ledger"]');
      }
      const inactiveTrack = screen.getByTestId('incomplete').querySelector('[data-metric-track]')!;
      expect(matchingRules(inactiveTrack)).toHaveLength(0);
      setProfile(preview, 'v2');
      await waitFor(() => expect(track.getAttribute('data-app-design-owner')).toContain('data-cards'));
      for (const node of [track, session]) {
        const modeRules = matchingRules(node).filter(rule => rule.selector.includes('[data-app-data='));
        expect(modeRules).toHaveLength(1);
        expect(modeRules[0].selector).toContain('[data-app-data="cards"]');
      }
      expect(container.querySelectorAll('[role="table"], [role="grid"]')).toHaveLength(0);
    } finally {
      release();
      for (const [name, value] of original) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    }
  });
});

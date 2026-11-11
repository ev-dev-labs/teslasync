import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import '@/i18n';
import { MobileReferenceRow } from './MobileReferenceRow';
import { MobileGridReference } from './MobileGridReference';
import { referenceCallbacks, referenceModel, referenceRow } from './testFixtures';
import { getAppDesignAttributes, observeAppDesignScopes } from '../app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { makeReferenceRecords } from '@/features/developer-reference/mobile-grid/fixtures';
import { useReferencePresentation } from '@/features/developer-reference/mobile-grid/useReferencePresentation';
import type { MobileState } from './types';

const quantitativeRules: postcss.Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => { if (rule.selector.includes('[data-app-metric="bar"][data-metric-track]')) quantitativeRules.push(rule); });
const consumerDeclarations = (element: Element) => quantitativeRules.filter(rule => element.matches(rule.selector))
  .flatMap(rule => rule.nodes.filter((node): node is postcss.Declaration => node.type === 'decl')
    .map(node => `${node.prop}:${node.value}`));

afterEach(cleanup);
describe('mobile row activation and preservation', () => {
  it('opens exactly once on Enter/Space/click, with no extra open controls', () => {
    const activate = vi.fn(); const toggle = vi.fn();
    const { container } = render(<MobileReferenceRow row={referenceRow()} variant="cards"
      selecting={false} selected={false} onActivate={activate} onToggle={toggle} />);
    const card = screen.getByRole('button', { name: 'Reference record' });
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.click(card);
    expect(activate).toHaveBeenCalledTimes(3);
    expect(toggle).not.toHaveBeenCalled();
    expect(container.querySelector('[data-card] button, [data-card] a')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('selection routes both card and checkbox only to caller-owned toggle', () => {
    const activate = vi.fn(); const toggle = vi.fn();
    render(<MobileReferenceRow row={referenceRow()} variant="cards"
      selecting selected onActivate={activate} onToggle={toggle} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(toggle).toHaveBeenCalledTimes(2);
    expect(activate).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
  it('exposes an invalid role mapping rather than discarding source fields silently', () => {
    const row = referenceRow(); const activate = vi.fn();
    render(<MobileReferenceRow row={{ ...row, meta: [...row.meta, ...row.meta] }}
      variant="cards" selecting={false} selected={false} onActivate={activate} onToggle={vi.fn()} />);
    expect(screen.getByText(/Invalid mobile mapping/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open reference details and actions' }));
    expect(activate).toHaveBeenCalledTimes(1);
  });
  it('keeps long names accessible and zero distinct from missing values', () => {
    const row = referenceRow();
    const longTitle = 'Long reference '.repeat(40);
    const { container } = render(<MobileReferenceRow row={{ ...row, title: longTitle, meta: [
      ...row.meta, { key: 'duration_s', label: 'Duration', value: '—' },
    ] }} variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: longTitle.trim() })).toBeInTheDocument();
    expect(screen.getByText('0 kWh')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[data-card-label]')).toHaveAttribute('title', longTitle);
    expect(container.querySelectorAll('[data-card-meta]')).toHaveLength(2);
  });
  it('renders optional raw key/value label and exactly one labelled progress/badge', () => {
    const row = referenceRow();
    const { rerender, container } = render(<MobileReferenceRow row={{ ...row,
      badge: { value: 'A', label: 'Battery score A' },
      progress: { from: 45, to: 80, label: 'Battery from 45% to 80%' },
    }} variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByLabelText('Battery score A')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Battery from 45% to 80%' })).toBeInTheDocument();
    rerender(<MobileReferenceRow row={{ ...row, rawLabel: 'BatteryLevelLongRawFieldName' }} variant="keyValue"
      selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(container.querySelector('[data-kv-row]')).toBeInTheDocument();
    expect(container.querySelector('[data-card]')).toBeNull();
    expect(screen.getByText('BatteryLevelLongRawFieldName')).toBeInTheDocument();
  });
});

describe('mobile baseline-plus-delta quantitative ownership', () => {
  it.each([
    { from: 45, to: 80, baseline: '45%', left: '45%', delta: '35%' },
    { from: 80, to: 45, baseline: '80%', left: '45%', delta: '35%' },
    { from: 50, to: 50, baseline: '50%', left: '50%', delta: '0%' },
    { from: 0, to: 0, baseline: '0%', left: '0%', delta: '0%' },
    { from: 0, to: 100, baseline: '0%', left: '0%', delta: '100%' },
    { from: -50, to: 150, baseline: '0%', left: '0%', delta: '100%' },
    { from: NaN, to: 80, baseline: '0%', left: '0%', delta: '80%' },
    { from: 80, to: NaN, baseline: '80%', left: '0%', delta: '80%' },
    { from: Infinity, to: 80, baseline: '0%', left: '80%', delta: '80%' },
    { from: 80, to: Infinity, baseline: '80%', left: '80%', delta: '80%' },
    { from: -Infinity, to: 80, baseline: '0%', left: '0%', delta: '80%' },
    { from: 80, to: -Infinity, baseline: '80%', left: '0%', delta: '80%' },
  ])('preserves both original operands for $from to $to', ({ from, to, baseline, left, delta }) => {
    render(<MobileReferenceRow row={{ ...referenceRow(), progress: { from, to, label: 'From/to reading' } }}
      variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    const track = screen.getByRole('img', { name: 'From/to reading' });
    expect(track).toHaveAttribute('data-app-part', 'metric');
    expect(track).toHaveAttribute('data-app-metric', 'bar');
    expect(track).toHaveAttribute('data-metric-track');
    expect(track).toHaveClass('mgr-progress', 'relative', 'overflow-hidden', 'bg-[var(--surface-3)]');
    const fills = track.querySelectorAll<HTMLElement>(':scope > [data-metric-fill]');
    expect(fills).toHaveLength(2);
    expect(fills[0]).toBe(track.firstElementChild);
    expect(fills[1]).toBe(track.lastElementChild);
    expect(fills[0]).toHaveClass('absolute', 'inset-y-0', 'left-0', 'bg-[var(--text-muted)]');
    expect(fills[0]).toHaveStyle({ width: baseline });
    expect(fills[1]).toHaveClass('absolute', 'inset-y-0', 'bg-[var(--theme-primary)]');
    expect(fills[1]).toHaveStyle({ left, width: delta });
    expect(track).not.toHaveAttribute('aria-valuenow');
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('deliberately activates the original track and BOTH direct fills for every complete profile (selector proof only)', () => {
    const { container } = render(<MobileReferenceRow row={{ ...referenceRow(),
      progress: { from: 80, to: 45, label: 'Decreasing reading' },
    }} variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    container.setAttribute('data-app-design-preview', '');
    const track = screen.getByRole('img', { name: 'Decreasing reading' });
    const fills = [...track.children];
    expect(consumerDeclarations(track)).toEqual([]);
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        expect(consumerDeclarations(track).some(declaration => declaration.startsWith('outline:'))).toBe(true);
        for (const fill of fills) {
          expect(consumerDeclarations(fill)).toEqual(['box-sizing:border-box', 'min-inline-size:0']);
          expect(fill).toHaveAttribute('data-app-design-owner', track.getAttribute('data-app-design-owner'));
        }
        expect(consumerDeclarations(track).some(declaration => /^(?:width|height|left|background|padding|display):/.test(declaration))).toBe(false);
        expect(fills[0]).toHaveStyle({ width: '80%' });
        expect(fills[1]).toHaveStyle({ left: '45%', width: '35%' });
      } finally { release(); }
    }
    const mobile = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'mobile-grid-reference', 'mobile-grid-reference.css'), 'utf8'));
    let geometry: postcss.Rule | undefined;
    mobile.walkRules('.mgr-progress', rule => { geometry = rule; });
    expect(geometry?.nodes.some(node => node.type === 'decl' && node.prop === 'height' && node.value === '5px')).toBe(true);
    expect(geometry?.parent).toMatchObject({ type: 'atrule', name: 'container', params: 'mobile-grid-reference (width < 640px)' });
  });

  it('requires ownership on each final target and keeps incomplete nested previews neutral', () => {
    const row = { ...referenceRow(), progress: { from: 45, to: 80, label: 'Nested reading' } };
    const view = render(<section data-app-design-preview {...getAppDesignAttributes('v1')}>
      <MobileReferenceRow row={row} variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />
      <section data-app-design-preview data-app-design-pack="v2">
        <MobileReferenceRow row={{ ...row, progress: { ...row.progress, label: 'Incomplete reading' } }}
          variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />
        <section data-app-design-preview {...getAppDesignAttributes('v3')}>
          <MobileReferenceRow row={{ ...row, progress: { ...row.progress, label: 'Rescued reading' } }}
            variant="cards" selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />
        </section>
      </section>
    </section>);
    const release = observeAppDesignScopes(view.container);
    try {
      const track = screen.getByRole('img', { name: 'Nested reading' });
      expect(consumerDeclarations(track)).toContain('outline:2px solid var(--border-strong)');
      const incomplete = screen.getByRole('img', { name: 'Incomplete reading' });
      for (const element of [incomplete, ...incomplete.children]) {
        expect(element).not.toHaveAttribute('data-app-design-owner');
        expect(consumerDeclarations(element)).toEqual([]);
      }
      expect(consumerDeclarations(screen.getByRole('img', { name: 'Rescued reading' })))
        .toContain('outline:1px dashed var(--border-strong)');
      for (const element of [...track.children, track]) {
        expect(element.parentElement).toHaveAttribute('data-app-design-owner');
        element.removeAttribute('data-app-design-owner');
        expect(consumerDeclarations(element)).toEqual([]);
      }
    } finally { release(); }
  });

  it('keeps missing endpoints absent through the real adapter and suppresses key/value graphics', () => {
    const fixtures = makeReferenceRecords(2);
    const records = [fixtures[0],
      { ...fixtures[1], id: 'missing-start', start_percent: null },
      { ...fixtures[1], id: 'missing-end', end_percent: null },
      fixtures[1],
    ];
    const { result } = renderHook(() => useReferencePresentation(records, false));
    const missing = result.current.display.get(records[0].id)!;
    const measured = result.current.display.get(fixtures[1].id)!;
    const { container, rerender } = render(<MobileReferenceRow row={missing} variant="cards"
      selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(container.querySelector('[data-metric-track]')).toBeNull();
    for (const record of records.slice(1, 3)) {
      rerender(<MobileReferenceRow row={result.current.display.get(record.id)!} variant="cards"
        selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
      expect(container.querySelector('[data-metric-track]')).toBeNull();
    }
    rerender(<MobileReferenceRow row={measured} variant="cards"
      selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(screen.getByRole('img', { name: 'Battery from 45% to 80%' })).toHaveAttribute('data-metric-track');
    rerender(<MobileReferenceRow row={measured} variant="keyValue"
      selecting={false} selected={false} onActivate={vi.fn()} onToggle={vi.fn()} />);
    expect(container.querySelector('[data-metric-track]')).toBeNull();
  });

  it.each([
    { state: { kind: 'ready' }, tracks: 1 },
    { state: { kind: 'error', message: 'Retained reference', retained: true }, tracks: 1 },
    { state: { kind: 'loading' }, tracks: 0 },
    { state: { kind: 'error', message: 'Initial failure', retained: false }, tracks: 0 },
    { state: { kind: 'empty', message: 'No reference rows' }, tracks: 0 },
    { state: { kind: 'noMatch', query: 'nothing' }, tracks: 0 },
  ] satisfies Array<{ state: MobileState; tracks: number }>)('preserves the parent $state.kind row branch', ({ state, tracks }) => {
    const model = referenceModel();
    model.state = state;
    model.groups = [{ key: 'one', memberCount: 1, rows: [{
      ...referenceRow(), progress: { from: 0, to: 0, label: 'Known-zero endpoints' },
    }] }];
    const { container } = render(<MobileGridReference model={model} callbacks={referenceCallbacks()} desktop={<div>Desktop records</div>} />);
    expect(container.querySelectorAll('[data-metric-track]')).toHaveLength(tracks);
    expect(screen.getByText('Desktop records')).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import type { NotificationLog } from '@/api/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';
import '../../../i18n';

import NotificationHealthPage from './NotificationHealthPage';

const queries = vi.hoisted(() => ({
  events: { data: [] as NotificationLog[] | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  deliveries: { data: [] as NotificationLog[] | undefined, isLoading: false, isError: false, error: null as Error | null, refetch: vi.fn() },
}));

vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationAnalysisLogs: () => queries.events,
  useNotificationDeliveryLogs: () => queries.deliveries,
}));

describe('Notification Health', () => {
  beforeEach(() => {
    queries.events.isError = false;
    queries.events.error = null;
    queries.events.data = [];
    queries.deliveries.isError = false;
    queries.deliveries.error = null;
    queries.deliveries.data = [];
    queries.events.refetch.mockClear();
    queries.deliveries.refetch.mockClear();
  });

  it('keeps all three analyses and their empty states on one route', () => {
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    for (const [id, title] of [
      ['fatigue', 'Alert fatigue'],
      ['burn-rate', 'Notification burn rate'],
      ['latency', 'Notification latency'],
    ]) {
      const section = screen.getByRole('region', { name: title });
      expect(section).toHaveAttribute('id', id);
      expect(within(section).getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: title })).toHaveAttribute('href', `#${id}`);
    }
    expect(screen.getByText('No notifications have been delivered yet, so there is nothing to score.')).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
    expect(screen.getByText(/No measured channel deliveries yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage delivery channels' }))
      .toHaveAttribute('href', '/notifications/channels');
  });

  it('offers a responsive, keyboard-accessible overview without collapsing any analysis', () => {
    render(<MemoryRouter initialEntries={['/notifications/health#burn-rate']}><NotificationHealthPage /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Notification health sections' });
    expect(nav).toHaveClass('grid', 'md:grid-cols-3');
    expect(within(nav).getAllByRole('link')).toHaveLength(3);
    expect(within(nav).getByRole('link', { name: /Notification burn rate/ }))
      .toHaveAttribute('aria-current', 'location');
    for (const title of ['Alert fatigue', 'Notification burn rate', 'Notification latency']) {
      const section = screen.getByRole('region', { name: title });
      expect(section).toHaveClass('min-w-0', 'scroll-mt-24');
      expect(within(section).getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('region', { name: /metrics/i })).toHaveLength(3);
  });

  it('keeps each metrics band readable at phone, tablet, and desktop widths', () => {
    const now = Date.now();
    const delivered = (id: number, minutesAgo: number, latency: number): NotificationLog => ({
      id, channel_id: 1, alert_id: 7, title: 'Battery warning', message: '', status: 'sent',
      severity: 'warn', event_type: 'battery', error: '',
      created_at: new Date(now - minutesAgo * 60_000).toISOString(),
      sent_at: new Date(now - minutesAgo * 60_000).toISOString(),
      latency_ms: latency, read_at: null,
    });
    queries.events.data = [delivered(1, 2, 120), delivered(2, 1, 340)];
    queries.deliveries.data = [delivered(3, 2, 150), delivered(4, 1, 410)];
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    for (const name of ['Alert fatigue metrics', 'Delivery SLO metrics', 'Notification latency metrics']) {
      const band = screen.getByRole('region', { name });
      expect(band.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
      expect(band.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
      const banks = within(band).getAllByRole('list');
      expect(banks).toHaveLength(2);
      for (const bank of banks) {
        expect(bank).toHaveAttribute('data-operational-metric-bank', 'true');
        expect(bank).toHaveClass('flex', 'flex-wrap');
        for (const tile of within(bank).getAllByRole('listitem')) {
          expect(tile).toHaveClass('flex-[1_1_200px]');
        }
      }
    }
  });

  it('leaves reliability and latency visible if fatigue history fails', () => {
    queries.events.data = undefined;
    queries.events.isError = true;
    queries.events.error = new Error('history unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Notification burn rate' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notification latency' })).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
  });

  it('leaves fatigue visible when the shared delivery-history query fails', () => {
    queries.deliveries.data = undefined;
    queries.deliveries.isError = true;
    queries.deliveries.error = new Error('deliveries unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Alert fatigue' })).toBeInTheDocument();
    expect(screen.getByText('No notifications have been delivered yet, so there is nothing to score.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
    const burnRate = screen.getByRole('region', { name: 'Notification burn rate' });
    fireEvent.click(within(burnRate).getAllByRole('button', { name: 'Retry' })[0]);
    expect(queries.deliveries.refetch).toHaveBeenCalledOnce();
    expect(queries.events.refetch).not.toHaveBeenCalled();
  });

  it('retains successfully loaded empty histories after a delivery refresh fails', () => {
    queries.deliveries.isError = true;
    queries.deliveries.error = new Error('deliveries unavailable');
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByText('No notifications have been delivered yet, so there is nothing to score.')).toBeInTheDocument();
    expect(screen.getByText('No notification outcomes are available in the last 24 hours.')).toBeInTheDocument();
    expect(screen.getByText(/No measured channel deliveries yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    const latency = screen.getByRole('region', { name: 'Notification latency' });
    fireEvent.click(within(latency).getByRole('button', { name: 'Refresh' }));
    expect(queries.deliveries.refetch).toHaveBeenCalledOnce();
    expect(queries.events.refetch).not.toHaveBeenCalled();
  });

  it('retains populated rule breakdowns, SLO outcomes, and measured latency records', () => {
    const now = new Date().toISOString();
    const base: NotificationLog = {
      id: 1, channel_id: 1, alert_id: 7, title: 'Battery low', message: '',
      status: 'sent', severity: 'warning', error: '', created_at: now, sent_at: now,
    };
    queries.events.data = [{ ...base, read_at: null }];
    queries.deliveries.data = [{ ...base, latency_ms: 450 }];

    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);

    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(within(fatigue).getByText('Rule breakdown')).toBeInTheDocument();
    expect(within(fatigue).getAllByText('Battery low').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('region', { name: 'Notification burn rate' }))
      .getByText('Severity breakdown')).toBeInTheDocument();
    const latency = screen.getByRole('region', { name: 'Notification latency' });
    expect(within(latency).getByRole('heading', { name: 'Slowest delivery records' })).toBeInTheDocument();
    expect(within(latency).getByText('Measured')).toBeInTheDocument();
  });

  it('wraps long rule and delivery names instead of clipping details on narrow screens', () => {
    const now = new Date().toISOString();
    const title = 'Unusually long battery alert rule with important identifying details';
    const log: NotificationLog = {
      id: 42, channel_id: 1, alert_id: 7, title, message: '',
      status: 'sent', severity: 'warning', error: '', created_at: now, sent_at: now,
    };
    queries.events.data = [log];
    queries.deliveries.data = [{ ...log, latency_ms: 450 }];
    render(<MemoryRouter><NotificationHealthPage /></MemoryRouter>);
    const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
    expect(within(fatigue).getAllByText(title).some((element) => element.classList.contains('break-words'))).toBe(true);
    const latency = screen.getByRole('region', { name: 'Notification latency' });
    expect(within(latency).getAllByText(title).some((element) => element.classList.contains('break-words'))).toBe(true);
  });

  it('uses restrained overview roles while preserving selected native navigation and focus', () => {
    render(<MemoryRouter initialEntries={['/notifications/health#latency']}><NotificationHealthPage /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'Notification health sections' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual(['#fatigue', '#burn-rate', '#latency']);
    expect(screen.getByText('Delivery intelligence')).toHaveClass('text-[var(--text-muted)]');
    for (const link of links) {
      expect(link).toHaveClass('rounded-lg', 'duration-fast', 'motion-reduce:transition-none',
        'focus-visible:ring-[var(--focus-ring)]', 'focus-visible:ring-offset-2');
      expect(within(link).getByText(/0[123] \/ 03/)).toHaveClass('text-[var(--text-muted)]', 'tabular-nums');
      expect(link.className).not.toMatch(/cyan-|neon|glow/);
    }
    const selected = within(nav).getByRole('link', { name: 'Notification latency' });
    expect(selected).toHaveAttribute('aria-current', 'location');
    expect(selected).toHaveClass('border-[var(--border-strong)]', 'bg-[var(--surface-3)]');
    expect(within(nav).getByRole('link', { name: 'Alert fatigue' })).not.toHaveAttribute('aria-current');
    expect(screen.getByText('Explore three independent views of notification health. Select a view to jump to its metrics, charts, and detailed breakdowns.'))
      .toHaveClass('text-[var(--text-secondary)]');
  });
});

describe('Notification health — qualified native jump controls', () => {
  it('activates all existing control modes and identities on the three real anchors without retagging their content', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/notifications/health#burn-rate']}><NotificationHealthPage /></MemoryRouter>,
    );
    const links = within(screen.getByRole('navigation', { name: 'Notification health sections' })).getAllByRole('link');
    const sheetDirectory = resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs');
    const controls: Rule[] = [];
    postcss.parse(readFileSync(resolve(sheetDirectory, 'controls.css'), 'utf8'))
      .walkRules(rule => { if (rule.selector.includes('[data-app-controls=')) controls.push(rule); });
    const matchesControl = (link: Element) => controls.filter(rule => rule.selectors.some(selector => link.matches(selector)));
    const releaseNeutral = observeAppDesignScopes(container);
    try {
      for (const link of links) {
        expect(link).not.toHaveAttribute('data-app-design-owner');
        expect(matchesControl(link)).toHaveLength(0);
      }
    } finally {
      releaseNeutral();
    }

    container.setAttribute('data-app-design-preview', '');
    try {
      for (const pack of Object.keys(APPLICATION_DESIGNS) as PackId[]) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
        const release = observeAppDesignScopes(container);
        try {
          const identity: Rule[] = [];
          postcss.parse(readFileSync(resolve(sheetDirectory, 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8'))
            .walkRules(rule => { if (rule.selector.includes('[data-app-part~="button"]')) identity.push(rule); });
          for (const [index, link] of links.entries()) {
            expect(link.tagName).toBe('A');
            expect(link).not.toHaveAttribute('role');
            expect(link).toHaveAttribute('href', ['#fatigue', '#burn-rate', '#latency'][index]);
            expect(link).toHaveClass('flex-col', 'p-4', 'gap-2');
            expect(link.children).toHaveLength(3);
            expect(link.getAttribute('data-app-design-owner')?.split(' '))
              .toContain(`controls-${APPLICATION_DESIGNS[pack].controls}`);
            const matching = matchesControl(link);
            expect(matching.length, `${pack}: actual painted jump control`).toBeGreaterThan(0);
            expect(matching.some(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-radius'))).toBe(true);
            expect(identity.some(rule => rule.selectors.some(selector => link.matches(selector))),
              `${pack}: actual jump identity consumer`).toBe(true);
          }
          expect(links[1]).toHaveAttribute('aria-current', 'location');
          expect(links[0]).not.toHaveAttribute('aria-current');
          expect(links[2]).not.toHaveAttribute('aria-current');
        } finally {
          release();
        }
      }
    } finally {
      for (const name of Object.keys(getAppDesignAttributes('classic'))) container.removeAttribute(name);
      container.removeAttribute('data-app-design-preview');
    }
    for (const link of links) {
      expect(link).not.toHaveAttribute('data-app-design-owner');
      expect(matchesControl(link)).toHaveLength(0);
    }
  });

  it('keeps native keyboard hash navigation, active location and the real scroll targets', async () => {
    const originalLocation = window.location.href;
    const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    window.history.replaceState(null, '', '/notifications/health');
    const user = userEvent.setup();
    const view = render(<BrowserRouter><NotificationHealthPage /></BrowserRouter>);
    try {
      const links = within(screen.getByRole('navigation', { name: 'Notification health sections' })).getAllByRole('link');
      links[0].focus();
      for (const [index, id] of ['fatigue', 'burn-rate', 'latency'].entries()) {
        const link = links[index];
        expect(link).toHaveFocus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(link).toHaveAttribute('aria-current', 'location'));
        const target = document.getElementById(id);
        expect(target).toBe(screen.getByRole('region', { name: link.getAttribute('aria-label') ?? '' }));
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(target);
        expect(window.location.hash).toBe(`#${id}`);
        if (index < links.length - 1) await user.tab();
      }
      expect(screen.getAllByRole('region', { name: /metrics/i })).toHaveLength(3);
    } finally {
      view.unmount();
      window.history.replaceState(null, '', originalLocation);
      if (originalScroll) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll);
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });
});

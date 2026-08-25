/**
 * WidgetPicker tests.
 *
 * WidgetPicker is the slide-in drawer for adding widgets to a dashboard. It is
 * a controlled component over the widget registry + layout presets, so the
 * tests exercise its full behaviour contract rather than a smoke render:
 *
 *   - Visibility: renders nothing when closed, a labelled dialog when open.
 *   - Search: filters the flat list, shows a result-count header, an empty
 *     state for no matches, and matches by name/description/category.
 *   - Category pills: narrow the grouped view and hide the presets section.
 *   - Add semantics: a single click adds one widget; "Add all" batches the
 *     addable (non-active) widgets; Enter adds the sole search result;
 *     Ctrl/Cmd+Enter adds-and-closes; already-added widgets are disabled and
 *     inert; presets fire onApplyPreset + onClose.
 *   - Feedback: the footer summarises the session count with a Done action and
 *     a screen-reader live region announces each add.
 *   - Recently-added: persisted ids surface a section (excluding active ones),
 *     which hides while searching, and corrupt localStorage degrades safely.
 *   - a11y: the search field is auto-focused on open.
 *
 * i18n is stubbed with an interpolating passthrough `t(key, default, opts)` so
 * assertions run against deterministic English defaults (matching the sibling
 * DashboardSettingsModal convention). No network is
 * touched — the component is pure presentation over the static registry.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';

// Interpolating passthrough i18n — returns the English default and substitutes
// `{{var}}` placeholders from the options bag so announcements / counts read
// naturally without booting the real i18n instance.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string, opts?: Record<string, unknown>) => {
      let out = typeof defaultValue === 'string' ? defaultValue : _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

import { WidgetPicker } from './WidgetPicker';
import { WIDGET_REGISTRY } from '../widgets/registry';

const RECENT_KEY = 'teslasync-widgets-recent';

// Globally-unique widget descriptions — used to target specific cards by their
// accessible name (which concatenates icon + name + description + size).
const BATTERY_GAUGE_DESC = 'Battery percentage with level gauge';
const RANGE_ESTIMATE_DESC = 'Rated, ideal, and estimated range';
const VEHICLE_HERO_DESC = 'Vehicle name, model, state, battery at a glance';

type Props = React.ComponentProps<typeof WidgetPicker>;

function renderPicker(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onAddWidgets = vi.fn();
  const onApplyPreset = vi.fn();
  const utils = render(
    <WidgetPicker
      open
      onClose={onClose}
      onAddWidgets={onAddWidgets}
      onApplyPreset={onApplyPreset}
      activeWidgetIds={[]}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onAddWidgets, onApplyPreset };
}

/** The clickable widget card whose accessible name contains `desc`. */
function widgetCard(desc: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(desc, 'i') });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('WidgetPicker', () => {
  it('renders nothing when closed', () => {
    renderPicker({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders a labelled dialog, search field, category tabs and presets when open', () => {
    renderPicker();

    expect(screen.getByRole('dialog', { name: 'Add Widget' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /search widgets/i })).toBeInTheDocument();

    // "All" is the default-selected category filter.
    const selected = screen.getByRole('button', { name: 'All', pressed: true });
    expect(selected).toHaveTextContent('All');
    expect(
      screen.getByRole('button', { name: 'Battery & Range', pressed: false }),
    ).toBeInTheDocument();

    // The whole registry is available and the preset section is present.
    expect(
      screen.getByText(new RegExp(`${WIDGET_REGISTRY.length} widgets available`)),
    ).toBeInTheDocument();
    expect(screen.getByText('Layout Presets')).toBeInTheDocument();
    expect(widgetCard(BATTERY_GAUGE_DESC)).toBeInTheDocument();
  });

  it('auto-focuses the search field shortly after opening', async () => {
    renderPicker();
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input).toHaveFocus(), { timeout: 2000 });
  });

  it('adds a single widget when its card is clicked', () => {
    const { onAddWidgets, onClose } = renderPicker();
    fireEvent.click(widgetCard(BATTERY_GAUGE_DESC));

    expect(onAddWidgets).toHaveBeenCalledTimes(1);
    expect(onAddWidgets).toHaveBeenCalledWith(['battery-gauge']);
    // A plain click adds without dismissing the drawer.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables an already-added widget, badges it, and ignores clicks on it', () => {
    const { onAddWidgets } = renderPicker({ activeWidgetIds: ['battery-gauge'] });
    const card = widgetCard(BATTERY_GAUGE_DESC);

    expect(card).toBeDisabled();
    expect(within(card).getByText('Added')).toBeInTheDocument();

    fireEvent.click(card);
    expect(onAddWidgets).not.toHaveBeenCalled();
  });

  it('filtering by category narrows the list and hides the presets section', () => {
    renderPicker();
    fireEvent.click(
      screen.getByRole('button', { name: 'Battery & Range', pressed: false }),
    );

    expect(widgetCard(BATTERY_GAUGE_DESC)).toBeInTheDocument();
    // A vehicle-category widget is no longer rendered.
    expect(
      screen.queryByRole('button', { name: new RegExp(VEHICLE_HERO_DESC, 'i') }),
    ).toBeNull();
    // Presets only render on the unfiltered "All" view.
    expect(screen.queryByText('Layout Presets')).toBeNull();
  });

  it('searching filters to matches, shows a result-count header, and hides non-matches', () => {
    renderPicker();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'range' } });

    // Multiple range widgets remain; the batch header appears. Match by the
    // unique widget name — range-bar's description embeds range-estimate's.
    expect(screen.getByRole('button', { name: /Range Estimate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add all/i })).toBeInTheDocument();
    expect(screen.getByText(/results for "range"/i)).toBeInTheDocument();

    // A battery-gauge card (no "range" in name/description/category) is dropped.
    expect(
      screen.queryByRole('button', { name: new RegExp(BATTERY_GAUGE_DESC, 'i') }),
    ).toBeNull();
    // Presets are hidden while searching.
    expect(screen.queryByText('Layout Presets')).toBeNull();
  });

  it('shows an empty state and no cards when nothing matches the search', () => {
    renderPicker();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zzzznope-xyz' } });

    expect(screen.getByText('No widgets match "zzzznope-xyz"')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: new RegExp(BATTERY_GAUGE_DESC, 'i') }),
    ).toBeNull();
  });

  it('Escape clears a non-empty search instead of closing the drawer', () => {
    const { onClose } = renderPicker();
    const input = screen.getByRole('textbox', { name: /search widgets/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'range' } });
    expect(input.value).toBe('range');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape on an already-empty search bubbles up to close the drawer', () => {
    const { onClose } = renderPicker();
    const input = screen.getByRole('textbox', { name: /search widgets/i }) as HTMLInputElement;
    expect(input.value).toBe('');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter adds the sole matching widget', () => {
    const { onAddWidgets } = renderPicker();
    const input = screen.getByRole('textbox');
    // A query that resolves to exactly one widget.
    fireEvent.change(input, { target: { value: BATTERY_GAUGE_DESC } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAddWidgets).toHaveBeenCalledTimes(1);
    expect(onAddWidgets).toHaveBeenCalledWith(['battery-gauge']);
  });

  it('"Add all" batches the addable widgets and skips already-active ones', () => {
    const { onAddWidgets } = renderPicker({ activeWidgetIds: ['range-estimate'] });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'range' } });

    fireEvent.click(screen.getByRole('button', { name: /Add all/i }));

    expect(onAddWidgets).toHaveBeenCalledTimes(1);
    const ids = onAddWidgets.mock.calls[0][0] as string[];
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(ids).toContain('range-bar');
    // The active widget must not be re-added.
    expect(ids).not.toContain('range-estimate');
  });

  it('applies a layout preset and closes the drawer', () => {
    const { onApplyPreset, onClose } = renderPicker();
    fireEvent.click(screen.getByRole('button', { name: /Daily Commuter/i }));

    expect(onApplyPreset).toHaveBeenCalledWith('commuter');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter on a widget card adds it and closes the drawer', () => {
    const { onAddWidgets, onClose } = renderPicker();
    fireEvent.keyDown(widgetCard(BATTERY_GAUGE_DESC), { key: 'Enter', ctrlKey: true });

    expect(onAddWidgets).toHaveBeenCalledWith(['battery-gauge']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('summarises added widgets in the footer, announces them, and Done closes', () => {
    const { onClose } = renderPicker();
    fireEvent.click(widgetCard(BATTERY_GAUGE_DESC));

    // Live-region announcement for assistive tech.
    expect(screen.getByRole('status')).toHaveTextContent('Battery Level added to dashboard');
    // Footer session summary + Done action.
    expect(screen.getByText('1 widget added')).toBeInTheDocument();
    const done = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces persisted recently-added widgets and hides the section while searching', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['range-estimate']));
    renderPicker();

    expect(screen.getByText('Recently Added')).toBeInTheDocument();
    // The recent widget renders in both the recently-added strip and its
    // battery category group below.
    expect(screen.getAllByText(RANGE_ESTIMATE_DESC).length).toBeGreaterThanOrEqual(2);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'range' } });
    expect(screen.queryByText('Recently Added')).toBeNull();
  });

  it('omits active widgets from recently-added and tolerates corrupt storage', () => {
    // Corrupt JSON must not throw — loadRecentlyAdded swallows the parse error.
    localStorage.setItem(RECENT_KEY, '{not-json');
    const { unmount } = renderPicker();
    expect(screen.queryByText('Recently Added')).toBeNull();
    unmount();

    // A recent id that is already active is filtered out of the section.
    localStorage.setItem(RECENT_KEY, JSON.stringify(['range-estimate']));
    renderPicker({ activeWidgetIds: ['range-estimate'] });
    expect(screen.queryByText('Recently Added')).toBeNull();
  });
});

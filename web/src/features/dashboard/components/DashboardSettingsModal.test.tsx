/**
 * DashboardSettingsModal tests.
 *
 * The modal is the single edit surface for a saved dashboard's identity
 * (name + emoji icon), its vehicle filter, auto-refresh cadence, and display
 * toggles. The tests cover the full behaviour contract:
 *   - Visibility: renders nothing when closed, a labelled dialog when open.
 *   - Every control: name input, emoji picker (with selected/aria-pressed
 *     state), vehicle-filter select, auto-refresh select, and both toggles.
 *   - Save semantics: onRename fires only for a changed, non-empty name;
 *     onChangeIcon only for a changed icon; onUpdate always carries the
 *     current settings; onClose is called afterwards.
 *   - Cancel discards without persisting.
 *   - Null-safety regression: a legacy/partial `settings` object (missing
 *     the newer keys) is merged with defaults instead of crashing on
 *     `settings.refreshInterval.toString()`.
 *   - Reset: reopening the modal restores unsaved edits.
 *   - Accessibility: both selects and the emoji group expose accessible names.
 *
 * i18n is stubbed with a passthrough `t(key, default)` so assertions run
 * against deterministic English defaults, matching the sibling co-located
 * RecentlyViewedWidget test convention. No network is touched — the component
 * is pure presentation over its props.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { type ComponentProps } from 'react';

import { DashboardSettingsModal } from './DashboardSettingsModal';
import type { SavedDashboard, DashboardSettings } from '../widgets/types';

// Passthrough i18n — `t(key, default)` returns the English default so text
// and accessible-name assertions are deterministic without the i18n bootstrap.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : _key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

const vehicles = [
  { id: 1, display_name: 'Car One' },
  { id: 2, display_name: 'Car Two' },
];

function makeDashboard(overrides: Partial<SavedDashboard> = {}): SavedDashboard {
  return {
    id: 'dash-1',
    name: 'My Dashboard',
    icon: '📊',
    widgets: [],
    layouts: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    settings: { refreshInterval: 0, showWidgetBorders: false, compactMode: false },
    ...overrides,
  };
}

type Props = ComponentProps<typeof DashboardSettingsModal>;

function renderModal(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onUpdate = vi.fn();
  const onRename = vi.fn();
  const onChangeIcon = vi.fn();
  const utils = render(
    <DashboardSettingsModal
      open
      onClose={onClose}
      dashboard={makeDashboard()}
      vehicles={vehicles}
      onUpdate={onUpdate}
      onRename={onRename}
      onChangeIcon={onChangeIcon}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onUpdate, onRename, onChangeIcon };
}

describe('DashboardSettingsModal', () => {
  afterEach(cleanup);

  it('renders nothing when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('renders a labelled dialog with every section and the current name when open', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Dashboard Settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Identity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle Filter' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Auto-Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('My Dashboard');
  });

  it('lets the user edit the name field', () => {
    renderModal();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Road Trips' } });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Road Trips');
  });

  it('marks the selected emoji and moves selection on click (aria-pressed)', () => {
    renderModal();
    expect(screen.getByRole('group', { name: 'Icon' })).toBeInTheDocument();
    // Default icon is pre-selected.
    expect(screen.getByRole('button', { name: '📊', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🚗', pressed: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '🚗' }));

    expect(screen.getByRole('button', { name: '🚗', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '📊', pressed: false })).toBeInTheDocument();
  });

  it('exposes a labelled vehicle-filter select listing all vehicles plus an all option', () => {
    renderModal();
    const select = screen.getByRole('combobox', { name: 'Vehicle Filter' });
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toContain('All Vehicles');
    expect(labels).toContain('Car One');
    expect(labels).toContain('Car Two');
  });

  it('exposes a labelled auto-refresh select defaulting to the per-widget option', () => {
    renderModal();
    const refresh = screen.getByRole('combobox', { name: 'Auto-Refresh' }) as HTMLSelectElement;
    expect(refresh.value).toBe('0');
    const labels = within(refresh)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toContain('Every 30 seconds');
  });

  it('persists a renamed dashboard plus updated settings and closes on save', () => {
    const { onRename, onUpdate, onChangeIcon, onClose } = renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Renamed' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Auto-Refresh' }), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Show widget borders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRename).toHaveBeenCalledWith('Renamed');
    expect(onUpdate).toHaveBeenCalledWith({
      refreshInterval: 30,
      showWidgetBorders: true,
      compactMode: false,
    });
    // Icon was never touched, so its callback must stay silent.
    expect(onChangeIcon).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not rename when the name is unchanged, but still updates settings', () => {
    const { onRename, onUpdate } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not rename when the name is cleared to whitespace', () => {
    const { onRename, onUpdate, onClose } = renderModal();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('changes the icon only when a different emoji is chosen', () => {
    const { onChangeIcon } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: '🚗' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onChangeIcon).toHaveBeenCalledWith('🚗');
  });

  it('applies the selected vehicle filter on save', () => {
    const { onUpdate } = renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: 'Vehicle Filter' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: 2 }));
  });

  it('flips the compact-mode toggle and persists it', () => {
    const { onUpdate } = renderModal();
    const compact = screen.getByRole('switch', { name: 'Compact mode (smaller gaps)' });
    expect(compact).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(compact);
    expect(compact).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ compactMode: true }));
  });

  it('discards edits on cancel without persisting anything', () => {
    const { onClose, onUpdate, onRename, onChangeIcon } = renderModal();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Should not save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
    expect(onChangeIcon).not.toHaveBeenCalled();
  });

  it('merges a legacy/partial settings object with defaults instead of crashing', () => {
    // Simulate a dashboard persisted before the newer settings keys existed.
    // Without the defaults merge, `settings.refreshInterval.toString()` throws.
    const legacyPartial = { vehicleId: 2 } as unknown as DashboardSettings;
    renderModal({ dashboard: makeDashboard({ settings: legacyPartial }) });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const refresh = screen.getByRole('combobox', { name: 'Auto-Refresh' }) as HTMLSelectElement;
    expect(refresh.value).toBe('0');
    expect(screen.getByRole('switch', { name: 'Show widget borders' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Compact mode (smaller gaps)' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('resets unsaved edits when the modal is reopened', () => {
    const dashboard = makeDashboard({ name: 'Original' });
    const shared = {
      onClose: vi.fn(),
      onUpdate: vi.fn(),
      onRename: vi.fn(),
      onChangeIcon: vi.fn(),
      dashboard,
      vehicles,
    };
    const { rerender } = render(<DashboardSettingsModal open {...shared} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited but unsaved' } });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Edited but unsaved');

    // Close (dialog unmounts) then reopen — the effect must restore the source name.
    rerender(<DashboardSettingsModal open={false} {...shared} />);
    expect(screen.queryByRole('textbox')).toBeNull();

    rerender(<DashboardSettingsModal open {...shared} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Original');
  });
});

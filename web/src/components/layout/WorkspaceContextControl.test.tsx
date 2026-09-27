import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_DENSITY_EVENT,
  WORKSPACE_RANGE_EVENT,
} from '@/lib/workspacePreferences';
import { WorkspaceContextControl } from './WorkspaceContextControl';

const mocks = vi.hoisted(() => ({
  setPreset: vi.fn(),
  setRange: vi.fn(),
  setCompare: vi.fn(),
  saveSettings: vi.fn(),
  refetchSettings: vi.fn(),
  settingsPresent: true,
  compare: false,
  presetId: '7d' as string | undefined,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallback: string,
      options?: Record<string, string>,
    ) =>
      Object.entries(options ?? {}).reduce(
        (value, [name, replacement]) =>
          value.replace(`{{${name}}}`, replacement),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2025-01-01',
    end: '2025-01-07',
    startInstant: '2025-01-01T00:00:00Z',
    endInstantExclusive: '2025-01-08T00:00:00Z',
    timezone: 'UTC',
    presetId: mocks.presetId,
    compare: mocks.compare,
    comparePrev: undefined,
    setRange: mocks.setRange,
    setRangeWithUrlUpdates: vi.fn(),
    resetWithUrlUpdates: vi.fn(),
    setPreset: mocks.setPreset,
    setCompare: mocks.setCompare,
    reset: vi.fn(),
  }),
}));

vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({
    data: mocks.settingsPresent ? {
      ui_density: 'comfortable',
      locale: 'en-US',
    } : undefined,
    isLoading: false,
    refetch: mocks.refetchSettings,
  }),
  useSaveSettings: () => ({
    mutate: mocks.saveSettings,
  }),
}));

describe('WorkspaceContextControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compare = false;
    mocks.presetId = '7d';
    mocks.settingsPresent = true;
  });

  it('changes presets, comparison, custom dates, and density from the popover', () => {
    render(<WorkspaceContextControl />);

    const trigger = screen.getByRole('button', {
      name: 'Analysis window: Last 7 days',
    });
    expect(trigger).toHaveTextContent('Last 7 days');
    expect(trigger).toHaveAttribute('data-active-range', 'Last 7 days');

    fireEvent.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'View settings' }),
    ).toBeInTheDocument();
    const rangeChoices = screen.getByRole('group', { name: 'Date range' });
    expect(rangeChoices).not.toHaveTextContent('Last 5 min');
    expect(rangeChoices).toHaveTextContent('24 hours');
    fireEvent.click(screen.getByRole('button', { name: 'Last 24 hours' }));
    expect(mocks.setPreset).toHaveBeenCalledWith('24h');
    expect(rangeChoices).not.toHaveTextContent('All time');
    expect(rangeChoices).toHaveTextContent('90 days');
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(mocks.setPreset).toHaveBeenCalledWith('30d');

    fireEvent.click(
      screen.getByRole('switch', { name: 'Compare to previous period' }),
    );
    expect(mocks.setCompare).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      ui_density: 'compact',
      locale: 'en-US',
    }, expect.any(Object));

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Start date'), {
      target: { value: '2024-12-01' },
    });
    fireEvent.change(screen.getByLabelText('End date'), {
      target: { value: '2024-12-15' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply custom range' }));

    expect(mocks.setRange).toHaveBeenCalledWith({
      start: '2024-12-01',
      end: '2024-12-15',
    });
  });

  it('rolls back the density selection when the save fails', () => {
    render(<WorkspaceContextControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Analysis window: Last 7 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Spacious' }));
    expect(screen.getByRole('button', { name: 'Spacious' })).toHaveAttribute('aria-pressed', 'true');
    const callbacks = mocks.saveSettings.mock.calls.at(-1)?.[1] as { onError: () => void };
    act(() => callbacks.onError());
    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains unavailable density settings and lets the user retry', () => {
    mocks.settingsPresent = false;
    render(<WorkspaceContextControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Analysis window: Last 7 days' }));
    expect(screen.getByText('Display settings unavailable. Retry to change density.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compact' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetchSettings).toHaveBeenCalled();
  });

  it('shows custom date fields for a saved custom range and hides them on a preset', () => {
    mocks.presetId = undefined;
    render(<WorkspaceContextControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Analysis window: Custom' }));

    expect(screen.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(screen.queryByLabelText('Start date')).not.toBeInTheDocument();
    expect(mocks.setPreset).toHaveBeenCalledWith('7d');
  });

  it('shows a saved legacy Live range so it can be changed without misrepresenting it', () => {
    mocks.presetId = 'live';
    render(<WorkspaceContextControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Analysis window: Live' }));
    expect(screen.getByRole('button', { name: 'Last 5 min' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '30 days' }));
    expect(mocks.setPreset).toHaveBeenCalledWith('30d');
  });

  it('resets date range, comparison, and display density to configured defaults', () => {
    mocks.compare = true;
    render(<WorkspaceContextControl />);
    fireEvent.click(screen.getByRole('button', { name: 'Analysis window: Last 7 days · Compare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(mocks.setPreset).toHaveBeenCalledWith('7d');
    expect(mocks.setCompare).toHaveBeenCalledWith(false);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Comfortable' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('responds to command-palette range and density events', () => {
    render(<WorkspaceContextControl />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_RANGE_EVENT, { detail: { preset: 'all' } }),
      );
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_DENSITY_EVENT, {
          detail: { density: 'spacious' },
        }),
      );
    });

    expect(mocks.setPreset).toHaveBeenCalledWith('all');
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      ui_density: 'spacious',
      locale: 'en-US',
    });
  });

  it('ignores unsupported command event payloads', () => {
    render(<WorkspaceContextControl />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_RANGE_EVENT, {
          detail: { preset: 'invalid' },
        }),
      );
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_DENSITY_EVENT, {
          detail: { density: 'tiny' },
        }),
      );
    });

    expect(mocks.setPreset).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('can opt out of global command events for a secondary mobile trigger', () => {
    render(
      <WorkspaceContextControl
        className="w-full"
        listenForCommands={false}
      />,
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_RANGE_EVENT, {
          detail: { preset: '30d' },
        }),
      );
      window.dispatchEvent(
        new CustomEvent(WORKSPACE_DENSITY_EVENT, {
          detail: { density: 'compact' },
        }),
      );
    });

    expect(
      screen.getByRole('button', { name: 'Analysis window: Last 7 days' }),
    ).toHaveClass('w-full');
    expect(mocks.setPreset).not.toHaveBeenCalled();
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('uses compact coordinated chrome in the status bar', () => {
    render(
      <WorkspaceContextControl
        variant="status"
        iconOnly
        listenForCommands={false}
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Analysis window: Last 7 days',
    });
    expect(trigger).toHaveClass('h-5');
    expect(trigger).not.toHaveTextContent('Last 7 days');

    fireEvent.click(trigger);
    expect(
      screen.getByRole('dialog', { name: 'View settings' }),
    ).toBeInTheDocument();
  });

  it('keeps comparison mode visible while the popover is closed', () => {
    mocks.compare = true;
    render(<WorkspaceContextControl />);

    const trigger = screen.getByRole('button', {
      name: 'Analysis window: Last 7 days · Compare',
    });
    expect(trigger).toHaveTextContent('Last 7 days · Compare');

    fireEvent.click(trigger);
    expect(
      screen.getByText('Comparison active: previous matching period'),
    ).toBeInTheDocument();
  });
});

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
  compare: false,
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
    presetId: '7d',
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
    data: {
      ui_density: 'comfortable',
      locale: 'en-US',
    },
    isLoading: false,
  }),
  useSaveSettings: () => ({
    mutate: mocks.saveSettings,
  }),
}));

describe('WorkspaceContextControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compare = false;
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
      screen.getByRole('dialog', { name: 'Workspace analysis context' }),
    ).toBeInTheDocument();
    const rangeSelect = screen.getByLabelText('Analysis window');
    expect(rangeSelect).toHaveTextContent('Live');
    expect(rangeSelect).toHaveTextContent('Last 24 hours');

    fireEvent.change(rangeSelect, {
      target: { value: '30d' },
    });
    expect(mocks.setPreset).toHaveBeenCalledWith('30d');

    fireEvent.click(
      screen.getByRole('switch', { name: 'Compare to previous period' }),
    );
    expect(mocks.setCompare).toHaveBeenCalledWith(true);

    fireEvent.change(screen.getByLabelText('Workspace density'), {
      target: { value: 'compact' },
    });
    expect(mocks.saveSettings).toHaveBeenCalledWith({
      ui_density: 'compact',
      locale: 'en-US',
    });

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
      screen.getByRole('dialog', { name: 'Workspace analysis context' }),
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

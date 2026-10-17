import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCENARIO,
  resetScenario,
  updateScenario,
} from '../hooks/useOrchestrationScenario';
import { ScenarioControls } from './ScenarioControls';

const translations = vi.hoisted(() => ({} as Record<string, string>));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) =>
      (translations[key] ?? fallback).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));
vi.mock('../hooks/useOrchestrationScenario', async importOriginal => ({
  ...await importOriginal<typeof import('../hooks/useOrchestrationScenario')>(),
  resetScenario: vi.fn(),
  updateScenario: vi.fn(),
}));

const actionNames = [
  'Recompute from now',
  'Save as stability baseline',
  'Reset to defaults',
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(translations)) delete translations[key];
});
afterEach(cleanup);

describe('ScenarioControls mobile action targets', () => {
  it.each(actionNames)('keeps %s at the mobile minimum with a compact desktop override (source tokens only)', name => {
    render(<ScenarioControls scenario={DEFAULT_SCENARIO} onRefreshNow={vi.fn()} onCommitBaseline={vi.fn()} />);

    const button = screen.getByRole('button', { name });
    // jsdom has no layout: these are real shared Button merge contracts, not native pixel measurements.
    if (name === 'Reset to defaults') {
      expect(button).toHaveClass('h-9', 'w-9');
      expect(button).toHaveAccessibleDescription('Reset to defaults');
    } else {
      expect(button).toHaveClass('min-h-11', 'md:min-h-9', 'h-auto', 'px-3', 'py-1.5');
      expect(button).not.toHaveClass('min-h-9');
      expect(button).not.toHaveClass('h-9');
      expect(button).toHaveClass('min-w-0', 'max-w-full', 'whitespace-normal', 'focus-visible:outline-2');
      expect(button.querySelector('span.min-w-0')).toHaveClass('break-words');
    }
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('keeps all three actions keyboard reachable and dispatches only their own callbacks', async () => {
    const user = userEvent.setup();
    const refresh = vi.fn();
    const commit = vi.fn();
    render(<ScenarioControls scenario={DEFAULT_SCENARIO} onRefreshNow={refresh} onCommitBaseline={commit} />);
    expect(refresh).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(resetScenario).not.toHaveBeenCalled();
    expect(updateScenario).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('button', { name: actionNames[0] })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
    expect(resetScenario).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('button', { name: actionNames[1] })).toHaveFocus();
    await user.keyboard(' ');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(resetScenario).not.toHaveBeenCalled();

    await user.tab();
    expect(screen.getByRole('button', { name: actionNames[2] })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Reset all inputs?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(resetScenario).toHaveBeenCalledExactlyOnceWith());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(updateScenario).not.toHaveBeenCalled();
  });

  it('preserves current callbacks and scenario values on rerender without automatically resetting preferences', async () => {
    const oldRefresh = vi.fn();
    const oldCommit = vi.fn();
    const refresh = vi.fn();
    const commit = vi.fn();
    const scenario = { ...DEFAULT_SCENARIO, horizonHours: 48, previousPlan: { '42': [0, 3] } };
    const original = structuredClone(scenario);
    const { rerender } = render(
      <ScenarioControls scenario={DEFAULT_SCENARIO} onRefreshNow={oldRefresh} onCommitBaseline={oldCommit} />,
    );
    rerender(<ScenarioControls scenario={scenario} onRefreshNow={refresh} onCommitBaseline={commit} />);
    expect(screen.getByRole('slider', { name: 'Horizon' })).toHaveValue('48');
    expect(resetScenario).not.toHaveBeenCalled();
    expect(updateScenario).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: actionNames[0] }));
    fireEvent.click(screen.getByRole('button', { name: actionNames[1] }));
    fireEvent.click(screen.getByRole('button', { name: actionNames[2] }));
    expect(screen.getByText('Reset all inputs?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(resetScenario).toHaveBeenCalledExactlyOnceWith());
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(oldCommit).not.toHaveBeenCalled();
    expect(updateScenario).not.toHaveBeenCalled();
    expect(scenario).toEqual(original);
  });

  it('retains every assumption group and its existing SI control values and change payloads', () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      powerwall: { ...DEFAULT_SCENARIO.powerwall, enabled: true },
    };
    render(<ScenarioControls scenario={scenario} onRefreshNow={vi.fn()} onCommitBaseline={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Scenario & assumptions' })).toBeInTheDocument();
    for (const title of [
      'Planning horizon', 'Tariff (editable assumption)',
      'Grid / panel limits (editable assumption)', 'Home battery (editable assumption)',
    ]) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getAllByRole('slider')).toHaveLength(12);
    expect(screen.getByRole('slider', { name: 'Max grid import' })).toHaveValue(String(scenario.grid.maxImportW));
    expect(screen.getByRole('slider', { name: 'Usable capacity' })).toHaveValue(String(scenario.powerwall.capacityWh));

    fireEvent.change(screen.getByRole('slider', { name: 'Horizon' }), { target: { value: '36' } });
    expect(updateScenario).toHaveBeenLastCalledWith({ horizonHours: 36 });
    fireEvent.change(screen.getByRole('slider', { name: 'Max grid import' }), { target: { value: '12000' } });
    expect(updateScenario).toHaveBeenLastCalledWith({ grid: { ...scenario.grid, maxImportW: 12000 } });
    fireEvent.change(screen.getByRole('slider', { name: 'Usable capacity' }), { target: { value: '15000' } });
    expect(updateScenario).toHaveBeenLastCalledWith({ powerwall: { ...scenario.powerwall, capacityWh: 15000 } });
    expect(resetScenario).not.toHaveBeenCalled();
  });

  it('retains complete localized long action names and growing labels without altering dispatch', async () => {
    translations['homeEnergy.scenario.refreshNow'] = 'Recalculer maintenant avec toutes les hypothèses actuellement enregistrées';
    translations['homeEnergy.scenario.commitBaseline'] = 'Enregistrer ce scénario complet comme référence de stabilité du planning';
    translations['homeEnergy.scenario.reset'] = 'Restaurer toutes les hypothèses et préférences de scénario par défaut';
    const refresh = vi.fn();
    const commit = vi.fn();
    render(<ScenarioControls scenario={DEFAULT_SCENARIO} onRefreshNow={refresh} onCommitBaseline={commit} />);

    for (const key of Object.keys(translations)) {
      const button = screen.getByRole('button', { name: translations[key] });
      if (key === 'homeEnergy.scenario.reset') {
        expect(button).toHaveClass('h-9', 'w-9');
        expect(button).toHaveAccessibleDescription(translations[key]);
        fireEvent.click(button);
        expect(screen.getByText('Reset all inputs?')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        await waitFor(() => expect(resetScenario).toHaveBeenCalledExactlyOnceWith());
      } else {
        expect(button).toHaveTextContent(translations[key]);
        expect(button).toHaveClass('h-auto', 'min-h-11', 'md:min-h-9', 'whitespace-normal', 'max-w-full');
        expect(button.querySelector('span.min-w-0')).toHaveClass('break-words');
        fireEvent.click(button);
      }
    }
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(resetScenario).toHaveBeenCalledExactlyOnceWith();
    expect(updateScenario).not.toHaveBeenCalled();
  });
});

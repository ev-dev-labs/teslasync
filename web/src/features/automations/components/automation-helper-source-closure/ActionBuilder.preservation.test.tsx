import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ActionBuilder, ACTION_TYPES } from '../../pages/ActionBuilder';
import type { AutomationActionStepInput } from '../stepInputTypes';
import type { NotificationChannel } from '@/types/notifications';
import { useSettings } from '@/hooks/useSettings';
import { inputPreferences } from '@/test/inputPreferences';
import { createDefaultAction, actionWithSettingValue, settingValueKind } from './actionHelpers';

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string, vars?: Record<string, unknown>) => {
        let value = fallback ?? key;
        for (const [name, replacement] of Object.entries(vars ?? {})) {
          value = value.replace(`{{${name}}}`, String(replacement));
        }
        return value;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSettings).mockReturnValue({
    settings: inputPreferences(),
  } as ReturnType<typeof useSettings>);
});

function channel(id: number, enabled: boolean): NotificationChannel {
  return {
    id, enabled, name: `Channel ${id}`, kind: 'discord',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    webhook_url: 'https://example.invalid/mock-only',
    username: null,
    avatar_url: null,
  };
}

function mount(initial: AutomationActionStepInput[], channels: NotificationChannel[] = []) {
  const changed = vi.fn<(actions: AutomationActionStepInput[]) => void>();
  function Harness() {
    const [actions, setActions] = useState(initial);
    return (
      <ActionBuilder
        actions={actions}
        channels={channels}
        onChange={(next) => { changed(next); setActions(next); }}
      />
    );
  }
  return { changed, ...render(<Harness />) };
}

describe('ActionBuilder extraction preservation (callbacks only)', () => {
  it('retains the public kinds and every exact Tesla command identity in source order', () => {
    expect(ACTION_TYPES.map(option => option.value)).toEqual([
      'action_command', 'action_notify', 'action_set_setting', 'action_call_automation',
    ]);
    mount([{ kind: 'action_command', command_name: 'climate_on' }]);
    const command = screen.getByRole('combobox', { name: 'Command' });
    expect(within(command).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual([
      '', 'lock', 'unlock', 'sentry_on', 'sentry_off', 'valet_on', 'valet_off',
      'climate_on', 'climate_off', 'set_temps', 'seat_heater', 'seat_cooler',
      'steering_wheel_heat', 'dog_mode', 'camp_mode', 'charge_start', 'charge_stop',
      'set_charge_limit', 'set_charging_amps', 'open_charge_port', 'close_charge_port',
      'frunk_open', 'trunk_open', 'honk', 'flash', 'navigation_request',
      'navigation_gps_request', 'trigger_homelink', 'remote_start_drive', 'wake_up',
    ]);
  });

  it('associates repeated command, channel and typed-value selects with independent controls', () => {
    mount([
      { kind: 'action_command', command_name: 'lock' },
      { kind: 'action_command', command_name: 'unlock' },
      { kind: 'action_notify', channel_id: 3, template: 'One' },
      { kind: 'action_notify', channel_id: 3, template: 'Two' },
      { kind: 'action_set_setting', setting_key: 'one', value_bool: true },
      { kind: 'action_set_setting', setting_key: 'two', value_bool: false },
    ], [channel(3, true)]);
    for (const name of ['Command', 'Channel', 'Value type', 'Value']) {
      const selects = screen.getAllByRole('combobox', { name });
      expect(selects).toHaveLength(2);
      expect(new Set(selects.map(select => select.id)).size).toBe(2);
      selects.forEach(select => {
        expect(Array.from(document.querySelectorAll('label')).some(label => (
          label.htmlFor === select.id && label.textContent === name
        ))).toBe(true);
      });
    }
  });

  it('names every ordered group and retains explicit kind IDs, reorder boundaries and remove identity', () => {
    const initial: AutomationActionStepInput[] = [
      { kind: 'action_command', command_name: 'lock' },
      { kind: 'action_notify', channel_id: 4, template: 'Preserved message' },
      { kind: 'action_call_automation', target_automation_id: 72 },
    ];
    const { changed } = mount(initial, [channel(4, true)]);
    const groups = screen.getAllByRole('group', { name: /Action \d/ });
    expect(groups).toHaveLength(3);
    groups.forEach((group, index) => {
      expect(within(group).getByLabelText('Action type')).toHaveAttribute('id', `automation-action-kind-${index}`);
    });
    expect(within(groups[0]).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(groups[2]).getByRole('button', { name: 'Move down' })).toBeDisabled();
    fireEvent.click(within(groups[1]).getByRole('button', { name: 'Move up' }));
    expect(changed).toHaveBeenLastCalledWith([initial[1], initial[0], initial[2]]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove action' })[1]);
    expect(changed).toHaveBeenLastCalledWith([initial[1], initial[2]]);
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));
    expect(changed).toHaveBeenLastCalledWith([
      initial[1], initial[2], { kind: 'action_command', command_name: 'climate_on' },
    ]);
    expect(initial).toHaveLength(3);
  });

  it('retains custom parameters and compact draft text without mutating on mount or invalid JSON', () => {
    const { changed } = mount([{
      kind: 'action_command', command_name: 'navigation_request',
      command_params: { address: 'Exact address', locale: 'de-DE' },
    }]);
    const params = screen.getByLabelText('Params (JSON, optional)');
    expect(params).toHaveValue('{\n  "address": "Exact address",\n  "locale": "de-DE"\n}');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(params, { target: { value: '{"address":"Retained","extra":false}' } });
    expect(params).toHaveValue('{"address":"Retained","extra":false}');
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_command', command_name: 'navigation_request',
      command_params: { address: 'Retained', extra: false },
    }]);
    const commits = changed.mock.calls.length;
    fireEvent.change(params, { target: { value: '[1,2]' } });
    expect(changed).toHaveBeenCalledTimes(commits);
    expect(params).toBeInvalid();
    expect(screen.getByRole('button', { name: 'Hide advanced parameters' })).toBeDisabled();
    fireEvent.change(params, { target: { value: '' } });
    expect(params).toBeValid();
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_command', command_name: 'navigation_request', command_params: undefined,
    }]);
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'lock' } });
    expect(screen.queryByLabelText('Params (JSON, optional)')).not.toBeInTheDocument();
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_command', command_name: 'lock', command_params: undefined,
    }]);
  });

  it('retains guided parameters, unrelated custom keys and JSON synchronization', () => {
    const { changed } = mount([{
      kind: 'action_command', command_name: 'set_charge_limit',
      command_params: { percent: 80, custom: 'keep' },
    }]);
    fireEvent.change(screen.getByLabelText('Charge limit'), { target: { value: '90' } });
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_command', command_name: 'set_charge_limit',
      command_params: { percent: 90, custom: 'keep' },
    }]);
    expect(screen.getByLabelText('Params (JSON, optional)')).toHaveValue(
      '{\n  "percent": 90,\n  "custom": "keep"\n}',
    );
    fireEvent.change(screen.getByLabelText('Charge limit'), { target: { value: '' } });
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_command', command_name: 'set_charge_limit', command_params: { custom: 'keep' },
    }]);
  });

  it('retains enabled-channel defaulting, disabled choices and exact multiline template values', () => {
    const { changed } = mount(
      [{ kind: 'action_command', command_name: 'lock' }],
      [channel(2, false), channel(9, true)],
    );
    fireEvent.change(screen.getByLabelText('Action type'), { target: { value: 'action_notify' } });
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_notify', channel_id: 9, template: '',
    }]);
    const select = screen.getByLabelText('Channel');
    expect(within(select).getByRole('option', { name: 'Channel 2 (discord)' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'First line\n{{vehicle}} — second line' } });
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_notify', channel_id: 9, template: 'First line\n{{vehicle}} — second line',
    }]);
  });

  it('preserves numeric zero, null and false while switching setting value types', () => {
    expect(settingValueKind({ kind: 'action_set_setting', setting_key: 'x', value_num: null })).toBe('number');
    expect(settingValueKind({ kind: 'action_set_setting', setting_key: 'x', value_bool: false })).toBe('boolean');
    expect(actionWithSettingValue({ kind: 'action_set_setting', setting_key: 'x' }, 'number', 0)).toEqual({
      kind: 'action_set_setting', setting_key: 'x', value_num: 0,
    });
    expect(actionWithSettingValue({ kind: 'action_set_setting', setting_key: 'x' }, 'number', NaN)).toEqual({
      kind: 'action_set_setting', setting_key: 'x', value_num: null,
    });
    const { changed } = mount([{ kind: 'action_set_setting', setting_key: 'x', value_bool: false }]);
    expect(screen.getByLabelText('Value')).toHaveValue('false');
    fireEvent.change(screen.getByLabelText('Value type'), { target: { value: 'text' } });
    expect(changed).toHaveBeenLastCalledWith([{
      kind: 'action_set_setting', setting_key: 'x', value_text: 'false',
    }]);
  });

  it('retains all four default payloads without adding execution or persisted keys', () => {
    expect(createDefaultAction('action_command')).toEqual({ kind: 'action_command', command_name: 'climate_on' });
    expect(createDefaultAction('action_notify', 8)).toEqual({ kind: 'action_notify', channel_id: 8, template: '' });
    expect(createDefaultAction('action_set_setting')).toEqual({ kind: 'action_set_setting', setting_key: '', value_text: '' });
    expect(createDefaultAction('action_call_automation')).toEqual({ kind: 'action_call_automation', target_automation_id: 0 });
    const { changed } = mount([{ kind: 'action_call_automation', target_automation_id: 17 }]);
    fireEvent.change(screen.getByLabelText('Target automation ID'), { target: { value: '29' } });
    expect(changed).toHaveBeenLastCalledWith([{ kind: 'action_call_automation', target_automation_id: 29 }]);
  });
});

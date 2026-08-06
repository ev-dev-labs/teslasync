/**
 * ActionBuilder — behavioural coverage for the automation action editor.
 *
 * Exercises every export (`ACTION_TYPES`, `ActionBuilder`) and, through the
 * public component surface, every internal branch: the per-kind `ActionFields`
 * editor, `createDefaultAction`, `settingValueKind`, `actionWithSettingValue`
 * and `isCommandParams`.
 *
 * The component is fully controlled (it never holds the action list itself), so
 * a small stateful harness feeds each `onChange` result back in as the next
 * `actions` prop — mirroring real usage and letting us assert the params-editor
 * regression (compact JSON must NOT be pretty-printed mid-typing).
 *
 * i18n is mocked to echo each `t(key, fallback)` fallback so we assert against
 * the English copy. No network is touched — the component is prop-driven.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useState } from 'react';

import { ActionBuilder, ACTION_TYPES } from './ActionBuilder';
import type { AutomationActionStepInput } from '../components/stepInputTypes';
import type { NotificationChannel } from '@/types/notifications';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const discordChannel = (id: number, name: string, enabled: boolean): NotificationChannel => ({
  id,
  name,
  kind: 'discord',
  enabled,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  webhook_url: 'https://discord.example/webhook',
  username: null,
  avatar_url: null,
});

const slackChannel = (id: number, name: string, enabled: boolean): NotificationChannel => ({
  id,
  name,
  kind: 'slack',
  enabled,
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  webhook_url: 'https://slack.example/webhook',
  channel: null,
  username: null,
});

const command = (
  command_name = 'climate_on',
  command_params?: Record<string, unknown>,
): AutomationActionStepInput =>
  command_params
    ? { kind: 'action_command', command_name, command_params }
    : { kind: 'action_command', command_name };

const notify = (channel_id = 0, template = ''): AutomationActionStepInput => ({
  kind: 'action_notify',
  channel_id,
  template,
});

// ── Stateful harness ────────────────────────────────────────────────────────
function renderBuilder(
  initial: AutomationActionStepInput[],
  channels: NotificationChannel[] = [],
) {
  const onChange = vi.fn();
  function Harness() {
    const [actions, setActions] = useState<AutomationActionStepInput[]>(initial);
    return (
      <ActionBuilder
        actions={actions}
        channels={channels}
        onChange={(next) => {
          onChange(next);
          setActions(next);
        }}
      />
    );
  }
  const view = render(<Harness />);
  return { onChange, ...view };
}

// Latest array handed to onChange (throws if never called — a real signal).
function lastActions(onChange: ReturnType<typeof vi.fn>): AutomationActionStepInput[] {
  const { calls } = onChange.mock;
  if (calls.length === 0) throw new Error('onChange was never called');
  return calls[calls.length - 1][0] as AutomationActionStepInput[];
}

 
function lastAction(onChange: ReturnType<typeof vi.fn>, index = 0): any {
  return lastActions(onChange)[index];
}

// ── ACTION_TYPES export ─────────────────────────────────────────────────────
describe('ACTION_TYPES', () => {
  it('exposes the four supported action kinds with i18n keys and fallbacks', () => {
    expect(ACTION_TYPES).toHaveLength(4);
    expect(ACTION_TYPES.map((a) => a.value)).toEqual([
      'action_command',
      'action_notify',
      'action_set_setting',
      'action_call_automation',
    ]);
    expect(ACTION_TYPES[0]).toEqual({
      value: 'action_command',
      labelKey: 'automations.actions.command',
      fallback: 'Vehicle Command',
    });
    expect(
      ACTION_TYPES.every((a) => typeof a.labelKey === 'string' && a.fallback.length > 0),
    ).toBe(true);
  });
});

// ── Empty state & null-safety ───────────────────────────────────────────────
describe('ActionBuilder — empty state & null-safety', () => {
  it('renders only the Add Action control when there are no actions', () => {
    render(<ActionBuilder actions={[]} channels={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add action/i })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('tolerates undefined actions/channels props without crashing', () => {
    expect(() =>
      render(
        <ActionBuilder
          actions={undefined as unknown as AutomationActionStepInput[]}
          channels={undefined as unknown as NotificationChannel[]}
          onChange={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: /add action/i })).toBeInTheDocument();
  });
});

// ── Add / remove / reorder ──────────────────────────────────────────────────
describe('ActionBuilder — add / remove / reorder', () => {
  it('appends a default command action when Add Action is clicked', () => {
    const { onChange } = renderBuilder([]);
    fireEvent.click(screen.getByRole('button', { name: /add action/i }));
    const actions = lastActions(onChange);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: 'action_command', command_name: 'climate_on' });
  });

  it('removes the targeted action', () => {
    const { onChange } = renderBuilder([command('lock'), notify(0)]);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove action' });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[0]);
    const actions = lastActions(onChange);
    expect(actions).toHaveLength(1);
    expect(actions[0].kind).toBe('action_notify');
  });

  it('moves an action down, swapping order', () => {
    const { onChange } = renderBuilder([command('lock'), notify(0)]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    const actions = lastActions(onChange);
    expect(actions[0].kind).toBe('action_notify');
    expect(actions[1].kind).toBe('action_command');
  });

  it('moves an action up when a lower row requests it', () => {
    const { onChange } = renderBuilder([command('lock'), notify(0)]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1]);
    const actions = lastActions(onChange);
    expect(actions[0].kind).toBe('action_notify');
    expect(actions[1].kind).toBe('action_command');
  });

  it('disables Move up on the first row and Move down on the last row', () => {
    renderBuilder([command('lock'), notify(0)]);
    const up = screen.getAllByRole('button', { name: 'Move up' });
    const down = screen.getAllByRole('button', { name: 'Move down' });
    expect(up[0]).toBeDisabled();
    expect(down[1]).toBeDisabled();
    expect(up[1]).not.toBeDisabled();
    expect(down[0]).not.toBeDisabled();
  });
});

// ── Action-type switching ───────────────────────────────────────────────────
describe('ActionBuilder — action type switching', () => {
  it('replaces the action with a default of the new kind, defaulting to the first enabled channel', () => {
    const { onChange } = renderBuilder(
      [command('lock')],
      [discordChannel(5, 'Disabled', false), discordChannel(9, 'Enabled', true)],
    );
    fireEvent.change(screen.getByLabelText('Action Type'), {
      target: { value: 'action_notify' },
    });
    expect(lastAction(onChange)).toEqual({
      kind: 'action_notify',
      channel_id: 9,
      template: '',
    });
    // The notify editor is now shown.
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('gives every action-type select an accessible name (aria-label on rows > 0)', () => {
    renderBuilder([command('lock'), notify(0)]);
    expect(screen.getAllByRole('combobox', { name: 'Action Type' })).toHaveLength(2);
  });
});

// ── Command editor ──────────────────────────────────────────────────────────
describe('ActionFields — command', () => {
  it('changes the selected command name', () => {
    const { onChange } = renderBuilder([command('climate_on')]);
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'lock' } });
    expect(lastAction(onChange).command_name).toBe('lock');
  });

  it('pretty-prints existing command params on mount', () => {
    renderBuilder([command('climate_on', { temp: 21 })]);
    const textarea = screen.getByLabelText(/params/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe(JSON.stringify({ temp: 21 }, null, 2));
  });

  it('commits parsed params and does NOT reformat compact JSON while typing (regression)', () => {
    const { onChange } = renderBuilder([command('climate_on')]);
    const textarea = screen.getByLabelText(/params/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"temp":21}' } });
    // The in-progress compact text must be preserved (no pretty-print clobber).
    expect((screen.getByLabelText(/params/i) as HTMLTextAreaElement).value).toBe('{"temp":21}');
    expect(lastAction(onChange).command_params).toEqual({ temp: 21 });
  });

  it('rejects non-object JSON with an inline error and does not commit', () => {
    const { onChange } = renderBuilder([command('climate_on')]);
    fireEvent.change(screen.getByLabelText(/params/i), { target: { value: '[1,2,3]' } });
    expect(screen.getByText('Params must be a JSON object.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps malformed JSON in the field without committing', () => {
    const { onChange } = renderBuilder([command('climate_on')]);
    const textarea = screen.getByLabelText(/params/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{oops' } });
    expect((screen.getByLabelText(/params/i) as HTMLTextAreaElement).value).toBe('{oops');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears command params when the field is emptied', () => {
    const { onChange } = renderBuilder([command('climate_on', { temp: 21 })]);
    fireEvent.change(screen.getByLabelText(/params/i), { target: { value: '' } });
    const action = lastAction(onChange);
    expect(action.command_params).toBeUndefined();
    expect(action.command_name).toBe('climate_on');
  });
});

// ── Notify editor ───────────────────────────────────────────────────────────
describe('ActionFields — notify', () => {
  it('lists channels as "name (kind)" and disables channels that are not enabled', () => {
    renderBuilder([notify(1)], [discordChannel(1, 'Home', true), slackChannel(2, 'Work', false)]);
    const select = screen.getByLabelText('Channel');
    expect(within(select).getByRole('option', { name: 'Home (discord)' })).not.toBeDisabled();
    expect(within(select).getByRole('option', { name: 'Work (slack)' })).toBeDisabled();
  });

  it('shows a "No channels configured" option when there are no channels', () => {
    renderBuilder([notify(0)], []);
    const select = screen.getByLabelText('Channel');
    expect(
      within(select).getByRole('option', { name: 'No channels configured' }),
    ).toBeInTheDocument();
  });

  it('updates the notification template', () => {
    const { onChange } = renderBuilder([notify(1)], [discordChannel(1, 'Home', true)]);
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Car is warming up' },
    });
    expect(lastAction(onChange).template).toBe('Car is warming up');
  });

  it('updates the selected channel id', () => {
    const { onChange } = renderBuilder(
      [notify(1)],
      [discordChannel(1, 'Home', true), discordChannel(2, 'Garage', true)],
    );
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: '2' } });
    expect(lastAction(onChange).channel_id).toBe(2);
  });
});

// ── Set-setting editor ──────────────────────────────────────────────────────
describe('ActionFields — set_setting', () => {
  it('edits the setting key with the default text value editor', () => {
    const { onChange } = renderBuilder([
      { kind: 'action_set_setting', setting_key: '', value_text: '' },
    ]);
    expect(screen.getByLabelText('Setting Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Value Type')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Setting Key'), {
      target: { value: 'charge_limit' },
    });
    expect(lastAction(onChange).setting_key).toBe('charge_limit');
  });

  it('switches to a numeric editor and stores value_num', () => {
    const { onChange } = renderBuilder([
      { kind: 'action_set_setting', setting_key: 'charge_limit', value_text: '' },
    ]);
    fireEvent.change(screen.getByLabelText('Value Type'), { target: { value: 'number' } });
    expect(lastAction(onChange)).toEqual({
      kind: 'action_set_setting',
      setting_key: 'charge_limit',
      value_num: 0,
    });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '80' } });
    expect(lastAction(onChange).value_num).toBe(80);
  });

  it('switches to a boolean editor (True/False select) and stores value_bool', () => {
    const { onChange } = renderBuilder([
      { kind: 'action_set_setting', setting_key: 'sentry', value_text: '' },
    ]);
    fireEvent.change(screen.getByLabelText('Value Type'), { target: { value: 'boolean' } });
    expect(lastAction(onChange).value_bool).toBe(false);
    const valueSelect = screen.getByLabelText('Value');
    expect(valueSelect.tagName).toBe('SELECT');
    fireEvent.change(valueSelect, { target: { value: 'true' } });
    expect(lastAction(onChange).value_bool).toBe(true);
  });

  it('derives the "number" value type from an existing numeric value', () => {
    renderBuilder([{ kind: 'action_set_setting', setting_key: 'x', value_num: 42 }]);
    expect((screen.getByLabelText('Value Type') as HTMLSelectElement).value).toBe('number');
    expect((screen.getByLabelText('Value') as HTMLInputElement).value).toBe('42');
  });

  it('derives the "boolean" value type + label from an existing boolean value', () => {
    renderBuilder([{ kind: 'action_set_setting', setting_key: 'x', value_bool: true }]);
    expect((screen.getByLabelText('Value Type') as HTMLSelectElement).value).toBe('boolean');
    expect((screen.getByLabelText('Value') as HTMLSelectElement).value).toBe('true');
  });
});

// ── Call-automation editor ──────────────────────────────────────────────────
describe('ActionFields — call_automation', () => {
  it('shows an empty field for a zero target id and commits typed ids', () => {
    const { onChange } = renderBuilder([
      { kind: 'action_call_automation', target_automation_id: 0 },
    ]);
    const input = screen.getByLabelText('Target Automation ID') as HTMLInputElement;
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '5' } });
    expect(lastAction(onChange).target_automation_id).toBe(5);
  });

  it('renders an existing target automation id', () => {
    renderBuilder([{ kind: 'action_call_automation', target_automation_id: 7 }]);
    expect((screen.getByLabelText('Target Automation ID') as HTMLInputElement).value).toBe('7');
  });
});

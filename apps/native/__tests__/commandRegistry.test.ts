import {
  COMMAND_EVENT,
  TOUR_OPEN_LAUNCHER_EVENT,
  commandRegistry,
  emitCommandEvent,
  scoreCommand,
  subscribeCommandEvent,
  __resetCommandEventsForTests,
  type CommandContext,
} from '../src/web-parity/lib/commandRegistry';
import { semanticIconIntentNames } from '../src/components/icons/SemanticIcon';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  const t = (key: string, second?: unknown): string => {
    if (typeof second === 'string') {
      return second;
    }
    const opts = second as { defaultValue?: string } | undefined;
    return opts?.defaultValue ?? key;
  };
  return {
    navigate: jest.fn(),
    setMode: jest.fn(),
    setTheme: jest.fn(),
    isDarkMode: false,
    setVehicleId: jest.fn(),
    invalidateAll: jest.fn(async () => {}),
    t: t as CommandContext['t'],
    toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
    ...overrides,
  };
}

function byId(id: string) {
  const cmd = commandRegistry.find(c => c.id === id);
  if (!cmd) {
    throw new Error(`command not found: ${id}`);
  }
  return cmd;
}

afterEach(() => {
  __resetCommandEventsForTests();
});

describe('scoreCommand', () => {
  test('empty / whitespace query scores 1 (neutral)', () => {
    expect(scoreCommand('', 'Theme: Dark')).toBe(1);
    expect(scoreCommand('   ', 'Theme: Dark')).toBe(1);
  });

  test('exact label match scores 1000 (case-insensitive)', () => {
    expect(scoreCommand('theme: dark', 'Theme: Dark')).toBe(1000);
  });

  test('prefix match scores 500 + query length', () => {
    expect(scoreCommand('theme', 'Theme: Dark')).toBe(505);
  });

  test('substring match scores 200 + query length', () => {
    expect(scoreCommand('dark', 'Theme: Dark')).toBe(204);
  });

  test('acronym match scores 150', () => {
    expect(scoreCommand('oap', 'Open API playground')).toBe(150);
  });

  test('keyword prefix scores 100, keyword substring scores 50', () => {
    expect(scoreCommand('rel', 'Refresh data', ['reload'])).toBe(100);
    expect(scoreCommand('loa', 'Refresh data', ['reload'])).toBe(50);
  });

  test('subsequence match scores 25', () => {
    expect(scoreCommand('btr', 'Battery')).toBe(25);
  });

  test('no match scores 0', () => {
    expect(scoreCommand('zzz', 'Battery')).toBe(0);
  });
});

describe('commandRegistry data', () => {
  test('has 32 commands with unique ids', () => {
    expect(commandRegistry).toHaveLength(32);
    const ids = commandRegistry.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('preserves the audit-pinned literal feedback.open id', () => {
    expect(commandRegistry.some(c => c.id === 'feedback.open')).toBe(true);
  });

  test('every icon maps to a native SemanticIconName', () => {
    const names = new Set<string>(semanticIconIntentNames);
    for (const cmd of commandRegistry) {
      expect(names.has(cmd.icon)).toBe(true);
    }
  });

  test('every entry carries the required parity fields', () => {
    for (const cmd of commandRegistry) {
      expect(typeof cmd.labelKey).toBe('string');
      expect(typeof cmd.labelFallback).toBe('string');
      expect(['actions', 'preferences', 'pages', 'vehicles']).toContain(
        cmd.section,
      );
      expect(typeof cmd.perform).toBe('function');
    }
  });
});

describe('command-event bus (native window.dispatchEvent analog)', () => {
  test('subscribe receives emits and unsubscribe stops them', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeCommandEvent(
      COMMAND_EVENT.openThemePopover,
      listener,
    );
    emitCommandEvent(COMMAND_EVENT.openThemePopover);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    emitCommandEvent(COMMAND_EVENT.openThemePopover);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a throwing listener does not break the dispatch', () => {
    const good = jest.fn();
    subscribeCommandEvent(COMMAND_EVENT.openChangelog, () => {
      throw new Error('boom');
    });
    subscribeCommandEvent(COMMAND_EVENT.openChangelog, good);
    expect(() => emitCommandEvent(COMMAND_EVENT.openChangelog)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('TOUR_OPEN_LAUNCHER_EVENT keeps the web event string', () => {
    expect(TOUR_OPEN_LAUNCHER_EVENT).toBe('teslasync:tour:openLauncher');
  });
});

describe('command perform side effects', () => {
  test('theme commands set mode and theme', () => {
    const ctx = makeCtx();
    byId('pref.theme.oled').perform(ctx);
    expect(ctx.setMode).toHaveBeenCalledWith('oled');

    byId('pref.theme.teslaRed').perform(ctx);
    expect(ctx.setTheme).toHaveBeenCalledWith('tesla-red');
    expect(ctx.toast.info).toHaveBeenCalledWith('Switched to Tesla Red');
  });

  test('toggle mode flips based on host-supplied isDarkMode', () => {
    const darkCtx = makeCtx({ isDarkMode: true });
    byId('pref.theme.toggleMode').perform(darkCtx);
    expect(darkCtx.setMode).toHaveBeenCalledWith('light');
    expect(darkCtx.toast.info).toHaveBeenCalledWith('Switched to light mode');

    const lightCtx = makeCtx({ isDarkMode: false });
    byId('pref.theme.toggleMode').perform(lightCtx);
    expect(lightCtx.setMode).toHaveBeenCalledWith('dark');
    expect(lightCtx.toast.info).toHaveBeenCalledWith('Switched to dark mode');
  });

  test('refresh awaits invalidateAll then toasts success', async () => {
    const ctx = makeCtx();
    await byId('action.refresh').perform(ctx);
    expect(ctx.invalidateAll).toHaveBeenCalledTimes(1);
    expect(ctx.toast.success).toHaveBeenCalledWith('Data refreshed');
  });

  test('navigation commands route to their web paths', () => {
    const ctx = makeCtx();
    byId('action.alerts.new').perform(ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/notifications/studio');
    byId('action.alerts.test').perform(ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/alert-studio?test=1');
    byId('action.settings').perform(ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/settings');
  });

  test('feedback.open emits the decoupled open-feedback-modal event', () => {
    const listener = jest.fn();
    subscribeCommandEvent(COMMAND_EVENT.openFeedbackModal, listener);
    byId('feedback.open').perform(makeCtx());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('dashboard.edit navigates then defers the toggle-edit event', () => {
    jest.useFakeTimers();
    try {
      const ctx = makeCtx();
      const listener = jest.fn();
      subscribeCommandEvent(COMMAND_EVENT.dashboardToggleEdit, listener);
      byId('action.dashboard.edit').perform(ctx);
      expect(ctx.navigate).toHaveBeenCalledWith('/dashboard');
      expect(listener).not.toHaveBeenCalled();
      jest.advanceTimersByTime(50);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('frecency.reset clears the web localStorage key when present', () => {
    const removeItem = jest.fn();
    const original = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = { removeItem };
    try {
      const ctx = makeCtx();
      byId('action.frecency.reset').perform(ctx);
      expect(removeItem).toHaveBeenCalledWith('teslasync:cmd-frecency:v1');
      expect(ctx.toast.success).toHaveBeenCalledWith(
        'Command palette usage history cleared',
      );
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = original;
    }
  });
});

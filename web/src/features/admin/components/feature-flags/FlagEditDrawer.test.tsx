/**
 * FlagEditDrawer contract tests.
 *
 * FlagEditDrawer is the single form that powers BOTH the "create flag"
 * (`initial={null}`) and "edit flag" (`initial={entry}`) journeys. Its
 * job is to gate Save on a non-empty key and audit reason, then hand opaque
 * text to the parent. Empty, scalar-looking and structured-looking strings
 * round-trip unchanged. Pending, cancellation and reseeding behavior remain.
 *
 * react-i18next is stubbed to echo the English fallback (with `{{var}}`
 * interpolation) so assertions read against stable, in-repo copy regardless
 * of the shipped locale bundle — the same convention as FeatureFlagsPage.test.
 * No network is touched: the component is pure props in / callbacks out.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { FlagEditDrawer } from './FlagEditDrawer';
import { classifyFlagValue } from './flagValueKind';
import type {
  FeatureFlagEntry,
  FeatureFlagValue,
} from '@/types/admin-diagnostics';

// jsdom lacks matchMedia; the Drawer's framer-motion `motion.div` reaches for
// it during reduced-motion detection. A canonical stub removes the ambiguity.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => cleanup());

// ── Field / control accessors (accessible-name driven) ──
const keyField = () => screen.getByLabelText(/Flag key/i) as HTMLInputElement;
const valueField = () =>
  screen.getByLabelText(/^Value$/i) as HTMLTextAreaElement;
const reasonField = () => screen.getByLabelText(/reason/i) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /Save flag/i });
const cancelButton = () => screen.getByRole('button', { name: /^cancel$/i });

interface SetupOverrides {
  open?: boolean;
  initial?: FeatureFlagEntry | null;
  saving?: boolean;
}

function setup(overrides: SetupOverrides = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <FlagEditDrawer
      open={overrides.open ?? true}
      initial={overrides.initial ?? null}
      saving={overrides.saving ?? false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { onSave, onClose, ...utils };
}

/** Fill all three fields with valid input so Save becomes eligible. */
function fillValid(key = 'feature.new', value = '{"enabled":true}', reason = 'why') {
  fireEvent.change(keyField(), { target: { value: key } });
  fireEvent.change(valueField(), { target: { value } });
  fireEvent.change(reasonField(), { target: { value: reason } });
}

describe('FlagEditDrawer', () => {
  it.each(['', '0042', 'false', ' \n{"enabled":true}\n ', '[1,2]', '{ not json'])(
    'seeds and saves existing stored text %j without changing it',
    (value) => {
      const { onSave } = setup({ initial: { key: 'existing.flag', value } });
      expect(valueField()).toHaveValue(value);
      fireEvent.change(reasonField(), { target: { value: '  keep exact text  ' } });
      fireEvent.click(saveButton());
      expect(onSave).toHaveBeenCalledWith({
        key: 'existing.flag',
        value,
        reason: '  keep exact text  ',
      });
    },
  );

  it('renders nothing while closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Create flag')).not.toBeInTheDocument();
  });

  it('opens in CREATE mode with empty, editable fields and Save disabled', () => {
    setup({ initial: null });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Create flag')).toBeInTheDocument();

    const key = keyField();
    expect(key).toHaveValue('');
    expect(key).not.toBeDisabled();
    expect(valueField()).toHaveValue('');
    expect(reasonField()).toHaveValue('');

    // No key committed yet + no immutable helper in create mode.
    expect(
      screen.queryByText(/immutable once created/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Value is required.')).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('opens in EDIT mode with a disabled key, exact stored text, and immutable helper', () => {
    setup({ initial: { key: 'dlq.replay_enabled', value: '{\n  "enabled": true\n}' } });

    expect(
      screen.getByText('Edit flag "dlq.replay_enabled"'),
    ).toBeInTheDocument();

    const key = keyField();
    expect(key).toBeDisabled();
    expect(key).toHaveValue('dlq.replay_enabled');
    expect(valueField()).toHaveValue('{\n  "enabled": true\n}');
    expect(
      screen.getByText(/Flag keys are immutable once created/i),
    ).toBeInTheDocument();
  });

  it('enables Save and forwards the trimmed key with unchanged value and reason', () => {
    const { onSave } = setup();

    fillValid('  feature.new  ', '{"enabled":true}', '  rolling out  ');

    const save = saveButton();
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      key: 'feature.new',
      value: '{"enabled":true}',
      reason: '  rolling out  ',
    });
  });

  it('round-trips empty, numeric-looking, boolean-looking and structured text strings', () => {
    const cases: Array<{ raw: string; expected: FeatureFlagValue }> = [
      { raw: '', expected: '' },
      { raw: '   ', expected: '   ' },
      { raw: 'false', expected: 'false' },
      { raw: '0042', expected: '0042' },
      { raw: '[1,2,3]', expected: '[1,2,3]' },
      { raw: '"hi"', expected: '"hi"' },
      { raw: 'null', expected: 'null' },
      { raw: ' \n{"enabled":true}\n ', expected: ' \n{"enabled":true}\n ' },
    ];

    for (const { raw, expected } of cases) {
      const { onSave, unmount } = setup();
      expect(classifyFlagValue(raw)).toBe('string');
      fillValid('k', raw, 'r');
      fireEvent.click(saveButton());
      expect(onSave).toHaveBeenCalledWith({ key: 'k', value: expected, reason: 'r' });
      unmount();
    }
  });

  it('accepts arbitrary text without JSON validation', () => {
    const { onSave } = setup();

    fillValid('feature.new', '{ not json', 'reason');

    expect(screen.queryByText(/Invalid JSON/i)).not.toBeInTheDocument();
    expect(saveButton()).not.toBeDisabled();

    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledWith({ key: 'feature.new', value: '{ not json', reason: 'reason' });
  });

  it('keeps Save disabled until a nonblank reason is supplied', () => {
    setup();

    // Key + valid value only — reason still empty.
    fireEvent.change(keyField(), { target: { value: 'feature.new' } });
    fireEvent.change(valueField(), { target: { value: 'true' } });
    expect(saveButton()).toBeDisabled();

    // A whitespace-only reason does not satisfy the gate.
    fireEvent.change(reasonField(), { target: { value: '   ' } });
    expect(saveButton()).toBeDisabled();

    // A real reason flips it on.
    fireEvent.change(reasonField(), { target: { value: 'ship it' } });
    expect(saveButton()).not.toBeDisabled();
  });

  it('locks the footer and marks Save busy while saving', () => {
    setup({ saving: true });

    const save = saveButton();
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(cancelButton()).toBeDisabled();
  });

  it('routes Cancel, the header Close, and Escape to onClose without committing', () => {
    const { onSave, onClose } = setup();

    fireEvent.click(cancelButton());
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);

    expect(onSave).not.toHaveBeenCalled();
  });

  it('re-seeds the form when reopened for a different flag', () => {
    const flagA: FeatureFlagEntry = { key: 'flag.a', value: '1' };
    const flagB: FeatureFlagEntry = { key: 'flag.b', value: '{"mode":"x"}' };

    const { rerender } = render(
      <FlagEditDrawer
        open
        initial={flagA}
        saving={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // Operator starts drafting a reason against flag A…
    fireEvent.change(reasonField(), { target: { value: 'draft for A' } });
    expect(reasonField()).toHaveValue('draft for A');

    // …then the drawer closes and reopens for an unrelated flag B.
    rerender(
      <FlagEditDrawer
        open={false}
        initial={flagA}
        saving={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    rerender(
      <FlagEditDrawer
        open
        initial={flagB}
        saving={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(keyField()).toHaveValue('flag.b');
    expect(valueField()).toHaveValue(flagB.value);
    // The stale draft reason is discarded so B's audit row is never mislabeled.
    expect(reasonField()).toHaveValue('');
  });

  it('seeds and saves an existing empty stored string', () => {
    const initial: FeatureFlagEntry = { key: 'x.empty', value: '' };

    const { onSave } = setup({ initial });

    expect(screen.getByText('Edit flag "x.empty"')).toBeInTheDocument();
    expect(keyField()).toBeDisabled();
    expect(valueField()).toHaveValue('');
    fireEvent.change(reasonField(), { target: { value: 'keep default' } });
    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledWith({ key: 'x.empty', value: '', reason: 'keep default' });
  });
});

/**
 * FlagEditDrawer contract tests.
 *
 * FlagEditDrawer is the single form that powers BOTH the "create flag"
 * (`initial={null}`) and "edit flag" (`initial={entry}`) journeys. Its
 * whole job is to gate a Save on three independent conditions — a non-empty
 * key, a non-empty audit reason, and a value textarea that parses as JSON —
 * then hand the parsed value back to the parent. These tests pin the
 * behaviour an operator actually depends on:
 *
 *   1. Create vs edit chrome: title, key mutability, immutable-key helper,
 *      and the pretty-printed JSON seed for an existing value.
 *   2. The three-way Save gate (key / reason / valid-JSON) and the exact
 *      trimmed, parsed payload forwarded to `onSave`.
 *   3. Non-object JSON values (scalars, arrays, null) round-trip verbatim.
 *   4. Invalid JSON and empty value surface an inline error and lock Save.
 *   5. `saving` locks the whole footer and marks Save busy for AT.
 *   6. Cancel, the header Close affordance, and Escape all route to
 *      `onClose` without ever committing.
 *   7. Re-seeding: reopening for a different flag discards the previous
 *      draft instead of clobbering an unrelated row.
 *   8. Regression: a flag whose stored value is `undefined` seeds an empty
 *      editor instead of throwing (JSON.stringify(undefined) === undefined).
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
const keyField = () => screen.getByLabelText(/flag key/i) as HTMLInputElement;
const valueField = () =>
  screen.getByLabelText(/value \(json\)/i) as HTMLTextAreaElement;
const reasonField = () => screen.getByLabelText(/reason/i) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /save flag/i });
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
    // Empty value is surfaced as a required error, and Save is gated.
    expect(screen.getByText('Value is required.')).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it('opens in EDIT mode with a disabled key, pretty-printed value, and immutable helper', () => {
    setup({ initial: { key: 'dlq.replay_enabled', value: { enabled: true } } });

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

  it('enables Save on valid input and forwards the trimmed key + parsed value + trimmed reason', () => {
    const { onSave } = setup();

    fillValid('  feature.new  ', '{"enabled":true}', '  rolling out  ');

    const save = saveButton();
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      key: 'feature.new',
      value: { enabled: true },
      reason: 'rolling out',
    });
  });

  it('round-trips non-object JSON values (scalar, array, string, null)', () => {
    const cases: Array<{ raw: string; expected: FeatureFlagValue }> = [
      { raw: 'false', expected: false },
      { raw: '42', expected: 42 },
      { raw: '[1,2,3]', expected: [1, 2, 3] },
      { raw: '"hi"', expected: 'hi' },
      { raw: 'null', expected: null },
    ];

    for (const { raw, expected } of cases) {
      const { onSave, unmount } = setup();
      fillValid('k', raw, 'r');
      fireEvent.click(saveButton());
      expect(onSave).toHaveBeenCalledWith({ key: 'k', value: expected, reason: 'r' });
      unmount();
    }
  });

  it('locks Save and shows a parse error when the value is not valid JSON', () => {
    const { onSave } = setup();

    fillValid('feature.new', '{ not json', 'reason');

    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    // Clicking the disabled control must not commit.
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps Save disabled until BOTH a value and a reason are supplied', () => {
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
    const flagA: FeatureFlagEntry = { key: 'flag.a', value: 1 };
    const flagB: FeatureFlagEntry = { key: 'flag.b', value: { mode: 'x' } };

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
    expect(valueField()).toHaveValue(JSON.stringify(flagB.value, null, 2));
    // The stale draft reason is discarded so B's audit row is never mislabeled.
    expect(reasonField()).toHaveValue('');
  });

  it('seeds an empty editor for a flag whose stored value is undefined instead of crashing', () => {
    const initial: FeatureFlagEntry = { key: 'x.undef', value: undefined };

    // Before the null-safety fix, defaultValueJson returned `undefined` and the
    // first `valueInput.trim()` threw, blank-crashing the drawer on mount.
    expect(() => setup({ initial })).not.toThrow();

    expect(screen.getByText('Edit flag "x.undef"')).toBeInTheDocument();
    expect(keyField()).toBeDisabled();
    expect(valueField()).toHaveValue('');
    expect(screen.getByText('Value is required.')).toBeInTheDocument();
  });
});

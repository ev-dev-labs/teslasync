/**
 * TOUSettingsModal tests.
 *
 * The modal has one exported component (`TOUSettingsModal`). These tests
 * exercise every meaningful branch of its behaviour:
 *
 *   1. Visibility — renders nothing when closed, full dialog when open.
 *   2. Preset tab — JSON preview on selection, "no preset" validation
 *      guard, and the payload shape sent to the update mutation.
 *   3. Custom-JSON tab — empty / malformed / non-object rejection, the
 *      full-envelope pass-through, and the bare-object wrapping branch.
 *   4. Submit result flows — success refreshes site info + closes;
 *      failure surfaces the error and keeps the dialog open.
 *   5. Pending state — actions disabled, submit marked aria-busy, and the
 *      close (X) guard that blocks closing mid-request.
 *   6. Error hygiene — Cancel clears a stale error; switching tabs clears
 *      a stale error (regression guard for the cross-tab error bug).
 *
 * The two energy mutation hooks are mocked so the component's callback
 * wiring can be driven deterministically without touching the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { TOUSettingsPayload } from '@/types/energy';

interface UpdateVars {
  siteId: number;
  settings: TOUSettingsPayload;
}
interface MutateOpts {
  onSuccess?: () => void;
  onError?: (err: unknown) => void;
}

// Hoisted so the (also hoisted) vi.mock factory below can close over them.
const { updateMutate, refreshMutate, hookState } = vi.hoisted(() => ({
  updateMutate: vi.fn<(vars: UpdateVars, opts?: MutateOpts) => void>(),
  refreshMutate: vi.fn<(siteId: number) => void>(),
  hookState: { pending: false },
}));

vi.mock('@/api/hooks/useEnergy', () => ({
  useUpdateTOUSettings: () => ({ mutate: updateMutate, isPending: hookState.pending }),
  useRefreshTeslaEnergySiteInfo: () => ({ mutate: refreshMutate }),
}));

// Deterministic i18n: return the English fallback so assertions do not
// depend on which translation bundle happens to be loaded.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { TOUSettingsModal } from './TOUSettingsModal';

const SITE_ID = 7;
const SUBMIT = /^Update Rate Plan$/i;

function renderModal(overrides: Partial<React.ComponentProps<typeof TOUSettingsModal>> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const utils = render(<TOUSettingsModal open onClose={onClose} siteId={SITE_ID} {...overrides} />);
  return { ...utils, onClose };
}

function firstUpdateCall(): UpdateVars {
  return updateMutate.mock.calls[0][0];
}

beforeEach(() => {
  updateMutate.mockReset();
  refreshMutate.mockReset();
  hookState.pending = false;
});

afterEach(() => cleanup());

describe('TOUSettingsModal — visibility', () => {
  it('renders nothing when closed', () => {
    renderModal({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog, both tabs, and the action buttons when open', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: /Update Rate Plan/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Preset Tariff/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Custom JSON/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SUBMIT })).toBeInTheDocument();
    // Preset tab is active by default → the rate-plan Select is shown.
    expect(screen.getByLabelText('Rate Plan')).toBeInTheDocument();
    // Icon-only close control keeps an accessible name.
    expect(screen.getByRole('button', { name: /Close/i })).toBeInTheDocument();
  });
});

describe('TOUSettingsModal — preset tab', () => {
  it('shows a JSON preview reflecting the chosen preset', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Rate Plan'), { target: { value: 'pge-ev2a' } });
    const preview = document.body.querySelector('pre');
    expect(preview).not.toBeNull();
    expect(preview?.textContent).toContain('PG&E EV2-A');
    expect(preview?.textContent).toContain('optimization_strategy');
  });

  it('blocks submit with an alert when no preset is selected', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Please select a rate plan/i);
    expect(updateMutate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits the selected preset payload to the update mutation', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Rate Plan'), { target: { value: 'sce-tou-d' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const vars = firstUpdateCall();
    expect(vars.siteId).toBe(SITE_ID);
    expect(vars.settings.tou_settings.tariff_content_v2?.name).toBe('SCE TOU-D');
  });
});

describe('TOUSettingsModal — custom JSON tab', () => {
  function gotoCustom() {
    fireEvent.click(screen.getByRole('tab', { name: /Custom JSON/i }));
  }

  it('swaps the preset select for the JSON textarea', () => {
    renderModal();
    gotoCustom();
    expect(screen.getByLabelText('TOU Settings JSON')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rate Plan')).toBeNull();
  });

  it('rejects an empty payload', () => {
    renderModal();
    gotoCustom();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Please enter the TOU settings JSON/i);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', () => {
    renderModal();
    gotoCustom();
    fireEvent.change(screen.getByLabelText('TOU Settings JSON'), { target: { value: '{ not json' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid JSON/i);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('rejects a JSON array (must be an object)', () => {
    renderModal();
    gotoCustom();
    fireEvent.change(screen.getByLabelText('TOU Settings JSON'), { target: { value: '[1, 2, 3]' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent(/JSON must be an object/i);
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('passes a full { tou_settings } envelope through unchanged', () => {
    renderModal();
    gotoCustom();
    const envelope = { tou_settings: { optimization_strategy: 'economics' } };
    fireEvent.change(screen.getByLabelText('TOU Settings JSON'), {
      target: { value: JSON.stringify(envelope) },
    });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(firstUpdateCall().settings).toEqual(envelope);
  });

  it('wraps a bare inner object inside tou_settings', () => {
    renderModal();
    gotoCustom();
    fireEvent.change(screen.getByLabelText('TOU Settings JSON'), {
      target: { value: '{"optimization_strategy":"self_consumption"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(firstUpdateCall().settings).toEqual({
      tou_settings: { optimization_strategy: 'self_consumption' },
    });
  });
});

describe('TOUSettingsModal — submit result flows', () => {
  it('refreshes Tesla site info and closes on success', () => {
    updateMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Rate Plan'), { target: { value: 'pge-ev2a' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(refreshMutate).toHaveBeenCalledWith(SITE_ID);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('surfaces the mutation error and keeps the dialog open on failure', () => {
    updateMutate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('Tesla API rejected')));
    const { onClose } = renderModal();
    fireEvent.change(screen.getByLabelText('Rate Plan'), { target: { value: 'pge-ev2a' } });
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Tesla API rejected/i);
    expect(refreshMutate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('TOUSettingsModal — pending + error hygiene', () => {
  it('disables actions and marks submit busy while the request is pending', () => {
    hookState.pending = true;
    renderModal();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled();
    const submit = screen.getByRole('button', { name: SUBMIT });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
  });

  it('ignores the close (X) button while pending', () => {
    hookState.pending = true;
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel clears a stale error and closes when idle', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears a stale validation error when switching tabs', () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Please select a rate plan/i);
    fireEvent.click(screen.getByRole('tab', { name: /Custom JSON/i }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

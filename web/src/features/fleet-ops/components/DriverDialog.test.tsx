/**
 * DriverDialog — guardrail fields round-trip into the create payload and
 * invalid guardrails block submit.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('@/api/hooks/useFleetOps', () => {
  const mutation = () => ({ mutate: h.mutate, reset: h.reset, isPending: false, error: null });
  return { useCreateFleetDriver: mutation, useUpdateFleetDriver: mutation };
});

import { DriverDialog } from './DriverDialog';

const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  h.mutate.mockClear();
});

describe('DriverDialog guardrails', () => {
  it('submits charge cap + curfew in the create payload', () => {
    render(<DriverDialog item={null} {...callbacks} />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Teen' } });
    fireEvent.change(screen.getByLabelText('Non-sensitive reference code'), { target: { value: 'T1' } });
    fireEvent.change(screen.getByLabelText('Charge cap (%)'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Curfew start'), { target: { value: '22:00' } });
    fireEvent.change(screen.getByLabelText('Curfew end'), { target: { value: '06:00' } });
    fireEvent.click(screen.getByText('Save'));

    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      display_name: 'Teen',
      max_charge_soc: 80,
      curfew_start: '22:00',
      curfew_end: '06:00',
    });
  });

  it('blocks submit on a half-set curfew', () => {
    render(<DriverDialog item={null} {...callbacks} />);
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Teen' } });
    fireEvent.change(screen.getByLabelText('Non-sensitive reference code'), { target: { value: 'T1' } });
    fireEvent.change(screen.getByLabelText('Curfew start'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByText('Save'));

    expect(screen.getByText('Set both curfew start and end, or neither.')).toBeTruthy();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('seeds guardrails when editing an existing driver', () => {
    render(
      <DriverDialog
        item={{
          id: 1, display_name: 'Teen', reference_code: 'T1', status: 'active',
          max_charge_soc: 80, curfew_start: '22:00', curfew_end: '06:00',
          version: 2, created_at: '', updated_at: '',
        }}
        {...callbacks}
      />,
    );
    expect(screen.getByLabelText('Charge cap (%)')).toHaveProperty('value', '80');
    expect(screen.getByLabelText('Curfew start')).toHaveProperty('value', '22:00');
  });
});

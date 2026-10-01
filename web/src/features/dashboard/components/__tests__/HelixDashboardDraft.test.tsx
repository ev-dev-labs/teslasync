import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  enabled: false,
  pending: false,
  error: false,
  mutate: vi.fn(),
}));

vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => h.enabled }));
vi.mock('@/api/hooks/useDashboard', () => ({
  useDraftDashboardWidgets: () => ({ isPending: h.pending, isError: h.error, mutate: h.mutate }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

import { HelixDashboardDraft } from '../HelixDashboardDraft';

afterEach(() => {
  cleanup();
  h.enabled = false;
  h.pending = false;
  h.error = false;
  h.mutate.mockReset();
});

describe('HelixDashboardDraft', () => {
  it('does not render or call the API while the feature is off', () => {
    render(<HelixDashboardDraft onDraft={vi.fn()} />);
    expect(screen.queryByText('Create with Helix')).not.toBeInTheDocument();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('validates the prompt and only forwards real, unique widget IDs', () => {
    h.enabled = true;
    const onDraft = vi.fn();
    h.mutate.mockImplementation((_input, { onSuccess }) => {
      onSuccess({ title: 'My desk', widget_ids: ['invented-widget'] });
    });
    render(<HelixDashboardDraft onDraft={onDraft} />);
    const button = screen.getByRole('button', { name: 'Draft layout' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe your dashboard' }), {
      target: { value: '  charging and battery  ' },
    });
    fireEvent.click(button);
    expect(h.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'charging and battery' }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(onDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeVisible();
    h.mutate.mockImplementation((_input, { onSuccess }) => {
      onSuccess({ title: 'My desk', widget_ids: ['battery-gauge'] });
    });
    fireEvent.click(button);
    expect(onDraft).toHaveBeenCalledWith({ title: 'My desk', widget_ids: ['battery-gauge'] });
  });

  it('shows a request error without creating a layout', () => {
    h.enabled = true;
    h.error = true;
    render(<HelixDashboardDraft onDraft={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Helix could not create a valid layout');
  });
});

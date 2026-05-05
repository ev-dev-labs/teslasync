// Phase-46 / Prompt 50 — ResetSection adoption tests.
//
// The component talks to the backend via two hooks
// (`useResetSection` / `useResetAllSettings`) which both round-trip
// through the shared `request()` client. We mock @/api/client so the
// hook layer flows through one router-style switch and we can assert
// on the request shape (path + method + body) the SPA puts on the
// wire.
//
// Tests mirror the WebhookChannelsSection.test.tsx scaffold:
//   • react-i18next stub with {{var}} interpolation
//   • render inside QueryClientProvider + ToastProvider
//   • fireEvent only (user-event is not installed in this repo)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>(
    '@/api/client',
  );
  return {
    ...actual,
    request: vi.fn(),
  };
});

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback =
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined;
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined);
        let result = fallback ?? key;
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(
              new RegExp(`{{${k}}}`, 'g'),
              String(v),
            );
          }
        }
        return result;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { ResetSection } from './ResetSection';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ResetSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('ResetSection — render', () => {
  it('renders all 8 whitelisted sections', () => {
    renderSection();
    expect(screen.getByTestId('reset-section-row-general')).toBeInTheDocument();
    expect(screen.getByTestId('reset-section-row-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('reset-section-row-alert_rules')).toBeInTheDocument();
    expect(screen.getByTestId('reset-section-row-geofences')).toBeInTheDocument();
    expect(
      screen.getByTestId('reset-section-row-notification_channels'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('reset-section-row-dashboard_layout'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('reset-section-row-automations')).toBeInTheDocument();
    expect(screen.getByTestId('reset-section-row-quiet_hours')).toBeInTheDocument();
  });

  it('renders the deny-list panel with both denied sections', () => {
    renderSection();
    expect(
      screen.getByTestId('reset-section-denied-row-tariffs'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('reset-section-denied-row-sound_prefs'),
    ).toBeInTheDocument();
  });

  it('renders the danger zone with the global reset button', () => {
    renderSection();
    expect(screen.getByTestId('reset-section-danger-zone')).toBeInTheDocument();
    expect(screen.getByTestId('reset-section-reset-all')).toBeInTheDocument();
  });
});

describe('ResetSection — per-section reset', () => {
  it('opens the confirm dialog when a section reset button is clicked', async () => {
    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-button-alert_rules'));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // No request should be issued before the user confirms.
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('cancels cleanly when the user dismisses the per-section dialog', async () => {
    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-button-alert_rules'));
    await waitFor(() => screen.getByRole('dialog'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('posts /settings/reset { section } on confirm', async () => {
    mockedRequest.mockResolvedValue({
      reset: 3,
      sections: [{ section: 'alert_rules', reset: 3 }],
    });

    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-button-alert_rules'));
    await waitFor(() => screen.getByRole('dialog'));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Reset'));

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/reset',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ section: 'alert_rules' }),
        }),
      );
    });
    // Dialog closes after the mutation resolves.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('posts the correct section name for geofences', async () => {
    mockedRequest.mockResolvedValue({
      reset: 1,
      sections: [{ section: 'geofences', reset: 1 }],
    });

    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-button-geofences'));
    await waitFor(() => screen.getByRole('dialog'));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Reset'));

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/reset',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ section: 'geofences' }),
        }),
      );
    });
  });
});

describe('ResetSection — danger zone', () => {
  it('opens the typed-confirmation dialog for the global reset', async () => {
    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-reset-all'));
    await waitFor(() => screen.getByRole('dialog'));
    const dialog = screen.getByRole('dialog');
    // The typed-confirmation input is rendered.
    expect(within(dialog).getByPlaceholderText('RESET')).toBeInTheDocument();
  });

  it('keeps the confirm button disabled until "RESET" is typed', async () => {
    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-reset-all'));
    await waitFor(() => screen.getByRole('dialog'));

    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByPlaceholderText('RESET');
    const confirmBtn = within(dialog).getByText('Reset everything')
      .closest('button');
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'reset' } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: 'RESET' } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it('posts /settings/reset {} when the typed confirmation matches', async () => {
    mockedRequest.mockResolvedValue({
      reset: 12,
      sections: [
        { section: 'general', reset: 4 },
        { section: 'alert_rules', reset: 8 },
      ],
    });

    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-reset-all'));
    await waitFor(() => screen.getByRole('dialog'));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('RESET'), {
      target: { value: 'RESET' },
    });
    fireEvent.click(within(dialog).getByText('Reset everything'));

    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledWith(
        '/settings/reset',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({}),
        }),
      );
    });
  });

  it('cancels the global reset cleanly when the user dismisses', async () => {
    renderSection();
    fireEvent.click(screen.getByTestId('reset-section-reset-all'));
    await waitFor(() => screen.getByRole('dialog'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockedRequest).not.toHaveBeenCalled();
  });
});

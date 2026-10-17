import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutateAsync, writeText } = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@/api/hooks/useNotificationChannels', () => ({
  useWebhookSignaturePreview: () => ({ mutateAsync }),
}));

vi.mock('@/components/ui', async () => ({
  ...await import('@/components/ui/Typography'),
  ...await import('@/components/ui/CopyButton'),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: { error?: string }) =>
      fallback.replace('{{error}}', options?.error ?? ''),
  }),
}));

import { WebhookSignaturePreview } from './WebhookSignaturePreview';

const SIGNATURE = 'sha256=0123456789abcdef';
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

async function computePreview() {
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

async function copySignature() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mutateAsync.mockReset().mockResolvedValue({ signature: SIGNATURE });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('WebhookSignaturePreview', () => {
  it('preserves the populated signature and copies its exact value', async () => {
    render(<WebhookSignaturePreview secret=" signing-secret " />);
    expect(screen.getByText('Computing signature…')).toBeInTheDocument();
    await computePreview();
    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      secret: ' signing-secret ',
      body: JSON.stringify({
        title: 'Test event', message: 'Hello from TeslaSync', source: 'teslasync', test: true,
      }),
    });
    expect(screen.getByText(SIGNATURE)).toBeInTheDocument();
    await copySignature();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(SIGNATURE);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces clipboard failure without losing the signature and clears feedback after retry', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    render(<WebhookSignaturePreview secret="secret" />);
    await computePreview();
    await copySignature();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to copy');
    expect(screen.getByText(SIGNATURE)).toBeInTheDocument();
    expect(screen.queryByText('Computing signature…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    await copySignature();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenNthCalledWith(2, SIGNATURE);
  });

  it('clears clipboard feedback when the signing secret changes', async () => {
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    const { rerender } = render(<WebhookSignaturePreview secret="secret" />);
    await computePreview();
    await copySignature();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(<WebhookSignaturePreview secret="new-secret" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Computing signature…')).toBeInTheDocument();
    await computePreview();
    expect(screen.getByText(SIGNATURE)).toBeInTheDocument();
  });

  it('does not compute a signature for an empty secret', async () => {
    render(<WebhookSignaturePreview secret="  " />);
    await computePreview();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Add a signing secret to preview the X-TeslaSync-Signature header.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserves signature-computation error feedback', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('Preview unavailable'));
    render(<WebhookSignaturePreview secret="secret" />);
    await computePreview();
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to compute signature: Preview unavailable');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

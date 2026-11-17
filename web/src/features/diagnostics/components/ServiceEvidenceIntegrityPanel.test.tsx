import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { analyzeRootCause } from '../lib/rootCauseIntelligence';
import { buildServiceEvidencePackCore, toPrettyJson, type ServiceEvidencePackDocument } from '../lib/serviceEvidencePack';
import { ServiceEvidenceIntegrityPanel } from './ServiceEvidenceIntegrityPanel';

const pack: ServiceEvidencePackDocument = {
  ...buildServiceEvidencePackCore({
    vehicle: { id: 7, displayName: 'Existing vehicle' },
    analysis: analyzeRootCause({ focalSignal: 'Soc', catalog: ['Soc'], focalPoints: [], relatedSeries: [] }),
    windowHours: 24, now: () => '2026-10-06T00:00:00Z',
  }),
  integrity: {
    algorithm: 'SHA-256', digestHex: '0123456789abcdef'.repeat(4),
    canonicalizationNote: 'Canonical JSON without integrity', isSignature: false,
  },
};
function props() {
  return {
    canGenerate: true, generating: false, pack, generationError: null,
    onGenerate: vi.fn(), onDismissError: vi.fn(), onExport: vi.fn(),
  };
}

describe('generated service evidence native integrity record', () => {
  it.each(PACK_IDS)('%s owns the generated record without changing its digest, metadata or export callback', packId => {
    const current = props();
    const original = toPrettyJson(pack);
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
      <ServiceEvidenceIntegrityPanel {...current} />
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const record = container.querySelector('[data-app-card-kind="record"]')!;
      expect(record).toHaveAttribute('data-surface-variant', 'standalone');
      expectAppDesignDataMode(record, APPLICATION_DESIGNS[packId].data, '[data-app-card-kind="record"]');
      expectAppDesignDataMode(record.querySelector(':scope > [data-app-part~="record-body"]')!,
        APPLICATION_DESIGNS[packId].data, '[data-app-card-kind="record"]');
      expectAppDesignDataMode(record.querySelector('[data-app-part~="record-context"]')!,
        APPLICATION_DESIGNS[packId].data, '[data-app-card-kind="record"]');
      expect(record.querySelector('code')).toHaveTextContent(pack.integrity.digestHex);
      expect(record.querySelector('code')).toHaveClass('min-w-0', 'break-all');
      expect(record).toHaveTextContent(`Schema ${pack.schemaVersion}`);
      expect(screen.getByText(/it is not a digital signature/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
      expect(current.onExport).toHaveBeenCalledOnce();
      expect(current.onGenerate).not.toHaveBeenCalled();
      expect(toPrettyJson(pack)).toBe(original);
    } finally { release(); }
  });

  it('copies the exact digest bytes through the real shared copy action', async () => {
    const user = userEvent.setup();
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText');
    render(<ServiceEvidenceIntegrityPanel {...props()} />);
    await user.click(screen.getByRole('button', { name: 'Copy digest' }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith(pack.integrity.digestHex));
    expect(screen.getByRole('button', { name: 'Copy digest' })).toBeEnabled();
    clipboard.mockRestore();
  });

  it('retains prerequisites, pending generation and crypto error recovery without fabricating a pack', () => {
    const current = props();
    const view = render(<ServiceEvidenceIntegrityPanel {...current} canGenerate={false} pack={null} />);
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
    expect(screen.getByText(/clears the minimum evidence bar/)).toBeInTheDocument();
    view.rerender(<ServiceEvidenceIntegrityPanel {...current} pack={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate pack' }));
    expect(current.onGenerate).toHaveBeenCalledOnce();
    view.rerender(<ServiceEvidenceIntegrityPanel {...current} generating pack={null} />);
    expect(screen.getByRole('button', { name: 'Generate pack' })).toBeDisabled();
    view.rerender(<ServiceEvidenceIntegrityPanel {...current} pack={null} generationError="Web Crypto unavailable" />);
    expect(screen.getByText('Web Crypto unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(current.onDismissError).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Download JSON' })).toBeNull();
    expect(current.onExport).not.toHaveBeenCalled();
  });
});

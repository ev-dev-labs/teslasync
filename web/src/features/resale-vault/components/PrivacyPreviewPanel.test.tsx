import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyPreviewPanel } from './PrivacyPreviewPanel';
import { makeMinimalReport } from '../lib/testFixtures';

// Deterministic i18n: echo the inline English fallback and apply {{var}}
// interpolation so assertions on dynamic counts/dates ("Always excluded
// (1)") work without depending on a real i18next instance. Mirrors the
// pattern in `features/onboarding/TourLauncher.test.tsx`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
        let out = typeof fallback === 'string' ? fallback : key;
        if (opts && typeof opts === 'object') {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v));
          }
        }
        return out;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

describe('PrivacyPreviewPanel', () => {
  it('renders a "build a report first" empty state when report is null', () => {
    render(<PrivacyPreviewPanel report={null} />);
    expect(screen.getByText(/Build a report to see/i)).toBeInTheDocument();
  });

  it('renders the report id and time bounds', () => {
    render(<PrivacyPreviewPanel report={makeMinimalReport()} />);
    expect(screen.getByText('report_test_0001')).toBeInTheDocument();
    expect(screen.getByText(/2022-06-01/)).toBeInTheDocument();
  });

  it('renders hard-excluded, coarsened, and limitation entries', () => {
    render(<PrivacyPreviewPanel report={makeMinimalReport()} />);
    expect(screen.getByText(/Always excluded \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Coarsened \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/fleet-wide "first vehicle"/)).toBeInTheDocument();
  });

  it('shows "no sections excluded" copy when excluded_by_selection is empty', () => {
    render(<PrivacyPreviewPanel report={makeMinimalReport()} />);
    expect(screen.getByText(/Every evidence section is included/i)).toBeInTheDocument();
  });

  it('renders included-with-warning callouts when present', () => {
    const report = makeMinimalReport({
      redaction_manifest: {
        hard_excluded: [],
        excluded_by_selection: [],
        coarsened: [],
        included_with_warning: [{ field: 'vehicle_identity.vin_masked', reason: 'Warning: masked VIN still narrows down the vehicle.' }],
      },
    });
    render(<PrivacyPreviewPanel report={report} />);
    expect(screen.getByText(/masked VIN still narrows down/i)).toBeInTheDocument();
  });

  it('renders the attestation statement', () => {
    render(<PrivacyPreviewPanel report={makeMinimalReport()} />);
    expect(screen.getByText(/attests only that the enclosed data/i)).toBeInTheDocument();
  });
});

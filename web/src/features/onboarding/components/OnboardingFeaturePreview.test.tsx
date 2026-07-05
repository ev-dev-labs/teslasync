import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { OnboardingFeaturePreview } from './OnboardingFeaturePreview';

// Mock react-i18next so `t(key, fallback)` deterministically returns the
// English fallback copy (mirrors the repo's checklist.test.ts convention).
// `tSpy` is hoisted so the module factory can close over it while still
// letting the assertions verify which i18n keys the component requests.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tSpy }),
}));

const FEATURES = [
  {
    key: 'onboarding.tracking',
    title: 'Real-time Tracking',
    desc: 'Follow location, speed, and state live on the map.',
  },
  {
    key: 'onboarding.drives',
    title: 'Drive History',
    desc: 'Every trip logged with route, efficiency, and stats.',
  },
  {
    key: 'onboarding.charging',
    title: 'Charge Analytics',
    desc: 'Track sessions, costs, and battery health over time.',
  },
  {
    key: 'onboarding.control',
    title: 'Vehicle Control',
    desc: 'Climate, charging, and locks — all from one place.',
  },
] as const;

describe('OnboardingFeaturePreview', () => {
  beforeEach(() => {
    tSpy.mockClear();
  });

  it('renders every feature card with its title and description', () => {
    render(<OnboardingFeaturePreview />);

    for (const feature of FEATURES) {
      expect(screen.getByText(feature.title)).toBeInTheDocument();
      expect(screen.getByText(feature.desc)).toBeInTheDocument();
    }

    // Exactly four capability tiles — no more, no fewer.
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders each feature title as a level-3 panel heading', () => {
    render(<OnboardingFeaturePreview />);

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(4);
    expect(headings.map((h) => h.textContent)).toEqual([
      'Real-time Tracking',
      'Drive History',
      'Charge Analytics',
      'Vehicle Control',
    ]);
  });

  it('exposes the grid as an accessible list with a descriptive label', () => {
    render(<OnboardingFeaturePreview />);

    const list = screen.getByRole('list', { name: "What you'll unlock" });
    expect(list).toBeInTheDocument();
    // Every card is a direct list item of the labelled list.
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
  });

  it('marks the leading icons as decorative so screen readers skip them', () => {
    const { container } = render(<OnboardingFeaturePreview />);

    const decorativeIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(decorativeIcons).toHaveLength(4);
    // Decorative icons must not carry an accessible name.
    decorativeIcons.forEach((icon) => {
      expect(icon.getAttribute('aria-label')).toBeNull();
    });
  });

  it('merges a custom className onto the grid while keeping base layout classes', () => {
    render(<OnboardingFeaturePreview className="mt-8 custom-band" />);

    const list = screen.getByRole('list');
    expect(list.className).toContain('custom-band');
    expect(list.className).toContain('mt-8');
    // The intrinsic responsive grid classes survive the merge.
    expect(list.className).toContain('grid');
    expect(list.className).toContain('lg:grid-cols-4');
  });

  it('renders safely without a className and defaults to the four-column grid', () => {
    render(<OnboardingFeaturePreview />);

    const list = screen.getByRole('list');
    expect(list).toBeInTheDocument();
    expect(list.className).toContain('grid-cols-2');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('requests the expected i18n keys with English fallbacks', () => {
    render(<OnboardingFeaturePreview />);

    // Section label for the list landmark.
    expect(tSpy).toHaveBeenCalledWith('onboarding.unlock.title', "What you'll unlock");

    // Each feature resolves both a title key and an "unlock" description key.
    for (const feature of FEATURES) {
      expect(tSpy).toHaveBeenCalledWith(feature.key, feature.title);
    }
    expect(tSpy).toHaveBeenCalledWith(
      'onboarding.unlock.tracking',
      'Follow location, speed, and state live on the map.',
    );
    expect(tSpy).toHaveBeenCalledWith(
      'onboarding.unlock.control',
      'Climate, charging, and locks — all from one place.',
    );
  });
});

import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { BADGE_VARIANTS } from '@/components/ui';
import catalog from '@/i18n/en.json';
import { SoftwareUpdateBadge, type UpdateStatus } from './SoftwareUpdateBadge';

vi.unmock('react-i18next');

async function canonicalI18n() {
  const missingKeyHandler = vi.fn();
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    fallbackNS: 'translation',
    resources: { en: { translation: catalog } },
    saveMissing: true,
    missingKeyHandler,
    interpolation: { escapeValue: false },
  });
  return { i18n, missingKeyHandler };
}

const statuses = [
  { status: 'unknown', label: catalog.common.unknown, variant: 'neutral' },
  { status: 'up-to-date', label: catalog.widget.statusUpToDate, variant: 'success' },
  { status: 'available', label: catalog.widget.statusAvailable, variant: 'info' },
  { status: 'downloading', label: catalog.widget.statusDownloading, variant: 'warning' },
  { status: 'ready', label: catalog.widget.statusReady, variant: 'info' },
  { status: 'installing', label: catalog.widget.statusInstalling, variant: 'warning' },
  { status: 'installed', label: catalog.widget.statusInstalled, variant: 'success' },
] satisfies Array<{
  status: UpdateStatus;
  label: string;
  variant: keyof typeof BADGE_VARIANTS;
}>;

describe('SoftwareUpdateBadge canonical translations', () => {
  it('resolves the dotted common key through the actual translation resource, not a common namespace', async () => {
    const { i18n } = await canonicalI18n();

    expect(i18n.hasResourceBundle('en', 'common')).toBe(false);
    expect(i18n.getResource('en', 'translation', 'common.unknown')).toBe(catalog.common.unknown);
    expect(i18n.exists('common:unknown', { ns: 'dashboard' })).toBe(false);
    expect(i18n.t('common.unknown', { ns: 'dashboard', returnDetails: true })).toMatchObject({
      res: catalog.common.unknown,
      usedNS: 'translation',
      exactUsedKey: 'common.unknown',
    });
  });

  it.each(statuses)('renders $status with its existing variant, small size and decorative dot', async ({ status, label, variant }) => {
    const { i18n, missingKeyHandler } = await canonicalI18n();
    render(
      <I18nextProvider i18n={i18n}>
        <SoftwareUpdateBadge status={status} />
      </I18nextProvider>,
    );

    const badge = screen.getByText(label);
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveClass(...BADGE_VARIANTS[variant].split(' '));
    expect(badge).toHaveClass('px-1.5', 'py-0.5', 'text-xs');
    expect(badge.querySelector('[aria-hidden="true"]')).toHaveClass('bg-current', 'rounded-full', 'shrink-0');
    // English fallback equals the catalog value, so text alone cannot detect a namespace miss.
    expect(missingKeyHandler).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { WarrantyDataView } from '../vehicle-management/WarrantyDataView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
    i18n: { language: 'en' },
  }),
}));

describe('Warranty summary and retained entity details', () => {
  it('reviews returned group counts without reformatting unknown-unit odometer limits or hiding entity details', () => {
    render(<MemoryRouter><WarrantyDataView data={{
      activeWarranty: [{ warrantyDisplayName: 'Basic coverage', coverageAgeInYears: 4, expirationOdometer: 50000 }],
      upcomingWarranty: [],
      expiredWarranty: [{ warrantyDisplayName: 'Expired coverage', coverageAgeInMonths: 12 }],
    }} /></MemoryRouter>);
    const brief = screen.getByTestId('vehicle-warranty-counts');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelector('[data-operational-metric="upcoming"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="upcoming"]')).toHaveTextContent('0');
    expect(screen.getByRole('heading', { name: 'Basic coverage' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expired coverage' })).toBeInTheDocument();
    expect(screen.getByText('50,000')).toBeInTheDocument();
    expect(screen.getByText(/response does not identify a unit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Technical response details' })).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('1 active')).toBeInTheDocument();
    expect(within(drawer).getByText('0 upcoming')).toBeInTheDocument();
    expect(within(drawer).getByText('1 expired')).toBeInTheDocument();
  });

  it('retains the existing successful empty-response and technical-details paths without inventing coverage', () => {
    render(<MemoryRouter><WarrantyDataView data={{ activeWarranty: [], expiredWarranty: [] }} /></MemoryRouter>);
    expect(screen.getByText('No warranty coverage returned')).toBeInTheDocument();
    expect(screen.queryByTestId('vehicle-warranty-counts')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Technical response details' })).toBeInTheDocument();
  });
});

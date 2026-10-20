import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TcoLedgerCategory, TcoLedgerEntry } from '@/types/analytics';
import en from '@/i18n/en.json';
import { DataTable } from '@/components/ui';
import { TrueCostLedgerForm } from './TrueCostLedgerForm';
import { makeTrueCostLedgerColumns } from './TrueCostLedgerColumns';
import { ledgerCategoryLabel } from './ledgerCategoryLabel';

vi.unmock('react-i18next');

const categories: TcoLedgerCategory[] = [
  'payment', 'insurance', 'maintenance', 'service',
  'tires', 'accessories', 'depreciation', 'other',
];
const labels = ['Payment', 'Insurance', 'Maintenance', 'Service', 'Tires', 'Accessories', 'Depreciation', 'Other'];
const localized = ['Paiement', 'Assurance', 'Entretien', 'Service localisé', 'Pneus', 'Accessoires', 'Dépréciation', 'Autre'];
const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({
    lng: 'fr', fallbackLng: 'en',
    resources: {
      en: { translation: en },
      fr: { translation: { tco: { ledger: {
        category: 'Catégorie',
        categories: Object.fromEntries(categories.map((category, index) => [category, localized[index]])),
      } } } },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(cleanup);

function entry(category: TcoLedgerCategory): TcoLedgerEntry {
  return {
    id: 1, vehicle_id: 3, category, amount: 120, currency: 'USD',
    incurred_on: '2026-01-10', note: 'Paid invoice', created_at: '',
  };
}

describe('fixed-cost category display', () => {
  it('localizes all eight form options without changing selected wire values or other populated fields', () => {
    const setCategory = vi.fn();
    const onAdd = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <TrueCostLedgerForm
          categories={categories} category="insurance" setCategory={setCategory}
          amount="120" setAmount={vi.fn()} incurredOn="2026-01-10" setIncurredOn={vi.fn()}
          note="Paid invoice" setNote={vi.fn()} canSubmit isPending={false} onAdd={onAdd}
        />
      </I18nextProvider>,
    );
    const select = screen.getByRole('combobox', { name: 'Catégorie' });
    expect(select).toHaveValue('insurance');
    categories.forEach((category, index) => {
      expect(screen.getByRole('option', { name: localized[index] })).toHaveValue(category);
      fireEvent.change(select, { target: { value: category } });
      expect(setCategory).toHaveBeenLastCalledWith(category);
    });
    expect(screen.getByLabelText('Amount')).toHaveValue(120);
    expect(screen.getByLabelText('Date')).toHaveValue('2026-01-10');
    expect(screen.getByLabelText('Note')).toHaveValue('Paid invoice');
    fireEvent.click(screen.getByRole('button', { name: 'Record cost' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it.each(categories)('localizes %s cells and filter labels while preserving raw filter identity', (category) => {
    const column = makeTrueCostLedgerColumns(i18n.t, String, vi.fn()).find((item) => item.key === 'category')!;
    const row = entry(category);
    expect(column.filterValue?.(row)).toBe(category);
    expect(column.filterValueLabel?.(category, row)).toBe(localized[categories.indexOf(category)]);
    render(<>{column.render(row)}</>);
    expect(screen.getByText(localized[categories.indexOf(category)])).toBeInTheDocument();
    expect(row.category).toBe(category);
  });

  it('preserves unknown identifiers verbatim, including names of object properties', () => {
    const column = makeTrueCostLedgerColumns(i18n.t, String, vi.fn()).find((item) => item.key === 'category')!;
    for (const category of ['future_cost', 'toString', '__proto__', 'Insurance']) {
      const row = Object.assign(entry('other'), { category });
      expect(ledgerCategoryLabel(category, i18n.t)).toBe(category);
      expect(column.filterValue?.(row)).toBe(category);
      expect(column.filterValueLabel?.(category, row)).toBe(category);
      const view = render(<>{column.render(row)}</>);
      expect(screen.getByText(category)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('provides English catalog labels for all known categories', () => {
    const t = i18n.getFixedT('en');
    categories.forEach((category, index) => {
      expect(t(`tco.ledger.categories.${category}`)).toBe(labels[index]);
      expect(ledgerCategoryLabel(category, t)).toBe(labels[index]);
    });
  });

  it('shows localized filter choices and filters populated rows by the original category tokens', () => {
    const rows = [
      entry('insurance'),
      { ...entry('tires'), id: 2, note: 'Winter tires' },
    ];
    render(
      <MemoryRouter>
        <I18nextProvider i18n={i18n}>
          <DataTable
            tableId="test:true-cost-localized-categories"
            enableValueFilters
            columns={makeTrueCostLedgerColumns(i18n.t, String, vi.fn())}
            data={rows}
            keyExtractor={(row) => row.id}
          />
        </I18nextProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Catégorie filter' }));
    const filter = screen.getByRole('dialog', { name: 'Catégorie filter' });
    expect(within(filter).getByRole('checkbox', { name: 'Assurance' })).toBeChecked();
    expect(within(filter).getByRole('checkbox', { name: 'Pneus' })).toBeChecked();
    fireEvent.click(within(filter).getByRole('checkbox', { name: 'Assurance' }));
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Paid invoice')).not.toBeInTheDocument();
    expect(within(table).getByText('Winter tires')).toBeInTheDocument();
    expect(within(table).getByText('Pneus')).toBeInTheDocument();
    expect(rows.map((row) => row.category)).toEqual(['insurance', 'tires']);
  });

  it('preserves populated date, amount, note and delete behavior', () => {
    const row = entry('insurance');
    const onDelete = vi.fn();
    const formatCurrency = vi.fn((amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`);
    const columns = makeTrueCostLedgerColumns(i18n.t, formatCurrency, onDelete);
    render(<>{columns.map((column) => <div key={column.key}>{column.render(row)}</div>)}</>);
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
    expect(screen.getByText('USD 120.00')).toBeInTheDocument();
    expect(screen.getByText('Paid invoice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    expect(onDelete).toHaveBeenCalledWith(row);
    expect(formatCurrency).toHaveBeenCalledWith(120, 'USD');
  });
});

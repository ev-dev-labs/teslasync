import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { RepairCaseQueue } from './RepairCaseQueue';

const tableProps = vi.hoisted(() => ({ enableValueFilters: undefined as boolean | undefined }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/{{(\w+)}}/g, (match, name: string) => String(values?.[name] ?? match));
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/components/ui', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui')>();
  return {
    ...actual,
    DataTable: (props: ComponentProps<typeof actual.DataTable>) => {
      tableProps.enableValueFilters = props.enableValueFilters;
      return <actual.DataTable {...props} />;
    },
  };
});

function props(): ComponentProps<typeof RepairCaseQueue> {
  return {
    cases: [],
    filters: { limit: 50 },
    selectedCaseIds: [],
    loading: false,
    hasData: true,
    error: null,
    hasMore: true,
    hasPrevious: false,
    onFiltersChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onOpenCase: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onRetry: vi.fn(),
    onBeginReview: vi.fn(),
    onDismiss: vi.fn(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  tableProps.enableValueFilters = undefined;
});

describe('RepairCaseQueue table ownership', () => {
  it('explicitly retains server filtering and cursor navigation rather than filtering a partial page', () => {
    const options = props();
    render(<RepairCaseQueue {...options} />);
    expect(tableProps.enableValueFilters).toBe(false);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(options.onNext).toHaveBeenCalledOnce();
    expect(options.onPrevious).not.toHaveBeenCalled();
    expect(screen.getByText('No repair cases match these filters.')).toBeInTheDocument();
  });
});

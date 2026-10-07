import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import '@/i18n';
import { ComparisonHeader } from '../ComparisonHeader';

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ComparisonHeader', () => {
  it('renders the title as a heading', () => {
    renderWithClient(
      <ComparisonHeader
        title="Overview"
        currentLabel="Last 30 days"
      />,
    );
    expect(
      screen.getByRole('heading', { name: /overview/i }),
    ).toBeInTheDocument();
  });

  it('renders the period strip with current label', () => {
    renderWithClient(
      <ComparisonHeader
        title="Overview"
        currentLabel="Last 30 days"
      />,
    );
    expect(screen.getByText(/last 30 days/i)).toBeInTheDocument();
  });

  it('renders comparison label after a separator when provided', () => {
    renderWithClient(
      <ComparisonHeader
        title="Overview"
        currentLabel="Last 30 days"
        comparisonLabel="vs prior 30 days"
      />,
    );
    expect(screen.getByText(/last 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/vs prior 30 days/i)).toBeInTheDocument();
  });

  it('omits the separator when comparisonLabel is missing', () => {
    renderWithClient(
      <ComparisonHeader
        title="Overview"
        currentLabel="Last 30 days"
      />,
    );
    expect(screen.queryByText('·')).toBeNull();
  });

  it('renders headline delta when supplied', () => {
    renderWithClient(
      <ComparisonHeader
        title="Overview"
        currentLabel="x"
        delta={{
          metric: { direction: 'higher_better' },
          current: 100,
          previous: 80,
        }}
      />,
    );
    expect(screen.getByText(/25/)).toBeInTheDocument();
  });

  it('renders right-aligned actions when provided', () => {
    renderWithClient(
      <ComparisonHeader
        title="x"
        currentLabel="x"
        actions={<button type="button">Export</button>}
      />,
    );
    expect(
      screen.getByRole('button', { name: /export/i }),
    ).toBeInTheDocument();
  });
});

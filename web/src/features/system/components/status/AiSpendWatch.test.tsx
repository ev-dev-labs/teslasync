import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AiSpendInsights } from '@/api/hooks/useAiUsage';

const mock = vi.hoisted(() => ({
  settings: { ai_mode: 'cloud', ai_cost_cap_cents: 50 } as { ai_mode: string; ai_cost_cap_cents: number },
  query: vi.fn(),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mock.settings }),
}));
vi.mock('@/api/hooks/useAiUsage', () => ({
  useAiSpendInsights: mock.query,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, opts?: Record<string, string>) =>
      Object.entries(opts ?? {}).reduce((value, [name, replacement]) =>
        value.replace(`{{${name}}}`, replacement), fallback ?? key),
  }),
}));

import { AiSpendWatch } from './AiSpendWatch';

function setQuery(data?: AiSpendInsights, error?: Error) {
  mock.query.mockReturnValue({
    data,
    error,
    isError: !!error,
    isPending: !data && !error,
    isLoading: !data && !error,
    isFetching: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
  });
}

const data: AiSpendInsights = {
  status: 'unusual_pace',
  as_of: '2026-06-10T12:00:00Z',
  today_micro_cents: 300_000,
  prior_daily_avg_micro_cents: 100_000,
  projected_today_micro_cents: 600_000,
  prior_active_days: 7,
  drivers: [{
    feature_id: 'chatbot-llm',
    provider: 'azure',
    model: 'large',
    today_micro_cents: 300_000,
    prior_daily_avg_micro_cents: 10_000,
  }],
};

describe('AiSpendWatch', () => {
  beforeEach(() => {
    mock.settings = { ai_mode: 'cloud', ai_cost_cap_cents: 50 };
    mock.query.mockReset();
  });

  it('does not query usage or render in AI-off mode', () => {
    mock.settings.ai_mode = 'off';
    setQuery(data);
    const { container } = render(<AiSpendWatch />);
    expect(container).toBeEmptyDOMElement();
    expect(mock.query).toHaveBeenCalledWith(false);
  });

  it('shows unusual pace, actual model contributor, and cap risk from audited spend', () => {
    setQuery(data);
    render(<AiSpendWatch />);
    expect(screen.getByText(/pacing at least twice/)).toBeInTheDocument();
    expect(screen.getByText(/chatbot-llm via azure \/ large/)).toBeInTheDocument();
    expect(screen.getByText(/may reach the global daily cap/)).toBeInTheDocument();
    expect(screen.getByText(/Delayed or missing audit records can undercount/)).toBeInTheDocument();
    expect(mock.query).toHaveBeenCalledWith(true);
  });

  it('does not project when the historical baseline is missing', () => {
    setQuery({ ...data, status: 'insufficient_history', prior_active_days: 0, projected_today_micro_cents: null });
    render(<AiSpendWatch />);
    expect(screen.getByText(/Fewer than 3 active days/)).toBeInTheDocument();
    expect(screen.queryByText(/At the current pace/)).not.toBeInTheDocument();
    expect(screen.getByText(/chatbot-llm via azure \/ large/)).toBeInTheDocument();
  });

  it('calls out newly paid model usage without presenting a zero baseline as a 2x spike', () => {
    setQuery({ ...data, status: 'new_paid_spend', prior_daily_avg_micro_cents: 0 });
    render(<AiSpendWatch />);
    expect(screen.getByText(/Paid AI usage appeared today/)).toBeInTheDocument();
    expect(screen.queryByText(/pacing at least twice/)).not.toBeInTheDocument();
  });

  it('explains an initial read error instead of showing zero spend', () => {
    setQuery(undefined, new Error('Unable to load usage'));
    render(<MemoryRouter><AiSpendWatch /></MemoryRouter>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No audited AI spend/)).not.toBeInTheDocument();
  });
});

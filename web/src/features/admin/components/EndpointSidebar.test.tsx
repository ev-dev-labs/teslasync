/**
 * EndpointSidebar — API Playground endpoint explorer.
 *
 * Exhaustive contract coverage for both runtime exports:
 *   • MethodBadge — label text, per-method color mapping, unknown-method
 *     fallback, and custom className passthrough.
 *   • EndpointSidebar (default) — accessible search box, endpoint count,
 *     tag grouping + "Other" fallback, live filtering by
 *     path/summary/operationId, empty-results state, collapse/expand
 *     toggling (aria-expanded), the onSelect callback + selected-row
 *     highlight, the >5-group collapse default, the auto-expand of a group
 *     whose endpoint becomes selected after mount (regression guard), and
 *     null-safety when optional text fields are missing.
 *
 * react-i18next is stubbed so `t(key, fallback)` deterministically returns
 * the English fallback. The component is pure/presentational — no network,
 * QueryClient, or Router is required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

import EndpointSidebar, { MethodBadge, type ParsedEndpoint } from './EndpointSidebar';

function makeEndpoint(overrides: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    method: 'GET',
    path: '/vehicles',
    tag: 'Vehicles',
    summary: 'List vehicles',
    description: 'Returns all vehicles',
    operationId: 'listVehicles',
    parameters: [],
    responses: { '200': { description: 'OK' } },
    ...overrides,
  };
}

const vehiclesGet = makeEndpoint();
const vehiclesPost = makeEndpoint({
  method: 'POST',
  path: '/vehicles',
  summary: 'Create vehicle',
  operationId: 'createVehicle',
});
const chargingGet = makeEndpoint({
  path: '/charging',
  tag: 'Charging',
  summary: 'List charging sessions',
  operationId: 'listCharging',
});

const SEARCH = { name: 'Search endpoints...' } as const;
const noop = () => {};

beforeEach(() => cleanup());

describe('MethodBadge', () => {
  it('renders the HTTP method as its label', () => {
    render(<MethodBadge method="GET" />);
    expect(screen.getByText('GET')).toBeInTheDocument();
  });

  it.each([
    ['GET', 'text-green-400'],
    ['POST', 'text-blue-400'],
    ['PUT', 'text-amber-400'],
    ['DELETE', 'text-red-400'],
    ['PATCH', 'text-purple-400'],
  ])('maps %s to its semantic color class', (method, cls) => {
    render(<MethodBadge method={method} />);
    expect(screen.getByText(method).className).toContain(cls);
  });

  it('falls back to a muted class for an unknown method', () => {
    render(<MethodBadge method="TRACE" />);
    const badge = screen.getByText('TRACE');
    expect(badge.className).toContain('text-[var(--text-muted)]');
    expect(badge.className).not.toContain('text-green-400');
  });

  it('merges a caller-supplied className', () => {
    render(<MethodBadge method="GET" className="ring-2" />);
    expect(screen.getByText('GET').className).toContain('ring-2');
  });
});

describe('EndpointSidebar', () => {
  it('renders an accessible search box, the endpoint count, and tag headers', () => {
    render(
      <EndpointSidebar
        endpoints={[vehiclesGet, vehiclesPost, chargingGet]}
        selected={null}
        onSelect={noop}
      />,
    );
    expect(screen.getByRole('textbox', SEARCH)).toBeInTheDocument();
    expect(screen.getByText('3 endpoints')).toBeInTheDocument();
    expect(screen.getByText('Vehicles')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
  });

  it('filters endpoints by path as the user types', () => {
    render(
      <EndpointSidebar
        endpoints={[vehiclesGet, vehiclesPost, chargingGet]}
        selected={null}
        onSelect={noop}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', SEARCH), {
      target: { value: 'charging' },
    });
    expect(screen.getByText('1 endpoints')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
  });

  it('filters by summary text', () => {
    render(
      <EndpointSidebar
        endpoints={[vehiclesGet, chargingGet]}
        selected={null}
        onSelect={noop}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', SEARCH), {
      target: { value: 'List charging' },
    });
    expect(screen.getByText('1 endpoints')).toBeInTheDocument();
    expect(screen.getByText('Charging')).toBeInTheDocument();
    expect(screen.queryByText('Vehicles')).not.toBeInTheDocument();
  });

  it('filters by operationId', () => {
    render(
      <EndpointSidebar
        endpoints={[vehiclesGet, vehiclesPost]}
        selected={null}
        onSelect={noop}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', SEARCH), {
      target: { value: 'createVehicle' },
    });
    expect(screen.getByText('1 endpoints')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.queryByText('GET')).not.toBeInTheDocument();
  });

  it('shows an empty-state message when nothing matches', () => {
    render(
      <EndpointSidebar endpoints={[vehiclesGet]} selected={null} onSelect={noop} />,
    );
    fireEvent.change(screen.getByRole('textbox', SEARCH), {
      target: { value: 'no-such-endpoint' },
    });
    expect(screen.getByText('No matching endpoints')).toBeInTheDocument();
    expect(screen.getByText('0 endpoints')).toBeInTheDocument();
  });

  it('groups untagged endpoints under "Other"', () => {
    render(
      <EndpointSidebar
        endpoints={[makeEndpoint({ tag: '', path: '/misc' })]}
        selected={null}
        onSelect={noop}
      />,
    );
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('toggles a tag group and reflects it in aria-expanded', () => {
    render(
      <EndpointSidebar endpoints={[vehiclesGet]} selected={null} onSelect={noop} />,
    );
    // <=5 groups → open by default; the endpoint row is visible.
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    const header = screen.getByRole('button', { name: /Vehicles/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('/vehicles')).not.toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
  });

  it('invokes onSelect with the clicked endpoint', () => {
    const onSelect = vi.fn();
    render(
      <EndpointSidebar
        endpoints={[vehiclesGet, chargingGet]}
        selected={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('/charging'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(chargingGet);
  });

  it('highlights the selected endpoint row', () => {
    render(
      <EndpointSidebar
        endpoints={[vehiclesGet, chargingGet]}
        selected={chargingGet}
        onSelect={noop}
      />,
    );
    expect(screen.getByText('/charging').closest('button')?.className).toContain(
      'border-cyan-400',
    );
    expect(
      screen.getByText('/vehicles').closest('button')?.className,
    ).not.toContain('border-cyan-400');
  });

  it('collapses all groups by default when there are more than five tags', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      makeEndpoint({ tag: `Tag${i}`, path: `/p${i}`, operationId: `op${i}` }),
    );
    render(<EndpointSidebar endpoints={many} selected={null} onSelect={noop} />);
    expect(screen.getByText('Tag0')).toBeInTheDocument();
    expect(screen.queryByText('/p0')).not.toBeInTheDocument();
  });

  it('auto-expands the group of an endpoint selected after mount', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      makeEndpoint({ tag: `Tag${i}`, path: `/p${i}`, operationId: `op${i}` }),
    );
    const { rerender } = render(
      <EndpointSidebar endpoints={many} selected={null} onSelect={noop} />,
    );
    expect(screen.queryByText('/p3')).not.toBeInTheDocument();

    rerender(
      <EndpointSidebar endpoints={many} selected={many[3]} onSelect={noop} />,
    );
    expect(screen.getByText('/p3')).toBeInTheDocument();
  });

  it('does not crash when endpoints omit optional text fields', () => {
    const partial = {
      method: 'GET',
      tag: 'Weird',
      description: '',
      parameters: [],
      responses: {},
    } as unknown as ParsedEndpoint; // path/summary/operationId intentionally missing

    render(
      <EndpointSidebar endpoints={[partial]} selected={null} onSelect={noop} />,
    );
    // The ?? '' guards keep path/summary/operationId filtering safe.
    fireEvent.change(screen.getByRole('textbox', SEARCH), {
      target: { value: 'anything' },
    });
    expect(screen.getByText('No matching endpoints')).toBeInTheDocument();
  });
});

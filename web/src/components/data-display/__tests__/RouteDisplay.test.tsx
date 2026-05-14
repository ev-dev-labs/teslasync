import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteDisplay, endpointLabel } from '../RouteDisplay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

describe('RouteDisplay.endpointLabel', () => {
  it('returns the address when present', () => {
    expect(endpointLabel({ address: 'Home' })).toBe('Home');
  });

  it('trims surrounding whitespace from the address', () => {
    expect(endpointLabel({ address: '  Home  ' })).toBe('Home');
  });

  it('falls back to coords when address is missing', () => {
    expect(endpointLabel({ lat: 47.71, lon: -122.18 })).toBe('📍 47.71, -122.18');
  });

  it('returns null when neither address nor coords are present', () => {
    expect(endpointLabel({})).toBeNull();
    expect(endpointLabel({ address: '   ' })).toBeNull();
    expect(endpointLabel({ lat: null, lon: null })).toBeNull();
  });
});

describe('RouteDisplay component', () => {
  it('renders "From → To" when start and end differ', () => {
    render(
      <RouteDisplay
        start={{ address: 'Home' }}
        end={{ address: 'Office' }}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).toHaveTextContent(/Home → Office/);
  });

  it('renders "↻ round trip" when addresses match', () => {
    render(
      <RouteDisplay
        start={{ address: 'Home' }}
        end={{ address: 'Home' }}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).toHaveTextContent(/Home/);
    expect(screen.getByTestId('r')).toHaveTextContent(/round trip/i);
  });

  it('renders "↻ round trip" when coords are within threshold', () => {
    render(
      <RouteDisplay
        start={{ lat: 47.71, lon: -122.18 }}
        end={{ lat: 47.71, lon: -122.18 }}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).toHaveTextContent(/round trip/i);
  });

  it('does NOT render round trip when coords are far apart', () => {
    render(
      <RouteDisplay
        start={{ lat: 47.71, lon: -122.18 }}
        end={{ lat: 47.80, lon: -122.18 }}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).not.toHaveTextContent(/round trip/i);
    // ~10 km apart → renders both coords
    expect(screen.getByTestId('r')).toHaveTextContent(/→/);
  });

  it('renders single location (no end) without round-trip phrasing', () => {
    render(
      <RouteDisplay
        start={{ address: 'Supercharger Costco' }}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).toHaveTextContent(/Supercharger Costco/);
    expect(screen.getByTestId('r')).not.toHaveTextContent(/round trip/i);
    expect(screen.getByTestId('r')).not.toHaveTextContent(/→/);
  });

  it('falls back to "No location data" when neither endpoint has data', () => {
    render(<RouteDisplay start={{}} end={{}} testId="r" />);
    expect(screen.getByTestId('r')).toHaveTextContent(/No location data/i);
  });

  it('falls back per-endpoint when only one is missing', () => {
    render(
      <RouteDisplay
        start={{ address: 'Home' }}
        end={{}}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).toHaveTextContent(/Home/);
    expect(screen.getByTestId('r')).toHaveTextContent(/No location data/i);
    expect(screen.getByTestId('r')).toHaveTextContent(/→/);
  });

  it('respects custom roundTripThresholdM', () => {
    // Two points ~120 m apart whose rounded coord labels differ
    // (so addressesMatch=false, threshold is the only deciding factor).
    const start = { lat: 47.7144, lon: -122.18 };
    const farEnd = { lat: 47.7155, lon: -122.18 };

    const { rerender } = render(
      <RouteDisplay start={start} end={farEnd} testId="r" />,
    );
    expect(screen.getByTestId('r')).not.toHaveTextContent(/round trip/i);

    rerender(
      <RouteDisplay
        start={start}
        end={farEnd}
        roundTripThresholdM={200}
        testId="r"
      />,
    );
    expect(screen.getByTestId('r')).toHaveTextContent(/round trip/i);
  });

  it('hides icon when showIcon is false', () => {
    const { container } = render(
      <RouteDisplay
        start={{ address: 'Home' }}
        end={{ address: 'Office' }}
        showIcon={false}
        testId="r"
      />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});

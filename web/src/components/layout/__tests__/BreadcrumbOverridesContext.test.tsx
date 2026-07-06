import { describe, it, expect, vi } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';
import {
  BreadcrumbOverridesProvider,
  useBreadcrumbOverrides,
  useSetBreadcrumbOverrides,
} from '../BreadcrumbOverridesContext';

/**
 * BreadcrumbOverridesContext contract.
 *
 * The context lets pages push per-route breadcrumb labels up to the single
 * global Layout breadcrumb. `useSetBreadcrumbOverrides` registers a map for the
 * current page; the provider merges every registration and exposes the result
 * via `useBreadcrumbOverrides`, which `LayoutBreadcrumbs` forwards to
 * `useBreadcrumbs`.
 *
 * These tests exercise all three exports plus the failure/edge paths:
 *  - registering, merging, "latest registration wins", and unregister-on-unmount
 *  - content-change re-registration and undefined → unregister transitions
 *  - falsy label filtering in the merge
 *  - safe no-op behaviour when used outside a provider
 *  - a regression guard for the infinite render loop caused by depending on the
 *    whole (identity-unstable) context value inside the registration effect.
 */

type OverrideMap = Partial<Record<string, string>>;

/** Reads the current merged overrides and mirrors them into the DOM so tests
 *  can assert the settled value after React flushes effects. */
function Reader() {
  const overrides = useBreadcrumbOverrides();
  return <div data-testid="overrides">{JSON.stringify(overrides)}</div>;
}

/** Registers a single override map for the lifetime it is mounted. */
function Registrar({ map }: { map?: OverrideMap }) {
  useSetBreadcrumbOverrides(map);
  return null;
}

interface HarnessRegistrar {
  id: string;
  map?: OverrideMap;
}

/** Mounts an arbitrary set of registrars plus one reader under a provider. */
function Harness({ registrars }: { registrars: HarnessRegistrar[] }) {
  return (
    <BreadcrumbOverridesProvider>
      {registrars.map((r) => (
        <Registrar key={r.id} map={r.map} />
      ))}
      <Reader />
    </BreadcrumbOverridesProvider>
  );
}

function readOverrides(): OverrideMap {
  return JSON.parse(screen.getByTestId('overrides').textContent || '{}') as OverrideMap;
}

describe('BreadcrumbOverridesProvider', () => {
  it('renders its children', () => {
    render(
      <BreadcrumbOverridesProvider>
        <div data-testid="child">hello</div>
      </BreadcrumbOverridesProvider>,
    );
    expect(screen.getByTestId('child')).toHaveTextContent('hello');
  });

  it('exposes an empty override map before anything registers', () => {
    render(<Harness registrars={[]} />);
    expect(readOverrides()).toEqual({});
  });
});

describe('useBreadcrumbOverrides (without a provider)', () => {
  it('returns an empty map instead of throwing', () => {
    const { result } = renderHook(() => useBreadcrumbOverrides());
    expect(result.current).toEqual({});
  });

  it('returns a stable reference across renders so downstream memos stay put', () => {
    const { result, rerender } = renderHook(() => useBreadcrumbOverrides());
    const first = result.current;
    rerender();
    // A fresh {} literal per render would needlessly re-run useBreadcrumbs'
    // useMemo(overrides). The default must be referentially stable.
    expect(result.current).toBe(first);
  });
});

describe('useSetBreadcrumbOverrides (without a provider)', () => {
  it('is a safe no-op and does not throw', () => {
    expect(() =>
      renderHook(() => useSetBreadcrumbOverrides({ '/drives/:id': 'Trip to office' })),
    ).not.toThrow();
  });
});

describe('registration + merge behaviour', () => {
  it('surfaces a registered map through useBreadcrumbOverrides', () => {
    render(<Harness registrars={[{ id: 'a', map: { '/drives/:id': 'Trip to office' } }]} />);
    expect(readOverrides()).toEqual({ '/drives/:id': 'Trip to office' });
  });

  it('does not enter an infinite render loop when a consumer registers overrides', () => {
    const renderSpy = vi.fn();
    function CountingRegistrar() {
      renderSpy();
      useSetBreadcrumbOverrides({ '/drives/:id': 'Trip to office' });
      return null;
    }
    // A registration effect keyed on the whole (identity-unstable) context
    // value would re-register on every commit and trip React's
    // "Maximum update depth exceeded" guard — render() would throw.
    expect(() =>
      render(
        <BreadcrumbOverridesProvider>
          <CountingRegistrar />
          <Reader />
        </BreadcrumbOverridesProvider>,
      ),
    ).not.toThrow();
    // Correct behaviour settles in a bounded number of commits: initial mount
    // plus a single re-render after the registration state flush.
    expect(renderSpy.mock.calls.length).toBeGreaterThan(0);
    expect(renderSpy.mock.calls.length).toBeLessThan(6);
    expect(readOverrides()).toEqual({ '/drives/:id': 'Trip to office' });
  });

  it('merges distinct keys from multiple consumers', () => {
    render(
      <Harness
        registrars={[
          { id: 'a', map: { '/drives/:id': 'Trip to office' } },
          { id: 'b', map: { '/charging/:id': 'Supercharger stop' } },
        ]}
      />,
    );
    expect(readOverrides()).toEqual({
      '/drives/:id': 'Trip to office',
      '/charging/:id': 'Supercharger stop',
    });
  });

  it('lets a later registration win for the same key', () => {
    render(
      <Harness
        registrars={[
          { id: 'a', map: { '/drives/:id': 'First label' } },
          { id: 'b', map: { '/drives/:id': 'Second label' } },
        ]}
      />,
    );
    expect(readOverrides()).toEqual({ '/drives/:id': 'Second label' });
  });

  it('drops falsy labels from the merged map', () => {
    render(<Harness registrars={[{ id: 'a', map: { '/drives/:id': '' } }]} />);
    expect(readOverrides()).toEqual({});
  });
});

describe('registration lifecycle', () => {
  it('removes a consumer\u2019s overrides when it unmounts', () => {
    const { rerender } = render(
      <Harness
        registrars={[
          { id: 'a', map: { '/drives/:id': 'Trip to office' } },
          { id: 'b', map: { '/charging/:id': 'Supercharger stop' } },
        ]}
      />,
    );
    expect(readOverrides()).toEqual({
      '/drives/:id': 'Trip to office',
      '/charging/:id': 'Supercharger stop',
    });

    // Unmount registrar "b" — its cleanup must unregister its map.
    rerender(<Harness registrars={[{ id: 'a', map: { '/drives/:id': 'Trip to office' } }]} />);
    expect(readOverrides()).toEqual({ '/drives/:id': 'Trip to office' });
  });

  it('updates overrides when a consumer changes its map content', () => {
    const { rerender } = render(
      <Harness registrars={[{ id: 'a', map: { '/drives/:id': 'Before' } }]} />,
    );
    expect(readOverrides()).toEqual({ '/drives/:id': 'Before' });

    rerender(<Harness registrars={[{ id: 'a', map: { '/drives/:id': 'After' } }]} />);
    expect(readOverrides()).toEqual({ '/drives/:id': 'After' });
  });

  it('registers nothing when the map is undefined', () => {
    render(<Harness registrars={[{ id: 'a', map: undefined }]} />);
    expect(readOverrides()).toEqual({});
  });

  it('unregisters when a consumer switches from a map to undefined', () => {
    const { rerender } = render(
      <Harness registrars={[{ id: 'a', map: { '/drives/:id': 'Trip to office' } }]} />,
    );
    expect(readOverrides()).toEqual({ '/drives/:id': 'Trip to office' });

    rerender(<Harness registrars={[{ id: 'a', map: undefined }]} />);
    expect(readOverrides()).toEqual({});
  });
});

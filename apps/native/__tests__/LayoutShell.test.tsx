import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import Layout, {
  deriveAlertToast,
  findNavItemByExactPath,
  findNavItemByPath,
  isActiveNavPath,
  isVisibleNavItem,
  navSearchKeywords,
  navSections,
  resetNavPreferenceStore,
  useSidebarNavState,
  type NativeTFunction,
  type NavItem,
  type SidebarNavState,
} from '../src/web-parity/components/layout/Layout';
import type {Alert, StaleSessionsResponse, Vehicle} from '../src/web-parity/api/types';

const t: NativeTFunction = (_key, fallback, params) =>
  params
    ? fallback.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
        params[name] === undefined ? m : String(params[name]),
      )
    : fallback;

function makeVehicle(id: number): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `5YJTESLASYNC000${id}`,
    display_name: `Car ${id}`,
    model: 'Model Y',
    trim_badging: 'Long Range',
    exterior_color: 'Pearl White',
    wheel_type: 'Induction',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function makeAlert(over: Partial<Alert>): Alert {
  return {
    id: 1,
    vehicle_id: 1,
    type: 'notification',
    severity: 'info',
    title: 'Title',
    message: 'Message',
    is_read: false,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const COMPARE_ITEM = navSections
  .find(section => section.title === 'Vehicles')!
  .items.find(item => item.to === '/vehicle-comparison') as NavItem;
const ACTIVITY_ITEM = navSections
  .find(section => section.title === 'Account')!
  .items.find(item => item.to === '/me/activity') as NavItem;

let captured: SidebarNavState | null = null;

function Harness(props: {
  pathname: string;
  vehicleCount: number;
  isForwardAuth: boolean;
}) {
  captured = useSidebarNavState({...props, t});
  return null;
}

function renderHarness(props: {
  pathname: string;
  vehicleCount: number;
  isForwardAuth: boolean;
}): ReactTestRenderer.ReactTestRenderer {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Harness {...props} />);
  });
  return tree!;
}

describe('Layout nav routing helpers', () => {
  test('isActiveNavPath matches the web exact/prefix/root logic', () => {
    expect(isActiveNavPath('/', '/')).toBe(true);
    expect(isActiveNavPath('/charging', '/')).toBe(false);
    expect(isActiveNavPath('/charging', '/charging')).toBe(true);
    expect(isActiveNavPath('/charging/123', '/charging')).toBe(true);
    expect(isActiveNavPath('/charging-curve', '/charging')).toBe(false);
  });

  test('isVisibleNavItem honours minVehicles and requiresAuth gates', () => {
    expect(isVisibleNavItem(COMPARE_ITEM, 1, false)).toBe(false);
    expect(isVisibleNavItem(COMPARE_ITEM, 2, false)).toBe(true);
    expect(isVisibleNavItem(ACTIVITY_ITEM, 5, false)).toBe(false);
    expect(isVisibleNavItem(ACTIVITY_ITEM, 5, true)).toBe(true);
  });

  test('findNavItemByPath / findNavItemByExactPath resolve sections', () => {
    expect(findNavItemByPath('/battery-cells')?.section.title).toBe('Battery');
    expect(findNavItemByPath('/charging/42')?.item.to).toBe('/charging');
    expect(findNavItemByPath('/does-not-exist')).toBeNull();
    expect(findNavItemByExactPath('/roadmap')?.section.title).toBe('About');
    expect(findNavItemByExactPath('/charging/42')).toBeNull();
  });

  test('nav catalog retains the full web structure', () => {
    expect(navSections).toHaveLength(19);
    const allItems = navSections.flatMap(section => section.items);
    expect(allItems.length).toBeGreaterThan(80);
    expect(navSearchKeywords['/']).toEqual(['home', 'overview', 'start', 'summary']);
    expect(navSearchKeywords['/charging']).toContain('charger');
  });
});

describe('deriveAlertToast', () => {
  test('critical alert with metadata builds a drill-through action', () => {
    const descriptor = deriveAlertToast(
      makeAlert({severity: 'critical', vehicle_id: 7, title: 'Boom'}),
      t,
      () => '/signal-explorer?vehicle=7',
    );
    expect(descriptor.type).toBe('error');
    expect(descriptor.title).toBe('Boom');
    expect(descriptor.action).toEqual({label: 'View', to: '/signal-explorer?vehicle=7'});
  });

  test('warning alert without drill-through metadata has no action', () => {
    const descriptor = deriveAlertToast({severity: 'warning'}, t);
    expect(descriptor.type).toBe('warning');
    expect(descriptor.title).toBe('Alert');
    expect(descriptor.action).toBeUndefined();
  });

  test('info severity falls back to the info toast type', () => {
    const descriptor = deriveAlertToast({severity: 'info', created_at: 'x'}, t);
    expect(descriptor.type).toBe('info');
    expect(descriptor.action?.to).toBe('/signal-explorer');
  });
});

describe('useSidebarNavState', () => {
  beforeEach(() => {
    resetNavPreferenceStore();
    captured = null;
  });

  test('auto-expands the active section and seeds default pinned paths', () => {
    renderHarness({pathname: '/charging', vehicleCount: 2, isForwardAuth: false});
    expect(captured!.activeSectionTitle).toBe('Charging');
    expect(captured!.expandedSections.has('Charging')).toBe(true);
    expect(captured!.expandedSections.has('Home')).toBe(true);
    expect(captured!.pinnedNavPaths).toContain('/charging');
    expect(captured!.activeIsPinned).toBe(true);
  });

  test('toggle keeps the active section open but collapses others', () => {
    renderHarness({pathname: '/charging', vehicleCount: 1, isForwardAuth: false});
    ReactTestRenderer.act(() => captured!.toggleSection('Home'));
    expect(captured!.expandedSections.has('Home')).toBe(false);
    ReactTestRenderer.act(() => captured!.toggleSection('Charging'));
    expect(captured!.expandedSections.has('Charging')).toBe(true);
  });

  test('expandAll / collapseAll drive the expanded count', () => {
    renderHarness({pathname: '/', vehicleCount: 2, isForwardAuth: true});
    ReactTestRenderer.act(() => captured!.expandAllSections());
    expect(captured!.expandedSectionCount).toBe(captured!.visibleNavSections.length);
    ReactTestRenderer.act(() => captured!.collapseAllSections());
    expect(captured!.expandedSectionCount).toBe(0);
  });

  test('pin/unpin updates paths and persists across remounts', () => {
    renderHarness({pathname: '/', vehicleCount: 1, isForwardAuth: false});
    ReactTestRenderer.act(() => captured!.pinNavPath('/battery'));
    expect(captured!.pinnedNavPaths[0]).toBe('/battery');
    ReactTestRenderer.act(() => captured!.unpinNavPath('/charging'));
    expect(captured!.pinnedNavPaths).not.toContain('/charging');

    // A fresh mount must hydrate pinned paths from the persisted store.
    captured = null;
    renderHarness({pathname: '/', vehicleCount: 1, isForwardAuth: false});
    expect(captured!.pinnedNavPaths).toContain('/battery');
    expect(captured!.pinnedNavPaths).not.toContain('/charging');
  });

  test('hides requiresAuth items in open mode', () => {
    renderHarness({pathname: '/', vehicleCount: 1, isForwardAuth: false});
    const account = captured!.visibleNavSections.find(
      section => section.title === 'Account',
    );
    expect(account?.items.some(item => item.to === '/me/activity')).toBe(false);
  });
});

describe('Layout shell render', () => {
  beforeEach(() => resetNavPreferenceStore());

  test('renders the native sidebar, sections, pinned rows, and surfaces', () => {
    const staleSessions = {
      stale_charging: [{}],
      stale_drives: [{}, {}],
    } as unknown as StaleSessionsResponse;

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Layout
          currentPath="/charging"
          alerts={[makeAlert({is_read: false}), makeAlert({id: 2, is_read: true})]}
          vehicles={[makeVehicle(1), makeVehicle(2)]}
          staleSessions={staleSessions}
        />,
      );
    });

    const serialized = JSON.stringify(tree!.toJSON());
    expect(serialized).toContain('TeslaSync');
    expect(serialized).toContain('CHARGING');
    expect(serialized).toContain('Charging Overview');
    expect(serialized).toContain('Pinned');
    expect(serialized).toContain('My Vehicles');
    expect(serialized).toContain('Sections');
    expect(serialized).toContain('Global app surfaces');
    expect(serialized).toContain('SkipToContent');
    expect(serialized).toContain('CommandPalette');
    expect(serialized).toContain('Browser-only adaptations');
  });

  test('renders provided route children in place of the outlet placeholder', () => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <Layout currentPath="/vehicles">
          <></>
        </Layout>,
      );
    });
    const serialized = JSON.stringify(tree!.toJSON());
    expect(serialized).toContain('VEHICLES');
    // Outlet placeholder copy must not appear when children are supplied.
    expect(serialized).not.toContain('Route content renders here');
  });
});

import {
  DIAGNOSTIC_NAV_ENTRY,
  LIVE_LOGS_NAV_ENTRY,
  RBAC_NAV_ENTRY,
  SIDEBAR_NAV_ENTRIES,
  type SidebarNavEntry,
} from '../src/web-parity/components/layout/Sidebar';
import {semanticIconIntentNames} from '../src/components/icons/SemanticIcon';

const validIconNames = new Set<string>(semanticIconIntentNames);

describe('Sidebar nav registry (web-parity)', () => {
  it('exposes the diagnostic infrastructure entry with native icon mapping', () => {
    expect(DIAGNOSTIC_NAV_ENTRY).toEqual<SidebarNavEntry>({
      to: '/diagnostic',
      i18nKey: 'diagnostic.title',
      defaultLabel: 'System diagnostic',
      icon: 'activity',
      section: 'infrastructure',
    });
  });

  it('exposes the live-logs infrastructure entry with native icon mapping', () => {
    expect(LIVE_LOGS_NAV_ENTRY).toEqual<SidebarNavEntry>({
      to: '/live-logs',
      i18nKey: 'liveLogs.title',
      defaultLabel: 'Live logs',
      icon: 'fileText',
      section: 'infrastructure',
    });
  });

  it('exposes the RBAC admin entry with native icon mapping', () => {
    expect(RBAC_NAV_ENTRY).toEqual<SidebarNavEntry>({
      to: '/admin/rbac',
      i18nKey: 'rbac.title',
      defaultLabel: 'RBAC matrix',
      icon: 'securityCheck',
      section: 'admin',
    });
  });

  it('registers the three entries in source order', () => {
    expect(SIDEBAR_NAV_ENTRIES).toEqual([
      DIAGNOSTIC_NAV_ENTRY,
      LIVE_LOGS_NAV_ENTRY,
      RBAC_NAV_ENTRY,
    ]);
  });

  it('only references icons that exist in the native SemanticIcon set', () => {
    for (const entry of SIDEBAR_NAV_ENTRIES) {
      expect(validIconNames.has(entry.icon)).toBe(true);
    }
  });

  it('uses only known sidebar sections and non-empty routes/labels', () => {
    const sections = new Set(['admin', 'infrastructure', 'tools']);
    for (const entry of SIDEBAR_NAV_ENTRIES) {
      expect(sections.has(entry.section)).toBe(true);
      expect(entry.to.startsWith('/')).toBe(true);
      expect(entry.i18nKey.length).toBeGreaterThan(0);
      expect(entry.defaultLabel.length).toBeGreaterThan(0);
    }
  });
});

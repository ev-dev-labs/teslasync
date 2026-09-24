import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import { GroupedSectionNavigation } from './GroupedSectionNavigation'
import {
  DIAGNOSTIC_GROUPS,
  diagnosticPrimaryPath,
  diagnosticSidebarItems,
  findDiagnosticGroup,
} from './diagnosticGroups'
import {
  REPORT_GROUPS,
  findReportGroup,
  reportPrimaryPath,
  reportSidebarItems,
} from './reportGroups'

function CurrentPath() {
  const { pathname } = useLocation()
  return <span data-testid="current-path">{pathname}</span>
}

describe('Reports grouping', () => {
  const reportPaths = [
    '/statistics', '/analytics', '/period-compare',
    '/efficiency', '/temperature-impact', '/drive-archetypes',
    '/cost-analysis', '/tco',
    '/share-card', '/analytics/carbon', '/benchmarks/privacy',
  ]

  it('preserves all eleven report destinations behind six sidebar entries', () => {
    const items = reportPaths.map(to => ({ to, label: to, labelKey: to }))
    const sidebar = reportSidebarItems(items)
    const registeredPaths = new Set(ROUTE_REGISTRY.map(route => route.path))

    expect(reportPaths.every(path => registeredPaths.has(path))).toBe(true)
    expect(sidebar.map(item => item.to)).toEqual([
      '/statistics', '/efficiency', '/cost-analysis',
      '/share-card', '/analytics/carbon', '/benchmarks/privacy',
    ])
    expect(sidebar.slice(0, 3).map(item => item.label)).toEqual([
      'Fleet Insights', 'Driving Efficiency', 'Costs',
    ])
    expect(REPORT_GROUPS.flatMap(group => group.pages.map(page => page.to))).toEqual(reportPaths.slice(0, 8))
    for (const path of reportPaths.slice(0, 8)) {
      expect(findReportGroup(path)).toBeDefined()
    }
    for (const path of reportPaths.slice(8)) {
      expect(findReportGroup(path)).toBeUndefined()
      expect(reportPrimaryPath(path)).toBe(path)
    }
  })

  it.each([
    ['/analytics', 'Fleet Insights', 'Period Comparison', '/period-compare'],
    ['/drive-archetypes', 'Driving Efficiency', 'Temperature Impact', '/temperature-impact'],
    ['/tco', 'Costs', 'Cost Analysis', '/cost-analysis'],
  ])('navigates from %s across its group without changing the original URLs', async (start, group, target, destination) => {
    render(
      <MemoryRouter initialEntries={[start]}>
        <GroupedSectionNavigation groups={REPORT_GROUPS} sectionsLabelKey="nav.reportGroups.sections" />
        <CurrentPath />
      </MemoryRouter>,
    )

    const navigation = screen.getByRole('navigation', { name: `${group} sections` })
    expect(navigation.querySelectorAll('a')).toHaveLength(findReportGroup(start)?.pages.length ?? 0)
    expect(screen.getByTestId('current-path')).toHaveTextContent(start)
    expect(screen.getByRole('link', { name: findReportGroup(start)?.pages.find(page => page.to === start)?.label }))
      .toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('link', { name: target }))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent(destination))
    expect(screen.getByRole('link', { name: target })).toHaveAttribute('aria-current', 'page')
  })

  it('does not add analysis tabs to standalone report pages', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/carbon']}>
        <GroupedSectionNavigation groups={REPORT_GROUPS} sectionsLabelKey="nav.reportGroups.sections" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})

describe('Diagnostics grouping', () => {
  it('retains standalone destinations and every grouped destination as a registered route', () => {
    const standalonePaths = [
      '/dashcam', '/admin/flags', '/admin/vehicle-cost', '/admin/secret-rotation',
      '/admin/audit-log', '/admin/gdpr-exports', '/api-playground',
    ]
    const groupedPaths = DIAGNOSTIC_GROUPS.flatMap(group => group.pages.map(page => page.to))
    const paths = [...groupedPaths, ...standalonePaths]
    const items = paths.map(to => ({ to, label: to, labelKey: to }))
    const sidebar = diagnosticSidebarItems(items)
    const registeredPaths = new Set(ROUTE_REGISTRY.map(route => route.path))

    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toHaveLength(33)
    expect(paths.every(path => registeredPaths.has(path))).toBe(true)
    expect(DIAGNOSTIC_GROUPS.every(group => group.pages.every(page =>
      page.labelKey === `nav.items.${page.to.slice(1).replace(/\//g, '_')}`,
    ))).toBe(true)
    expect(sidebar.map(item => item.to)).toEqual([
      ...DIAGNOSTIC_GROUPS.map(group => group.primary), ...standalonePaths,
    ])
    expect(sidebar.slice(0, 5).map(item => item.label)).toEqual([
      'System Health', 'Database & Data Health', 'Telemetry Troubleshooting',
      'Signal Analysis', 'Vehicle Diagnostics',
    ])
    expect(diagnosticPrimaryPath('/admin/ingest-xray')).toBe('/signals')
    expect(standalonePaths.every(path => findDiagnosticGroup(path) === undefined)).toBe(true)
  })

  it.each([
    ['/api-logs', 'System Health', 'System Status', '/system-status'],
    ['/admin/data-quality', 'Database & Data Health', 'Schema Drift', '/admin/schema-drift'],
    ['/signal-entropy', 'Signal Analysis', 'Signal Trend', '/signal-trend'],
    ['/diagnostics/root-cause', 'Vehicle Diagnostics', 'Anomaly Detection', '/anomaly-detection'],
  ])('navigates from %s within its group without changing URLs', async (start, group, target, destination) => {
    render(
      <MemoryRouter initialEntries={[start]}>
        <GroupedSectionNavigation groups={DIAGNOSTIC_GROUPS} sectionsLabelKey="nav.diagnosticGroups.sections" />
        <CurrentPath />
      </MemoryRouter>,
    )

    const navigation = screen.getByRole('navigation', { name: `${group} sections` })
    expect(navigation.querySelectorAll('a')).toHaveLength(findDiagnosticGroup(start)?.pages.length ?? 0)
    fireEvent.click(screen.getByRole('link', { name: target }))
    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent(destination))
    expect(screen.getByRole('link', { name: target })).toHaveAttribute('aria-current', 'page')
  })

  it('does not add tabs to standalone diagnostic pages', () => {
    render(
      <MemoryRouter initialEntries={['/dashcam']}>
        <GroupedSectionNavigation groups={DIAGNOSTIC_GROUPS} sectionsLabelKey="nav.diagnosticGroups.sections" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})

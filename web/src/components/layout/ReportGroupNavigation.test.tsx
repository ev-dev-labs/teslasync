import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import { ReportGroupNavigation } from './ReportGroupNavigation'
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
        <ReportGroupNavigation />
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
        <ReportGroupNavigation />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})

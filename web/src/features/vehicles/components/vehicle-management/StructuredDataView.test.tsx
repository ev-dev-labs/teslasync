import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import postcss from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs'
import {
  expectAppDesignDataMode, matchesAppDesignCss,
} from '@/components/feedback/appDesignCss.test-utils'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { StructuredDataView } from './StructuredDataView'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key,
      ),
  }),
}))

const data = {
  exact_number: -0.123456789,
  numeric_code: '0012.3400',
  measured_zero: 0,
  disabled: false,
  unknown_value: null,
  nested_records: [{ enabled: true, api_key: 'must-not-render' }, [], {}],
  authorization: { nested: 'also-private' },
}

describe('StructuredDataView recursive source records', () => {
  it.each(PACK_IDS)('%s composes every real recursive row without flattening or losing raw source distinctions', pack => {
    const original = structuredClone(data)
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <StructuredDataView value={data} />
      </div>,
    )
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    const mode = APPLICATION_DESIGNS[pack].data
    try {
      const lists = host.querySelectorAll('dl[data-app-list="definitions"]')
      expect(lists).toHaveLength(2)
      expect([...lists[0].children].map(row => row.querySelector('dt')?.textContent)).toEqual([
        'Exact number', 'Numeric code', 'Measured zero', 'Disabled', 'Unknown value',
        'Nested records', 'Authorization',
      ])
      for (const list of lists) {
        for (const row of list.children) {
          expectAppDesignDataMode(row, mode, '[data-app-list="definitions"]')
          const label = row.querySelector(':scope > dt[data-app-part="metric-label"]')!
          const reading = row.querySelector(':scope > dd[data-app-part="metric-reading"]')!
          expect(label).not.toBeNull()
          expectAppDesignDataMode(reading, mode, '[data-app-part~="metric-reading"]')
          expect(matchesAppDesignCss(label, '[data-app-part~="metric-label"]').length).toBeGreaterThan(0)
        }
      }
      const cards = host.querySelectorAll('[data-app-part="card"][data-surface-variant="standalone"]')
      expect(cards).toHaveLength(3)
      const identity = postcss.parse(readFileSync(
        resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8',
      ))
      for (const card of cards) {
        const selected: string[] = []
        identity.walkRules(rule => {
          selected.push(...rule.selectors.filter(selector =>
            selector.includes('[data-app-part~="card"]') && card.matches(selector)))
        })
        expect(selected.length).toBeGreaterThan(0)
      }
      const nested = screen.getByText('Nested records').closest('dt')?.nextElementSibling
      expect(nested?.firstElementChild).toHaveClass('w-full', 'min-w-0', 'text-start')
      for (const value of ['-0.123456789', '0012.3400', '0', 'No', 'Yes', 'No value', 'Empty list', 'Empty object']) {
        expect(screen.getByText(value)).toBeInTheDocument()
      }
      expect(screen.getAllByText('Redacted')).toHaveLength(2)
      expect(screen.queryByText('must-not-render')).not.toBeInTheDocument()
      expect(screen.queryByText('also-private')).not.toBeInTheDocument()
      expect(host.querySelector('[role="progressbar"], [data-metric-track]')).toBeNull()
      expect(data).toEqual(original)
    } finally {
      release()
      view.unmount()
    }
  })

  it('retains the depth-eight limit and explicit empty explanations', () => {
    let value: unknown = 'beyond-limit'
    for (let depth = 0; depth < 8; depth++) value = { child: value }
    render(<StructuredDataView value={{ too_deep: value, empty_object: {}, empty_array: [] }} />)
    expect(screen.getByText('Additional nested data')).toBeInTheDocument()
    expect(screen.queryByText('beyond-limit')).not.toBeInTheDocument()
    const emptyObject = screen.getByTitle('empty_object').closest('dt')?.nextElementSibling
    expect(emptyObject).toHaveTextContent('Empty object')
    expect(screen.getByText('Empty list')).toBeInTheDocument()
    expect(screen.getByText('Empty array')).toBeInTheDocument()
  })

  it('does not borrow a complete root profile inside a neutral nested preview', () => {
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes('v1')}>
        <div data-app-design-preview="" data-testid="neutral">
          <StructuredDataView value={data} />
        </div>
      </div>,
    )
    const release = observeAppDesignScopes(view.container.firstElementChild!)
    try {
      const neutral = screen.getByTestId('neutral')
      expect(within(neutral).getByText('0')).toBeInTheDocument()
      for (const row of neutral.querySelectorAll('[data-app-part="list-row"], [data-app-part="card"]')) {
        expect(row).not.toHaveAttribute('data-app-design-owner')
        expect(matchesAppDesignCss(row)).toEqual([])
      }
    } finally {
      release()
      view.unmount()
    }
  })
})

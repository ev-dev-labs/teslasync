import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs'
import { matchingAppDesignDataRules, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { AIFeatureCard, type AIFeatureStream } from './AIFeatureCard'

afterEach(cleanup)

describe('AIFeatureCard real output/loading/evidence consumers', () => {
  it.each(PACK_IDS)('binds %s at the nearest complete profile without treating tool execution as answer trust', async packId => {
    const start = vi.fn()
    const view = (stream: Partial<AIFeatureStream>) => <div data-app-design-preview="" {...getAppDesignAttributes('classic')}>
      <div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
        <AIFeatureCard title="Source explanation" description="Source context remains available."
          buttonLabel="Explain" canStart stream={{ state: 'idle', text: '', error: null, start, ...stream }} />
      </div>
    </div>
    const { container, rerender } = render(view({}))
    const release = observeAppDesignScopes(container)
    try {
      expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Ask Helix · Explain' }))
      expect(start).toHaveBeenCalledOnce()

      rerender(view({ state: 'streaming' }))
      const output = screen.getByTestId('ai-output-panel')
      await waitFor(() => expect(output.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`))
      const surfaceSelectors: string[] = []
      postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[packId]), 'utf8'))
        .walkRules(rule => {
          surfaceSelectors.push(...rule.selectors.filter(selector => selector.includes('[data-app-part~="card"]')))
        })
      expect(surfaceSelectors.some(selector => output.matches(selector))).toBe(true)
      const indicator = screen.getByTestId('ai-thinking-indicator')
      expect(indicator).toHaveAttribute('role', 'status')
      const placeholders = indicator.querySelectorAll('[data-app-part~="skeleton"]')
      expect(placeholders).toHaveLength(3)
      expect([...placeholders].map(node => node.className)).toEqual([
        expect.stringContaining('w-full'), expect.stringContaining('w-11/12'), expect.stringContaining('w-9/12'),
      ])
      for (const skeleton of placeholders) {
        expect(skeleton).toHaveAttribute('aria-hidden', 'true')
        expect(matchesAppDesignCss(skeleton, '[data-app-part~="skeleton"]')
          .some(match => match.declarations['background-color']?.includes('--skeleton-bg'))).toBe(true)
      }
      const action = screen.getByRole('button', { name: 'Ask Helix · Explain' })
      expect(action).toBeDisabled()
      fireEvent.click(action)
      expect(start).toHaveBeenCalledOnce()

      const partial = 'Unverified partial response\n  keep the source whitespace.'
      const activity = [
        { id: 'one', name: 'long-source-name-'.repeat(12), status: 'running' as const },
        { id: 'two', name: 'query_battery_status', status: 'succeeded' as const },
        { id: 'three', name: 'unavailable_source', status: 'failed' as const },
      ]
      rerender(view({ state: 'error', text: partial, error: 'stream_http_403', activity, usage: { in: 3, out: 0 } }))
      const alert = screen.getByRole('alert')
      await waitFor(() => expect(alert.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`))
      expect(alert).toHaveTextContent('Permission denied')
      expect(alert).toHaveTextContent('stream_http_403')
      expect(matchesAppDesignCss(alert, '[data-app-feedback-kind="notice"]')).not.toHaveLength(0)
      expect(screen.getByText('Unverified partial response', { exact: false }).textContent).toBe(partial)
      expect(screen.queryByTestId('ai-thinking-indicator')).not.toBeInTheDocument()
      const trail = screen.getByTestId('helix-evidence-trail')
      const list = trail.querySelector('[data-app-list="definitions"]')
      if (!list) throw new Error('Missing real evidence list')
      const rows = [...list.querySelectorAll('[data-app-part~="list-row"]')]
      expect(rows).toHaveLength(activity.length)
      expect(rows.map(row => row.getAttribute('title'))).toEqual(activity.map(item => item.name))
      for (const row of rows) {
        expect(matchingAppDesignDataRules(row, '[data-app-part~="list-row"]')).not.toHaveLength(0)
      }
      expect(rows[1]).toHaveTextContent('Battery status')
      expect(rows[1]).toHaveTextContent('successful')
      expect(rows[2]).toHaveTextContent('Unavailable')
      expect(trail).not.toHaveTextContent(/verified|trusted|citation|3 tokens used/i)
      expect(screen.getByRole('button', { name: 'Ask Helix · Explain' })).toBeEnabled()
      expect(screen.getByText('Source context remains available.')).toBeInTheDocument()

      rerender(view({ state: 'done' }))
      expect(screen.getByTestId('ai-output-panel')).toHaveTextContent('No output was generated.')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByTestId('helix-evidence-trail')).not.toBeInTheDocument()
    } finally {
      release()
    }
  })

  it('leaves default and incomplete-preview output unowned even under an outer application profile', () => {
    const { container } = render(<>
      <AIFeatureCard title="Default" description="Default context" buttonLabel="Explain" canStart
        stream={{ state: 'done', text: 'Default response', error: null, start: vi.fn() }} />
      <div data-app-design-preview="" {...getAppDesignAttributes('terminal')}>
        <div data-app-design-preview="" data-app-design-pack="v2">
          <AIFeatureCard title="Incomplete" description="Incomplete context" buttonLabel="Explain" canStart
            stream={{ state: 'streaming', text: '', error: null, start: vi.fn() }} />
        </div>
      </div>
    </>)
    const release = observeAppDesignScopes(container)
    try {
      for (const output of screen.getAllByTestId('ai-output-panel')) {
        expect(output).not.toHaveAttribute('data-app-design-owner')
      }
      const skeleton = container.querySelector('[data-app-part~="skeleton"]')
      if (!skeleton) throw new Error('Missing source-shaped skeleton')
      expect(matchesAppDesignCss(skeleton, '[data-app-part~="skeleton"]')).toHaveLength(0)
    } finally {
      release()
    }
  })
})

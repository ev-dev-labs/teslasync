import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { useSettings } from '@/hooks/useSettings'
import { appSettingsPayload } from '@/test/fixtures/appSettings'
import { sseFrame } from '@/test/fixtures/aiPayloads'
import { AINLGrafanaPanel, type GrafanaPanelDraft } from './AINLGrafanaPanel'
import { AINLSqlPlayground, type ReadonlySQLDraft } from './AINLSqlPlayground'

vi.mock('@/hooks/useSettings', () => ({ useSettings: vi.fn() }))

const prompt = 'Review the recorded source data'
const grafana: GrafanaPanelDraft = {
  prompt,
  panel: {
    title: 'Source panel title', type: 'timeseries',
    datasource: { type: 'postgres', uid: 'existing-datasource' },
    targets: [{ ref_id: 'A', raw_sql: 'SELECT 0 AS value' }],
    grid_pos: { x: 0, y: 0, w: 12, h: 8 },
  },
  rationale: 'An unverified proposal, not a published panel.',
  referenced_tables: ['drives', 'charging_sessions'],
}
const sql: ReadonlySQLDraft = {
  prompt,
  sql: 'SELECT 0 AS value;\n-- Keep the exact SQL and indentation\n  ',
  rationale: 'An unverified proposal, not an executed query.',
  referenced_tables: ['drives', 'charging_sessions'],
}
const candidates = [
  {
    kind: 'Grafana', tool: 'draft_grafana_panel', label: 'Grafana panel request',
    previewId: 'ai-feature-nl-grafana-panel-draft', draft: grafana,
    view: (onApply: (draft: unknown) => void) => <AINLGrafanaPanel onApply={onApply} />,
  },
  {
    kind: 'SQL', tool: 'draft_readonly_sql', label: 'SQL request',
    previewId: 'ai-sql-draft-preview', draft: sql,
    view: (onApply: (draft: unknown) => void) => <AINLSqlPlayground onApply={onApply} />,
  },
]

beforeEach(() => {
  vi.mocked(useSettings).mockReturnValue(appSettingsPayload({
    ai_mode: 'cloud',
    ai_features: { 'nl-grafana-panel': true, 'nl-sql-playground': true },
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe.each(candidates)('$kind native proposal surface', candidate => {
  it.each(PACK_IDS)('activates the %s frame only for a captured proposal and keeps Apply explicit and blocked during streaming', async packId => {
    const encoder = new TextEncoder()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const response = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const fetch = vi.fn(async () => new Response(response, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetch)
    const onApply = vi.fn<(draft: unknown) => void>()
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes('classic')}>
      <div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
        {candidate.view(onApply)}
      </div>
    </div>)
    const release = observeAppDesignScopes(container)
    try {
      expect(screen.queryByTestId(candidate.previewId)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Apply to editor' })).not.toBeInTheDocument()
      expect(fetch).not.toHaveBeenCalled()
      fireEvent.change(screen.getByRole('textbox', { name: candidate.label }), { target: { value: prompt } })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Ask Helix/ }))
      })
      expect(fetch).toHaveBeenCalledOnce()
      const streamController = controller
      if (!streamController) throw new Error('Proposal stream did not start')
      await act(async () => {
        streamController.enqueue(encoder.encode(sseFrame('tool_result', {
          id: 'proposal', name: candidate.tool, ok: true, data: { status: 'ok', draft: candidate.draft },
        })))
      })
      const preview = await screen.findByTestId(candidate.previewId)
      await waitFor(() => expect(preview.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`))
      const surfaceSelectors: string[] = []
      postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[packId]), 'utf8'))
        .walkRules(rule => {
          surfaceSelectors.push(...rule.selectors.filter(selector => selector.includes('[data-app-part~="card"]')))
        })
      expect(surfaceSelectors.some(selector => preview.matches(selector))).toBe(true)
      expect(preview).toHaveAttribute('role', 'group')
      expect(preview).toHaveTextContent('Referenced tables: drives, charging_sessions')
      if (candidate.kind === 'SQL') {
        expect(preview.querySelector('pre')?.textContent).toBe(sql.sql)
        expect(preview).toHaveTextContent(sql.rationale)
      } else {
        expect(preview).toHaveTextContent(grafana.panel.title)
        expect(preview).toHaveTextContent('Panel type: timeseries')
        expect(preview).toHaveTextContent('Datasource: postgres (existing-datasource)')
        expect(preview).toHaveTextContent('Query targets: 1')
        expect(container.querySelector('svg.recharts-surface')).toBeNull()
      }
      const apply = screen.getByRole('button', { name: 'Apply to editor' })
      expect(apply).toBeDisabled()
      fireEvent.click(apply)
      expect(onApply).not.toHaveBeenCalled()
      await act(async () => {
        streamController.enqueue(encoder.encode(sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 0 } })))
        streamController.close()
      })
      await waitFor(() => expect(apply).toBeEnabled())
      expect(onApply).not.toHaveBeenCalled()
      fireEvent.click(apply)
      expect(onApply).toHaveBeenCalledExactlyOnceWith(candidate.draft)
      expect(fetch).toHaveBeenCalledOnce()
    } finally {
      release()
    }
  })
})

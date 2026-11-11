import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { summarizeReleaseNote, toReleaseNote, type ReleaseNote } from '@/lib/releaseNotes'
import { ReleaseNotesPanel } from '../ReleaseNotesPanel'

const fixture = vi.hoisted(() => ({ notes: [] as ReleaseNote[] }))
vi.mock('@/lib/releaseNotes', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/releaseNotes')>(),
  buildReleaseNotes: () => fixture.notes,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

beforeEach(() => {
  fixture.notes = [
    toReleaseNote({
      version: '9.0.0', date: '2026-11-10', badge: 'latest',
      changes: [
        { type: 'added', text: 'Original feature wording.' },
        { type: 'changed', text: 'Manual migration action required for administrators.' },
        { type: 'fixed', text: 'API endpoint response fix for fleet operators.' },
      ],
    }),
    toReleaseNote({
      version: '8.0.0', date: '2026-11-09', badge: 'stable',
      changes: [{ type: 'fixed', text: 'Original earlier fix.' }],
    }),
  ]
})

describe('ReleaseNotesPanel native records', () => {
  it('owns release frames/audience tags while retaining release order, action-first source text and caveats', () => {
    render(<ReleaseNotesPanel />)
    const records = screen.getAllByTestId('release-note')
    expect(records.map(record => record.getAttribute('data-release-version'))).toEqual(['9.0.0', '8.0.0'])
    records.forEach((record, index) => {
      const note = fixture.notes[index]
      expect(record.tagName).toBe('ARTICLE')
      expect(record).toHaveAttribute('data-app-record-kind', 'release-note')
      expect(record.querySelector('[data-app-record-slot="label"]')).toHaveTextContent(note.version)
      expect(record.querySelector('[data-app-record-slot="context"]')).toBeVisible()
      const body = record.querySelector('[data-app-record-slot="body"]') as HTMLElement
      expect(within(body).getAllByRole('listitem').map(item =>
        item.textContent?.replace(/^Action:/, '').trim(),
      )).toEqual(summarizeReleaseNote(note).map(item => item.text))
      const audiences = within(record).getByTestId('release-audiences')
        .querySelectorAll('[data-app-part="badge"][data-app-variant="neutral"]')
      expect(Array.from(audiences, tag => tag.getAttribute('data-release-audience'))).toEqual(note.audiences)
    })
    expect(within(records[0]).getByTestId('release-action-badge')).toBeVisible()
    expect(within(records[0]).getByTestId('release-migration-badge')).toBeVisible()
    expect(within(records[1]).queryByTestId('release-action-badge')).not.toBeInTheDocument()
    expect(screen.getByText(/flagged conservatively/)).toBeVisible()
  })

  it('keeps the panel and explicit empty result when the requested limit is zero', () => {
    render(<ReleaseNotesPanel limit={0} />)
    expect(screen.getByTestId('release-notes-panel')).toBeVisible()
    expect(screen.getByTestId('release-notes-empty')).toBeVisible()
    expect(screen.queryByTestId('release-note')).not.toBeInTheDocument()
  })
})

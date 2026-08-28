import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '@/i18n'

import { HelpSearch } from '../HelpSearch'

/**
 * HELP-06 — keyboard operability and determinism of the rendered index.
 *
 * The search field is a combobox over a listbox with roving
 * `aria-activedescendant`, so DOM focus never leaves the input: a keyboard
 * user can keep typing while arrowing through results, which is the whole
 * reason this pattern exists rather than a list of tab stops.
 */

function renderSearch(pathname = '/charging') {
  return render(
    <MemoryRouter initialEntries={['/help']}>
      <Routes>
        <Route path="/help" element={<HelpSearch pathname={pathname} />} />
        <Route path="/battery" element={<div data-testid="battery-page">Battery</div>} />
        <Route
          path="/charging/vampire-drain"
          element={<div data-testid="vampire-page">Vampire</div>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HelpSearch — baseline', () => {
  it('suggests route-relevant entries before the user types anything', () => {
    renderSearch('/charging')
    expect(screen.getByTestId('help-search-status')).toHaveTextContent(/relevant to this page/i)
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })

  it('wires the combobox to its listbox', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    const listbox = screen.getByRole('listbox')
    expect(input).toHaveAttribute('role', 'combobox')
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('returns the same ordered results for the same query', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')

    fireEvent.change(input, { target: { value: 'phantom drain' } })
    const first = screen.getAllByRole('option').map((el) => el.getAttribute('data-help-entry-id'))

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.change(input, { target: { value: 'phantom drain' } })
    const second = screen.getAllByRole('option').map((el) => el.getAttribute('data-help-entry-id'))

    expect(second).toEqual(first)
  })

  it('surfaces the definition first for a defined term', () => {
    renderSearch()
    fireEvent.change(screen.getByTestId('help-search-input'), {
      target: { value: 'phantom drain' },
    })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute(
      'data-help-entry-id',
      'glossary:phantom_drain',
    )
  })

  it('reports the result count in a live region', () => {
    renderSearch()
    fireEvent.change(screen.getByTestId('help-search-input'), { target: { value: 'battery' } })
    expect(screen.getByTestId('help-search-status')).toHaveTextContent(/results/i)
  })

  it('explains itself when nothing matches instead of showing a bare empty list', () => {
    renderSearch()
    fireEvent.change(screen.getByTestId('help-search-input'), {
      target: { value: 'zzzzqqqqxxxx' },
    })
    expect(screen.getByTestId('help-search-empty')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})

describe('HelpSearch — keyboard', () => {
  it('marks the first result active and moves with ArrowDown/ArrowUp', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    fireEvent.change(input, { target: { value: 'battery' } })

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('wraps around at both ends', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    fireEvent.change(input, { target: { value: 'battery' } })
    const count = screen.getAllByRole('option').length

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[count - 1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps DOM focus in the input while arrowing', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    input.focus()
    fireEvent.change(input, { target: { value: 'battery' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(input)
  })

  it('navigates to the active result on Enter', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    fireEvent.change(input, { target: { value: 'phantom drain' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('vampire-page')).toBeInTheDocument()
  })

  it('clears the query on Escape', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'battery' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
  })

  it('ignores keyboard navigation when there are no results', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    fireEvent.change(input, { target: { value: 'zzzzqqqqxxxx' } })
    expect(() => fireEvent.keyDown(input, { key: 'Enter' })).not.toThrow()
  })

  it('navigates on click as well as Enter', () => {
    renderSearch()
    const input = screen.getByTestId('help-search-input')
    fireEvent.change(input, { target: { value: 'phantom drain' } })
    fireEvent.click(screen.getAllByRole('option')[0])
    expect(screen.getByTestId('vampire-page')).toBeInTheDocument()
  })
})

describe('HelpSearch — no network', () => {
  it('never issues a fetch — the index is a static baseline', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderSearch()
    fireEvent.change(screen.getByTestId('help-search-input'), { target: { value: 'battery' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})

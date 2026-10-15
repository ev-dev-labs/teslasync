import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import catalog from '@/i18n/en.json'
import driving from '@/i18n/en/locale-driving.json'
import drives from '@/i18n/en/locale-detail-drives.json'
import { DrivesEvidenceEmpty } from './DrivesEvidenceEmpty'
import { DrivesEvidenceSection } from './DrivesEvidenceSection'

vi.unmock('react-i18next')
vi.mock('./DrivesEvidenceHeading', () => ({ DrivesEvidenceHeading: () => null }))
vi.mock('./DrivesEvidenceNotices', () => ({ DrivesEvidenceNotices: () => null }))
vi.mock('./DrivesDesktopEvidence', () => ({ DrivesDesktopEvidence: () => 'Desktop evidence' }))
vi.mock('./DrivesMobileEvidence', () => ({ DrivesMobileEvidence: () => 'Mobile evidence' }))

const english = createInstance()
type Props = Parameters<typeof DrivesEvidenceEmpty>[0]
const reset = {
  q: null, from: null, to: null, coll: null, fsd: null,
  grid_values: null, sort: null, page: null,
}

beforeAll(async () => {
  await english.init({
    lng: 'en', fallbackLng: 'en',
    resources: { en: { translation: catalog } },
    interpolation: { escapeValue: false },
  })
})
afterEach(cleanup)

function mount(overrides: Partial<Props> = {}) {
  const setUrlBatch = vi.fn()
  render(
    <I18nextProvider i18n={english}>
      <DrivesEvidenceEmpty collection="all" fsdFilter="all" hasValueFilters={false}
        t={english.getFixedT('en')} setUrlBatch={setUrlBatch} {...overrides} />
    </I18nextProvider>,
  )
  return setUrlBatch
}

describe('DrivesEvidenceEmpty scalar title regression', () => {
  it('ships the exact source-owned title and keeps the accepted message subtree', async () => {
    expect(catalog.drives.emptyForCollection).toEqual({
      msg: 'Try switching to a different collection or clearing your filters.',
      title: 'No drives in this view',
    })
    expect(english.exists('drives.emptyForCollection.title')).toBe(true)
    expect(english.t('drives.emptyForCollection.title', { returnObjects: true })).toBe('No drives in this view')
    for (const resource of [driving, drives]) {
      const generatedEnglish = createInstance()
      await generatedEnglish.init({ lng: 'en', resources: { en: { translation: resource } } })
      expect(generatedEnglish.exists('drives.emptyForCollection.title')).toBe(true)
      expect(generatedEnglish.t('drives.emptyForCollection.title', { returnObjects: true })).toBe('No drives in this view')
    }
  })

  it.each([
    { collection: 'commute' },
    { collection: 'unrecognized' },
    { fsdFilter: 'with' },
    { hasValueFilters: true },
  ] as Partial<Props>[])('renders the exact filtered title for %j, never an object diagnostic', overrides => {
    mount(overrides)
    expect(screen.getByRole('heading', { name: 'No drives in this view' })).toBeInTheDocument()
    expect(screen.getByText('Try switching to a different collection or clearing your filters.')).toBeInTheDocument()
    expect(screen.queryByText(/returned an object|emptyForCollection\.title/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Reset filters' })).toHaveLength(1)
  })

  it('preserves the unfiltered no-records copy and exact null reset without inventing a selection', () => {
    const setUrlBatch = mount()
    expect(screen.getByRole('heading', { name: 'No drives recorded yet' })).toBeInTheDocument()
    expect(screen.getByText('Drive data will appear here once your vehicle records trips.')).toBeInTheDocument()
    expect(screen.getByTestId('empty-state-guidance')).toHaveAttribute('data-guidance-id', 'drives.list')
    expect(setUrlBatch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(setUrlBatch).toHaveBeenCalledExactlyOnceWith(reset)
  })

  it('preserves the filtered CTA and all eight null URL controls', () => {
    const setUrlBatch = mount({ collection: 'commute', hasValueFilters: true })
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(setUrlBatch).toHaveBeenCalledExactlyOnceWith(reset)
  })

  it.each(['empty', 'loading', 'error', 'populated'] as const)(
    'renders the existing section %s boundary with installed i18next', state => {
      const refetchDrives = vi.fn()
      const model = {
        t: english.getFixedT('en'), collection: 'all', fsdFilter: 'all', hasValueFilters: false,
        setUrlBatch: vi.fn(), desktopEvidence: false, isDrivesLoading: state === 'loading',
        dateFilteredDrives: [], tableControls: {}, refetchDrives,
        drivesState: { fatalError: state === 'error' ? new Error('Drive source unavailable') : null },
        paginatedDrives: state === 'populated' ? [{ id: 1 }] : [],
        bulkSelected: new Set(), filteredDrives: [], clearBulk: vi.fn(), bulkDriveActions: [],
      } as unknown as Parameters<typeof DrivesEvidenceSection>[0]['model']
      const { container } = render(
        <I18nextProvider i18n={english}>
          <MemoryRouter><DrivesEvidenceSection model={model} /></MemoryRouter>
        </I18nextProvider>,
      )
      expect(screen.getByRole('region', { name: 'Drive list' })).toBeInTheDocument()
      if (state === 'empty') {
        expect(screen.getByRole('heading', { name: 'No drives recorded yet' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument()
      } else {
        expect(screen.queryByRole('button', { name: 'Reset filters' })).not.toBeInTheDocument()
        expect(screen.queryByText('No drives in this view')).not.toBeInTheDocument()
        if (state === 'loading') expect(container.querySelectorAll('.h-20')).toHaveLength(5)
        if (state === 'error') {
          expect(screen.getByRole('alert')).toBeInTheDocument()
          fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
          expect(refetchDrives).toHaveBeenCalledOnce()
        }
        if (state === 'populated') expect(screen.getByText('Mobile evidence')).toBeInTheDocument()
      }
    },
  )

  it('does not add vehicle-selection controls to the no-records renderer', () => {
    mount()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

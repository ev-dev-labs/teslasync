import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import App from '@/App'
import { resetProductPreferences, updateProductPreferences } from '@/lib/productPreferences'
import { __resetTitleStoreForTests } from '@/lib/titleStore'
import en from '@/i18n/en.json'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}))
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/components/layout/Layout', async () => {
  const { Outlet } = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { default: () => <main><Outlet /></main> }
})
vi.mock('@/components/layout/ScrollRestoration', () => ({ ScrollRestoration: () => null }))
vi.mock('@/features/onboarding/components/OnboardingGate', () => ({ OnboardingGate: () => null }))
vi.mock('@/features/onboarding/components/TaskOnboardingHost', () => ({ TaskOnboardingHost: () => null }))
vi.mock('@/components/ui/DensityApplier', () => ({ DensityApplier: () => null }))
vi.mock('@/components/ui/ContextMenu', () => ({ ContextMenuRoot: () => null }))
vi.mock('@/components/feedback/VitalsConsentPolicyGate', () => ({ VitalsConsentPolicyGate: () => null }))

const experiments = [
  ['vehicle-lab', en.experiments.vehicleLab],
  ['route-flyover', en.experiments.routeFlyover],
  ['energy-flow', en.experiments.energyFlow],
  ['year-in-motion', en.experiments.yearInMotion],
  ['battery-what-if', en.experiments.batteryWhatIf],
  ['drive-art', en.experiments.driveArt],
] as const

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetProductPreferences()
  __resetTitleStoreForTests()
})

describe.each([true, false])('experiment bookmarks with navigation visibility %s', showExperiments => {
  it.each(experiments)('renders the real lazy %s route, title, description and Experimental badge', async (slug, copy) => {
    updateProductPreferences({ showExperiments })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/experiments/${slug}`]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: copy.title }, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: copy.title })).toBeInTheDocument()
    expect(screen.getByText(copy.description)).toBeInTheDocument()
    expect(screen.getByText(en.experiments.badge)).toBeInTheDocument()
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
  })
})

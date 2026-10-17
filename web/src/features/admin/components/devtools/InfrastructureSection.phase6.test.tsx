import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createInstance, type i18n } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { request } from '@/api/client'
import { InfrastructureSection } from './InfrastructureSection'

vi.unmock('react-i18next')
vi.mock('@/api/client', () => ({ request: vi.fn() }))

const requestMock = vi.mocked(request<Record<string, unknown>>)
const clients: QueryClient[] = []
let translations: i18n

const fixedPing = {
  connected: true,
  topic: 'teslasync/dev-tools/ping',
  payload: '{"timestamp":"2026-10-14T12:00:00Z","source":"dev-tools"}',
  message: 'test message published',
}

beforeEach(async () => {
  requestMock.mockReset()
  translations = createInstance()
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    initAsync: false,
    interpolation: { escapeValue: false },
    // This fixture deliberately retains the old misleading key. It is not
    // proof that the new copy exists in an external production catalog.
    resources: {
      en: {
        translation: {
          devtools: {
            infra: { mqttDesc: 'Publish a test message to the MQTT broker' },
          },
        },
      },
    },
  })
})

afterEach(() => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
})

function renderSection() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  clients.push(client)
  return render(
    <I18nextProvider i18n={translations}>
      <QueryClientProvider client={client}>
        <InfrastructureSection />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function mqttCard() {
  const card = screen.getByRole('heading', { name: 'MQTT' }).closest('[data-print-card]')
  if (!(card instanceof HTMLElement)) throw new Error('MQTT card not found')
  return card
}

describe('InfrastructureSection phase6 fixed connectivity ping semantics', () => {
  it('describes the fixed ping and ignored inputs without an arbitrary-publish promise', () => {
    const { container } = renderSection()
    const card = mqttCard()

    expect(card).toHaveTextContent('fixed MQTT connectivity ping')
    expect(card).toHaveTextContent('teslasync/dev-tools/ping')
    expect(card).toHaveTextContent('generated timestamp/source payload')
    expect(card).toHaveTextContent('topic and message inputs are ignored')
    expect(screen.queryByText('Publish a test message to the MQTT broker')).not.toBeInTheDocument()
    expect(translations.exists('devtools.infra.mqttPingDesc')).toBe(false)
    expect(screen.getAllByRole('heading')).toHaveLength(5)
    for (const name of ['DB stats', 'Migrations', 'MQTT', 'Env check', 'Runtime']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(container.firstElementChild).toHaveClass('grid', 'md:grid-cols-2', '2xl:grid-cols-3')
    expect(screen.getAllByRole('button', { name: 'Run' })).toHaveLength(4)
    expect(within(card).getByRole('button', { name: 'Send test' })).toBeEnabled()
    expect(card.querySelector('pre')).toBeNull()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('uses translated fixed-ping copy and existing labels when translations are available', () => {
    translations.addResource('en', 'translation', 'devtools.infra.mqttPingDesc', 'Vérifier la connexion MQTT avec le ping fixe.')
    translations.addResource('en', 'translation', 'devtools.infra.topic', 'Sujet')
    translations.addResource('en', 'translation', 'devtools.infra.message', 'Contenu')
    translations.addResource('en', 'translation', 'devtools.infra.sendTest', 'Envoyer le test')
    renderSection()

    expect(mqttCard()).toHaveTextContent('Vérifier la connexion MQTT avec le ping fixe.')
    expect(screen.getByLabelText('Sujet')).toBeInTheDocument()
    expect(screen.getByLabelText('Contenu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Envoyer le test' })).toBeEnabled()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it.each([
    { topic: '', message: '' },
    { topic: 'synthetic/ignored-topic', message: '{"synthetic":"ignored-message"}' },
  ])('preserves explicit POST transport for $topic while displaying the server fixed-ping receipt', async ({ topic, message }) => {
    const user = userEvent.setup()
    requestMock.mockResolvedValueOnce(fixedPing)
    renderSection()

    const topicField = screen.getByLabelText('Topic')
    const messageField = screen.getByLabelText('Message')
    expect(topicField).toHaveAttribute('placeholder', 'test/topic')
    if (topic) await user.type(topicField, topic)
    if (message) await user.click(messageField)
    if (message) await user.paste(message)
    expect(requestMock).not.toHaveBeenCalled()

    const action = screen.getByRole('button', { name: 'Send test' })
    action.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledExactlyOnceWith('/dev-tools/mqtt-test', {
        method: 'POST',
        body: JSON.stringify({ topic, message }),
      })
      expect(mqttCard().querySelector('pre')).toHaveTextContent('"connected": true')
    })
    const displayed = JSON.parse(mqttCard().querySelector('pre')?.textContent ?? '')
    expect(displayed).toEqual(fixedPing)
    expect(topicField).toHaveValue(topic)
    expect(messageField).toHaveValue(message)
  })

  it('shows a disconnected receipt as textual evidence instead of inventing publication success', async () => {
    const user = userEvent.setup()
    requestMock.mockResolvedValueOnce({
      connected: false,
      message: 'MQTT client is not connected',
    })
    renderSection()
    await user.click(screen.getByRole('button', { name: 'Send test' }))

    await waitFor(() => {
      expect(mqttCard().querySelector('pre')).toHaveTextContent('"connected": false')
    })
    expect(mqttCard()).toHaveTextContent('MQTT client is not connected')
    expect(mqttCard().querySelector('pre')).not.toHaveTextContent('test message published')
    expect(requestMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the action busy and disabled during the existing request, then permits another ping', async () => {
    const user = userEvent.setup()
    let resolveRequest: (value: typeof fixedPing) => void = () => {}
    requestMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRequest = resolve
    }))
    requestMock.mockResolvedValueOnce(fixedPing)
    renderSection()
    const action = screen.getByRole('button', { name: 'Send test' })
    await user.click(action)

    await waitFor(() => expect(action).toHaveAttribute('aria-busy', 'true'))
    expect(action).toBeDisabled()
    await user.click(action)
    expect(requestMock).toHaveBeenCalledTimes(1)
    resolveRequest(fixedPing)
    await waitFor(() => expect(action).toBeEnabled())
    expect(action).not.toHaveAttribute('aria-busy')
    await user.click(action)
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2))
  })

  it('retains non-color broker failure feedback, input values, and explicit retry recovery', async () => {
    const user = userEvent.setup()
    requestMock.mockRejectedValueOnce(new Error('synthetic broker unavailable'))
    requestMock.mockResolvedValueOnce(fixedPing)
    renderSection()
    await user.type(screen.getByLabelText('Topic'), 'synthetic/retry')
    await user.type(screen.getByLabelText('Message'), 'synthetic payload')
    const action = screen.getByRole('button', { name: 'Send test' })
    await user.click(action)

    await waitFor(() => {
      expect(within(mqttCard()).getByRole('alert')).toHaveTextContent('synthetic broker unavailable')
    })
    expect(mqttCard().querySelector('pre')).toBeNull()
    expect(action).toBeEnabled()
    expect(screen.getByLabelText('Topic')).toHaveValue('synthetic/retry')
    expect(screen.getByLabelText('Message')).toHaveValue('synthetic payload')
    await user.click(action)
    await waitFor(() => expect(mqttCard().querySelector('pre')).toHaveTextContent('"connected": true'))
    expect(within(mqttCard()).queryByRole('alert')).not.toBeInTheDocument()
    expect(requestMock).toHaveBeenNthCalledWith(2, '/dev-tools/mqtt-test', {
      method: 'POST',
      body: JSON.stringify({ topic: 'synthetic/retry', message: 'synthetic payload' }),
    })
  })
})

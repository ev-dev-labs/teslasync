/**
 * RequestBuilder behaviour + hardening contract tests.
 *
 * RequestBuilder is the request-composition surface of the API Playground. It
 * is network-free — it only derives a URL/method/body/headers tuple from the
 * selected endpoint plus local form state and hands it to an `onSend` callback.
 * Every test therefore drives the real component through its accessible surface
 * (the labelled path/query/API-key inputs, the request-body textarea, the Send
 * control, and the destructive-confirmation alert) and asserts the rendered
 * result or the exact `onSend` payload — never an implementation detail.
 *
 * It locks the guarantees the elevation established / fixed:
 *
 *   - a GET request is dispatched immediately with an undefined body and an
 *     empty header map (no confirmation gate for safe reads);
 *   - path templates are substituted from the path inputs and the preview URL
 *     tracks live edits;
 *   - a path value containing a `$&` / `$1` substitution token is inserted
 *     VERBATIM — the headline bug fix: the pre-elevation
 *     `url.replace('{id}', value)` treated the value as a String.replace
 *     replacement pattern, so typing "$&" silently round-tripped back to the
 *     "{id}" placeholder instead of the literal text;
 *   - query params are URI-encoded, `default`s prepopulate, and empties are
 *     dropped from the query string;
 *   - a non-GET method is gated behind an assertive `role="alert"`
 *     confirmation, and only "Yes, send" dispatches while "Cancel" aborts;
 *   - the X-API-Key header is trimmed and omitted when blank;
 *   - the request body is prefilled from the endpoint example (or a skeleton)
 *     and serialized into the POST payload;
 *   - switching endpoints resets params, body, and the confirmation gate;
 *   - the loading prop disables Send and swaps its label to "Sending…";
 *   - path/query/API-key inputs expose real associated labels, and an endpoint
 *     with a missing `parameters` array renders without throwing (null-safety).
 *
 * `@testing-library/user-event` is not installed in this repo (see the sibling
 * Base64Tool.test.tsx / TimestampTool.test.tsx), so interactions go through
 * `fireEvent`. Real i18n is loaded so assertions run against the production
 * en.json `playground.*` strings.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import '@/i18n'
import RequestBuilder from './RequestBuilder'
import type { ParsedEndpoint, ParsedParam } from './EndpointSidebar'

/* ─── fixtures ────────────────────────────────────────────────────────── */

function makeParam(overrides: Partial<ParsedParam> = {}): ParsedParam {
  return {
    name: 'param',
    in: 'query',
    required: false,
    type: 'string',
    description: '',
    ...overrides,
  }
}

function makeEndpoint(overrides: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    method: 'GET',
    path: '/vehicles',
    tag: 'Vehicles',
    summary: '',
    description: '',
    operationId: 'listVehicles',
    parameters: [],
    responses: {},
    ...overrides,
  }
}

function renderBuilder(
  props: Partial<React.ComponentProps<typeof RequestBuilder>> = {},
) {
  const onSend = vi.fn()
  const utils = render(
    <RequestBuilder
      endpoint={props.endpoint ?? makeEndpoint()}
      onSend={props.onSend ?? onSend}
      loading={props.loading ?? false}
    />,
  )
  return { onSend: props.onSend ?? onSend, ...utils }
}

/** The rendered preview URL, e.g. "/api/v1/drives/42/telemetry". */
function urlText(container: HTMLElement): string {
  return container.querySelector('code')?.textContent ?? ''
}

function sendButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Send' })
}

afterEach(() => {
  cleanup()
})

/* ─── tests ───────────────────────────────────────────────────────────── */

describe('RequestBuilder', () => {
  it('renders the method badge + preview URL and dispatches a GET immediately with no body or headers', () => {
    const onSend = vi.fn()
    const { container } = renderBuilder({
      endpoint: makeEndpoint({ method: 'GET', path: '/vehicles' }),
      onSend,
    })

    // Method badge + full preview URL (the request() client adds /api/v1).
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(urlText(container)).toBe('/api/v1/vehicles')

    // GET is a safe read — one click sends, no confirmation gate appears.
    fireEvent.click(sendButton())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('/vehicles', 'GET', undefined, {})
  })

  it('substitutes path templates from the labelled inputs and tracks live edits in the preview URL', () => {
    const onSend = vi.fn()
    const { container } = renderBuilder({
      endpoint: makeEndpoint({
        method: 'GET',
        path: '/drives/{driveID}/telemetry',
        parameters: [makeParam({ name: 'driveID', in: 'path', required: true })],
      }),
      onSend,
    })

    // Before input, the unfilled placeholder is preserved in the URL.
    expect(urlText(container)).toBe('/api/v1/drives/{driveID}/telemetry')

    // The path input is reachable by its associated label (was unassociated
    // before the elevation) and editing it rewrites the preview live.
    const input = screen.getByLabelText(/driveID/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '42' } })
    expect(urlText(container)).toBe('/api/v1/drives/42/telemetry')

    fireEvent.click(sendButton())
    expect(onSend).toHaveBeenCalledWith('/drives/42/telemetry', 'GET', undefined, {})
  })

  it('encodes query params, prepopulates declared defaults, and drops empty values', () => {
    const { container } = renderBuilder({
      endpoint: makeEndpoint({
        method: 'GET',
        path: '/signals',
        parameters: [
          makeParam({ name: 'vehicle_id', in: 'query', required: true }),
          makeParam({ name: 'limit', in: 'query', default: '50' }),
        ],
      }),
    })

    // `limit` has a default → prepopulated into the query string; the empty,
    // required `vehicle_id` is omitted until the user types.
    expect(urlText(container)).toBe('/api/v1/signals?limit=50')

    // Required marker only on the required param's label.
    const vehicleLabel = container.querySelector('label[for="req-query-vehicle_id"]')
    const limitLabel = container.querySelector('label[for="req-query-limit"]')
    expect(vehicleLabel?.textContent).toContain('*')
    expect(limitLabel?.textContent).not.toContain('*')

    // A value with reserved URL characters is percent-encoded.
    fireEvent.change(screen.getByLabelText(/vehicle_id/), {
      target: { value: 'a b&c' },
    })
    expect(urlText(container)).toBe('/api/v1/signals?vehicle_id=a%20b%26c&limit=50')
  })

  it('inserts a path value containing $-substitution tokens verbatim (String.replace regression)', () => {
    // Pre-elevation: url.replace('{id}', '$&') → the "$&" replacement token
    // re-inserted the matched "{id}", so the value never landed. The hardened
    // replacer-function path must emit the literal characters instead.
    const { container } = renderBuilder({
      endpoint: makeEndpoint({
        method: 'GET',
        path: '/x/{id}',
        parameters: [makeParam({ name: 'id', in: 'path', required: true })],
      }),
    })

    fireEvent.change(screen.getByLabelText(/id/), { target: { value: '$&' } })
    expect(urlText(container)).toBe('/api/v1/x/$&')
    expect(urlText(container)).not.toContain('{id}')
  })

  it('renders summary and description, and does not duplicate the description when it equals the summary', () => {
    const { rerender } = renderBuilder({
      endpoint: makeEndpoint({
        summary: 'List all vehicles',
        description: 'Returns a paginated fleet listing',
      }),
    })
    expect(screen.getByText('List all vehicles')).toBeInTheDocument()
    expect(screen.getByText('Returns a paginated fleet listing')).toBeInTheDocument()

    // When description === summary the component shows the copy exactly once.
    rerender(
      <RequestBuilder
        endpoint={makeEndpoint({ summary: 'Same text', description: 'Same text' })}
        onSend={vi.fn()}
        loading={false}
      />,
    )
    expect(screen.getAllByText('Same text')).toHaveLength(1)
  })

  it('prefills the request body from the endpoint example and surfaces the content type', () => {
    renderBuilder({
      endpoint: makeEndpoint({
        method: 'POST',
        path: '/alerts/rules',
        requestBody: { contentType: 'application/json', example: { name: 'High SoC' } },
      }),
    })

    expect(screen.getByText('Request Body')).toBeInTheDocument()
    expect(screen.getByText('application/json')).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText('{ "key": "value" }') as HTMLTextAreaElement
    expect(textarea.value).toBe(JSON.stringify({ name: 'High SoC' }, null, 2))
  })

  it('falls back to an editable JSON skeleton when a body is required without an example, and hides the body for GET', () => {
    const { rerender } = renderBuilder({
      endpoint: makeEndpoint({
        method: 'POST',
        path: '/alerts/rules',
        requestBody: { contentType: 'application/json' },
      }),
    })
    const textarea = screen.getByPlaceholderText('{ "key": "value" }') as HTMLTextAreaElement
    expect(textarea.value).toBe('{\n  \n}')

    // A GET with no requestBody exposes no body panel at all.
    rerender(
      <RequestBuilder
        endpoint={makeEndpoint({ method: 'GET', path: '/vehicles' })}
        onSend={vi.fn()}
        loading={false}
      />,
    )
    expect(screen.queryByPlaceholderText('{ "key": "value" }')).toBeNull()
  })

  it('gates a destructive method behind an assertive confirmation and only dispatches on confirm', () => {
    const onSend = vi.fn()
    renderBuilder({
      endpoint: makeEndpoint({ method: 'DELETE', path: '/drives/7' }),
      onSend,
    })

    // First click opens the alert instead of sending.
    fireEvent.click(sendButton())
    expect(onSend).not.toHaveBeenCalled()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This is a DELETE request')

    // Confirming dispatches with the destructive method and closes the alert.
    fireEvent.click(within(alert).getByRole('button', { name: /yes, send/i }))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('/drives/7', 'DELETE', undefined, {})
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('dismisses the confirmation via Cancel without dispatching', () => {
    const onSend = vi.fn()
    renderBuilder({
      endpoint: makeEndpoint({ method: 'POST', path: '/alerts/test' }),
      onSend,
    })

    fireEvent.click(sendButton())
    const alert = screen.getByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('trims the X-API-Key value into the header map', () => {
    const onSend = vi.fn()
    renderBuilder({
      endpoint: makeEndpoint({ method: 'GET', path: '/vehicles' }),
      onSend,
    })

    fireEvent.change(screen.getByLabelText('X-API-Key'), {
      target: { value: '  sk-secret  ' },
    })
    fireEvent.click(sendButton())
    expect(onSend).toHaveBeenCalledWith('/vehicles', 'GET', undefined, {
      'X-API-Key': 'sk-secret',
    })
  })

  it('omits the X-API-Key header when the field is left blank', () => {
    const onSend = vi.fn()
    renderBuilder({
      endpoint: makeEndpoint({ method: 'GET', path: '/drives' }),
      onSend,
    })

    // Whitespace-only keys are treated as blank (trimmed to empty).
    fireEvent.change(screen.getByLabelText('X-API-Key'), { target: { value: '   ' } })
    fireEvent.click(sendButton())
    expect(onSend).toHaveBeenCalledWith('/drives', 'GET', undefined, {})
  })

  it('serializes the request body into the POST payload after confirmation', () => {
    const onSend = vi.fn()
    renderBuilder({
      endpoint: makeEndpoint({
        method: 'POST',
        path: '/alerts/rules',
        requestBody: { contentType: 'application/json', example: { enabled: true } },
      }),
      onSend,
    })

    fireEvent.click(sendButton())
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /yes, send/i }))

    expect(onSend).toHaveBeenCalledWith(
      '/alerts/rules',
      'POST',
      JSON.stringify({ enabled: true }, null, 2),
      {},
    )
  })

  it('resets params, body, and the confirmation gate when the endpoint prop changes', () => {
    const { rerender, container } = renderBuilder({
      endpoint: makeEndpoint({
        method: 'POST',
        path: '/drives/{driveID}',
        parameters: [makeParam({ name: 'driveID', in: 'path', required: true })],
        requestBody: { contentType: 'application/json', example: { a: 1 } },
      }),
    })

    // Fill a path param and open the destructive confirmation.
    fireEvent.change(screen.getByLabelText(/driveID/), { target: { value: '99' } })
    fireEvent.click(sendButton())
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(urlText(container)).toBe('/api/v1/drives/99')

    // Switching to a bare GET clears the alert, the path input, and the body.
    rerender(
      <RequestBuilder
        endpoint={makeEndpoint({ method: 'GET', path: '/vehicles' })}
        onSend={vi.fn()}
        loading={false}
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText(/driveID/)).toBeNull()
    expect(screen.queryByPlaceholderText('{ "key": "value" }')).toBeNull()
    expect(urlText(container)).toBe('/api/v1/vehicles')
  })

  it('disables Send and swaps the label to the localized progress copy while loading', () => {
    renderBuilder({
      endpoint: makeEndpoint({ method: 'GET', path: '/vehicles' }),
      loading: true,
    })

    const btn = screen.getByRole('button', { name: /sending/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('Sending...')
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
  })

  it('exposes associated labels for every input (a11y)', () => {
    renderBuilder({
      endpoint: makeEndpoint({
        method: 'GET',
        path: '/drives/{driveID}',
        parameters: [
          makeParam({ name: 'driveID', in: 'path', required: true }),
          makeParam({ name: 'limit', in: 'query' }),
        ],
      }),
    })

    expect((screen.getByLabelText(/driveID/) as HTMLInputElement).tagName).toBe('INPUT')
    expect((screen.getByLabelText('limit') as HTMLInputElement).tagName).toBe('INPUT')
    const key = screen.getByLabelText('X-API-Key') as HTMLInputElement
    expect(key.tagName).toBe('INPUT')
    expect(key.type).toBe('password')
  })

  it('renders and sends without throwing when the endpoint has no parameters array (null-safety)', () => {
    const onSend = vi.fn()
    // Simulate a malformed/parameter-less endpoint reaching the component.
    const endpoint = makeEndpoint({
      method: 'GET',
      path: '/system/status',
      parameters: undefined as unknown as ParsedParam[],
    })

    expect(() => renderBuilder({ endpoint, onSend })).not.toThrow()
    fireEvent.click(sendButton())
    expect(onSend).toHaveBeenCalledWith('/system/status', 'GET', undefined, {})
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@/i18n';
import RequestBuilder from './RequestBuilder';
import {
  parameterMismatch, parseSpec, schemaMismatch,
  type OpenAPISpec, type PlaygroundEndpoint, type PlaygroundParam,
} from './continuation-admin-1/playgroundSpec';

function endpoint(overrides: Partial<PlaygroundEndpoint> = {}): PlaygroundEndpoint {
  return {
    method: 'GET', path: '/diagnostic/{id}', tag: 'Diagnostic',
    summary: '', description: '', operationId: 'diagnostic', responses: {},
    parameters: [{ name: 'id', in: 'path', required: true, type: 'string', description: '' }],
    ...overrides,
  };
}

function mount(selected = endpoint()) {
  const onSend = vi.fn();
  return { onSend, ...render(<RequestBuilder endpoint={selected} onSend={onSend} loading={false} />) };
}

function preview(container: HTMLElement) {
  return container.querySelector('code')?.textContent;
}

function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }));
}

function description(control: HTMLElement) {
  return (control.getAttribute('aria-describedby') ?? '').split(' ')
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this fixture'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  cleanup();
  vi.unstubAllGlobals();
});

describe('phase6 request value preservation', () => {
  it.each([
    ['a/b', 'a%2Fb'],
    ['7?debug=1', '7%3Fdebug%3D1'],
    ['a#fragment', 'a%23fragment'],
    ['%2F', '%252F'],
    [' space /?#+= ', '%20space%20%2F%3F%23%2B%3D%20'],
    ['日本語🚗', '%E6%97%A5%E6%9C%AC%E8%AA%9E%F0%9F%9A%97'],
    ['$&', '$&'],
    ['$1$$$`$\'', '$1$$$%60$\''],
  ])('preserves %s as one encoded segment without replacement expansion', (value, encoded) => {
    const { container, onSend } = mount(endpoint({ path: '/diagnostic/{id}/state' }));
    fireEvent.change(screen.getByLabelText(/id/), { target: { value } });
    expect(preview(container)).toBe(`/api/v1/diagnostic/${encoded}/state`);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith(`/diagnostic/${encoded}/state`, 'GET', undefined, {});
    expect(decodeURIComponent(encoded)).toBe(value);
  });

  it('replaces repeated template occurrences but never rescans inserted parameter-looking text', () => {
    const { container, onSend } = mount(endpoint({
      path: '/diagnostic/{id}/{other}/{id}',
      parameters: [
        ...endpoint().parameters,
        { name: 'other', in: 'path', required: true, type: 'string', description: '' },
      ],
    }));
    fireEvent.change(screen.getByLabelText(/^id/), { target: { value: '{other}' } });
    fireEvent.change(screen.getByLabelText(/^other/), { target: { value: '$&/?#' } });
    expect(preview(container)).toBe('/api/v1/diagnostic/%7Bother%7D/$&%2F%3F%23/%7Bother%7D');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('/diagnostic/%7Bother%7D/$&%2F%3F%23/%7Bother%7D', 'GET', undefined, {});
  });

  it('retains query defaults, zero, boolean false and query delimiters without changing query names', () => {
    const { container, onSend } = mount(endpoint({
      path: '/diagnostic',
      parameters: [
        { name: 'vehicle_id', in: 'query', required: false, type: 'string', description: '' },
        { name: 'limit', in: 'query', required: false, type: 'integer', description: '', default: '0' },
        { name: 'enabled', in: 'query', required: false, type: 'boolean', description: '', default: 'false' },
      ],
    }));
    fireEvent.change(screen.getByLabelText('vehicle_id'), { target: { value: '$&/?#' } });
    expect(preview(container)).toBe('/api/v1/diagnostic?vehicle_id=%24%26%2F%3F%23&limit=0&enabled=false');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('/diagnostic?vehicle_id=%24%26%2F%3F%23&limit=0&enabled=false', 'GET', undefined, {});
  });

  it('announces missing required fields but preserves intentional blank-path diagnostic sends', () => {
    const { onSend } = mount();
    const input = screen.getByLabelText(/id/);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(description(input)).toContain('Required by the API specification');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('/diagnostic/{id}', 'GET', undefined, {});
  });

  it('exposes numeric bounds and clears associated errors when the edited value satisfies them', () => {
    mount(endpoint({ parameters: [{
      ...endpoint().parameters[0], type: 'integer', default: '2',
      schema: { type: 'integer', minimum: 2, maximum: 4 },
    }] }));
    const input = screen.getByLabelText(/id/);
    expect(description(input)).toContain('"minimum":2');
    fireEvent.change(input, { target: { value: '1' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(description(input)).toContain('minimum=2');
    fireEvent.change(input, { target: { value: '3' } });
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(description(input)).toContain('"maximum":4');
  });

  it('keeps a password key local and trimmed only in the explicit header, not preview or feedback', () => {
    const { container, onSend } = mount();
    const key = screen.getByLabelText('X-API-Key');
    expect(key).toHaveAttribute('type', 'password');
    fireEvent.change(key, { target: { value: '  fixture-key  ' } });
    expect(preview(container)).not.toContain('fixture-key');
    expect(container.textContent).not.toContain('fixture-key');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('/diagnostic/{id}', 'GET', undefined, { 'X-API-Key': 'fixture-key' });
  });
});

describe('phase6 accessible body feedback and raw diagnostics', () => {
  const bodyEndpoint = endpoint({
    method: 'POST', path: '/diagnostic',
    requestBody: {
      contentType: 'application/json', required: true,
      example: { distance_m: 42, enabled: false },
      schema: {
        type: 'object', required: ['distance_m'],
        properties: { distance_m: { type: 'number', minimum: 0 } },
      },
    },
  });

  it('associates the localized visible label, required state and schema hint with the real textarea', () => {
    mount(bodyEndpoint);
    const body = screen.getByRole('textbox', { name: 'Request body required' });
    expect(screen.getByLabelText(/Request body/)).toBe(body);
    expect(body).toBeRequired();
    expect(body).toHaveValue(JSON.stringify({ distance_m: 42, enabled: false }, null, 2));
    expect(description(body)).toContain('"distance_m"');
    expect(screen.getByText('application/json')).toBeInTheDocument();
    expect(screen.getByText(/Validation feedback is advisory/)).toBeInTheDocument();
  });

  it.each(['{', '{"distance_m":-1}', '{}', 'null', 'false', '0'])(
    'keeps the exact invalid diagnostic body %s after explicit confirmation',
    rawBody => {
      const { onSend } = mount(bodyEndpoint);
      const body = screen.getByRole('textbox', { name: 'Request body required' });
      fireEvent.change(body, { target: { value: rawBody } });
      expect(body).toHaveAttribute('aria-invalid', 'true');
      expect(description(body)).not.toBe('');
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      expect(onSend).not.toHaveBeenCalled();
      const alert = screen.getAllByRole('alert').find(item => within(item).queryByRole('button', { name: 'Yes, send' }));
      expect(alert).toBeDefined();
      fireEvent.click(within(alert!).getByRole('button', { name: 'Yes, send' }));
      expect(onSend).toHaveBeenCalledWith('/diagnostic', 'POST', rawBody, {});
    },
  );

  it('clears JSON syntax feedback without converting or rewriting raw SI values and whitespace', () => {
    const { onSend } = mount(bodyEndpoint);
    const body = screen.getByRole('textbox', { name: 'Request body required' });
    fireEvent.change(body, { target: { value: '{' } });
    expect(description(body)).toContain('Invalid JSON');
    const rawBody = ' { "distance_m": 1234.567, "duration_s": 61, "energy_wh": 500, "enabled": false }\n';
    fireEvent.change(body, { target: { value: rawBody } });
    expect(body).not.toHaveAttribute('aria-invalid', 'true');
    confirm();
    expect(onSend).toHaveBeenCalledWith('/diagnostic', 'POST', rawBody, {});
  });

  it('shows required-body feedback while leaving empty negative requests confirmable', () => {
    const { onSend } = mount(bodyEndpoint);
    fireEvent.change(screen.getByRole('textbox', { name: 'Request body required' }), { target: { value: '' } });
    expect(description(screen.getByRole('textbox', { name: 'Request body required' }))).toContain('Required by the API specification');
    confirm();
    expect(onSend).toHaveBeenCalledWith('/diagnostic', 'POST', undefined, {});
  });

  it('does not parse non-JSON diagnostic text or turn an optional empty body into a requirement', () => {
    const { onSend } = mount(endpoint({
      method: 'POST', path: '/diagnostic', parameters: [],
      requestBody: { contentType: 'text/plain', required: false },
    }));
    const body = screen.getByLabelText('Request body');
    fireEvent.change(body, { target: { value: '<raw>not-json</raw>' } });
    expect(body).not.toHaveAttribute('aria-invalid', 'true');
    expect(body).not.toBeRequired();
    confirm();
    expect(onSend).toHaveBeenCalledWith('/diagnostic', 'POST', '<raw>not-json</raw>', {});
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('retains cancellation for %s', method => {
    const { onSend } = mount(endpoint({ method }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Yes, send' })).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('resets request body, defaults and confirmation on endpoint change without resetting the local API key', () => {
    const { rerender, onSend } = mount(bodyEndpoint);
    fireEvent.change(screen.getByLabelText('X-API-Key'), { target: { value: 'fixture-key' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Request body required' }), { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const next = endpoint({ parameters: [{ ...endpoint().parameters[0], default: '7' }] });
    rerender(<RequestBuilder endpoint={next} onSend={onSend} loading={false} />);
    expect(screen.queryByLabelText('Request body')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Yes, send' })).toBeNull();
    expect(screen.getByLabelText(/id/)).toHaveValue('7');
    expect(screen.getByLabelText('X-API-Key')).toHaveValue('fixture-key');
  });

  it('does not dispatch a previously open confirmation after loading becomes true', () => {
    const { rerender, onSend } = mount(bodyEndpoint);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    rerender(<RequestBuilder endpoint={bodyEndpoint} onSend={onSend} loading />);
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send' }));
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('phase6 OpenAPI constraint preservation', () => {
  it('retains local referenced parameters, scalar bounds/enum/defaults, required bodies and body schemas', () => {
    const schema = { type: 'integer', minimum: 0, maximum: 5, enum: [0, 2], default: 0 };
    const spec: OpenAPISpec = {
      components: {
        parameters: { id: { name: 'id', in: 'path', required: true, schema } },
        schemas: { Body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } } },
        requestBodies: { Body: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Body' }, example: false } } } },
      },
      paths: {
        '/diagnostic/{id}': {
          post: {
            parameters: [{ $ref: '#/components/parameters/id' }],
            requestBody: { $ref: '#/components/requestBodies/Body' },
          },
        },
      },
    };
    const [parsed] = parseSpec(spec);
    expect(parsed.parameters[0]).toMatchObject({ required: true, type: 'integer', default: '0', schema });
    expect(parsed.requestBody).toMatchObject({ required: true, example: false, schema: spec.components?.schemas?.Body });
    mount(parsed);
    expect(screen.getByRole('textbox', { name: 'Request body required' })).toHaveValue('false');
  });

  it.each([false, 0, '', null])('preserves explicit falsy JSON example %s rather than replacing it with a schema example', example => {
    const [parsed] = parseSpec({ paths: {
      '/diagnostic': { post: { requestBody: { content: {
        'application/json': { example, schema: { example: { fallback: true } } },
      } } } },
    } });
    expect(parsed.requestBody?.example).toBe(example);
    mount(parsed);
    expect(screen.getByLabelText('Request body')).toHaveValue(JSON.stringify(example, null, 2));
  });

  it('preserves path-level constraints and operation-level overrides without duplicating controls', () => {
    const [parsed] = parseSpec({ paths: {
      '/diagnostic/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }],
        get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 2 } }] },
      },
    } });
    expect(parsed.parameters).toHaveLength(1);
    expect(parsed.parameters[0].schema?.minimum).toBe(2);
  });

  it('retains non-JSON body content-type, schema and requirement metadata', () => {
    const [parsed] = parseSpec({ paths: {
      '/diagnostic': { post: { requestBody: {
        required: true, content: { 'text/plain': { example: 'raw', schema: { type: 'string', minLength: 2 } } },
      } } },
    } });
    expect(parsed.requestBody).toEqual({
      required: true, contentType: 'text/plain', example: 'raw', schema: { type: 'string', minLength: 2 },
    });
  });

  it.each([
    ['1.5', { type: 'integer' }, 'type=integer'],
    ['6', { type: 'number', maximum: 5 }, 'maximum=5'],
    ['1', { type: 'number', minimum: 1, exclusiveMinimum: true }, 'minimum=1'],
    ['false', { type: 'boolean', enum: [true] }, 'enum=[true]'],
    ['a', { type: 'string', minLength: 2 }, 'minLength=2'],
    ['abc', { type: 'string', maxLength: 2 }, 'maxLength=2'],
    ['abc', { type: 'string', pattern: '^\\d+$' }, 'pattern="^\\\\d+$"'],
  ])('provides advisory constraint feedback for %s', (value, schema, mismatch) => {
    const parameter: PlaygroundParam = { ...endpoint().parameters[0], schema };
    expect(parameterMismatch(value, parameter)).toBe(mismatch);
  });

  it('checks direct nested fields and arrays without claiming unsupported schema features are validated', () => {
    expect(schemaMismatch({ values: [-1] }, { type: 'object', properties: {
      values: { type: 'array', items: { type: 'number', minimum: 0 } },
    } })).toBe('values: minimum=0');
    expect(schemaMismatch(false, { oneOf: [{ type: 'string' }] })).toBeUndefined();
    expect(schemaMismatch(null, { type: 'object', nullable: true })).toBeUndefined();
  });
});

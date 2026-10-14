import type { ParsedBody, ParsedEndpoint, ParsedParam } from '../EndpointSidebar';

export interface OpenAPISpec {
  paths?: Record<string, Record<string, unknown>>;
  components?: {
    parameters?: Record<string, Record<string, unknown>>;
    requestBodies?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

export interface PlaygroundParam extends ParsedParam {
  schema?: Record<string, unknown>;
}

export interface PlaygroundBody extends ParsedBody {
  required?: boolean;
}

export interface PlaygroundEndpoint extends ParsedEndpoint {
  parameters: PlaygroundParam[];
  requestBody?: PlaygroundBody;
}

function resolveRef(spec: OpenAPISpec, ref: unknown): Record<string, unknown> | null {
  if (typeof ref !== 'object' || ref === null) return null;
  const obj = ref as Record<string, unknown>;
  const refStr = obj['$ref'];
  if (typeof refStr !== 'string') return obj;
  const parts = refStr.replace('#/', '').split('/');
  let current: unknown = spec;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'object' && current !== null ? current as Record<string, unknown> : null;
}

function parseParameter(spec: OpenAPISpec, raw: unknown): PlaygroundParam | null {
  const resolved = resolveRef(spec, raw);
  if (!resolved) return null;
  const schema = resolveRef(spec, resolved.schema) ?? {};
  return {
    name: String(resolved.name ?? ''),
    in: String(resolved.in ?? 'query') as 'path' | 'query',
    required: Boolean(resolved.required),
    type: String(schema.type ?? 'string'),
    description: String(resolved.description ?? ''),
    default: schema.default != null ? String(schema.default) : undefined,
    schema,
  };
}

function parseRequestBody(spec: OpenAPISpec, raw: unknown): PlaygroundBody | undefined {
  const resolved = resolveRef(spec, raw);
  if (!resolved) return undefined;
  const content = resolved.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) return undefined;
  const jsonContent = content['application/json'];
  if (!jsonContent) {
    const firstKey = Object.keys(content)[0];
    return firstKey ? {
      contentType: firstKey,
      required: Boolean(resolved.required),
      example: content[firstKey].example,
      schema: resolveRef(spec, content[firstKey].schema) ?? undefined,
    } : undefined;
  }
  const schema = resolveRef(spec, jsonContent.schema);
  let example = jsonContent.example;
  if (example === undefined && schema) example = schema.example;
  return {
    contentType: 'application/json',
    example,
    schema: schema ?? undefined,
    required: Boolean(resolved.required),
  };
}

/** Advisory checks only: retain every schema keyword and never prevent diagnostic sends. */
export function schemaMismatch(value: unknown, schema: Record<string, unknown>, depth = 0): string | undefined {
  if (depth > 20 || (value === null && schema.nullable === true)) return undefined;
  const type = schema.type;
  if (type === 'string' && typeof value !== 'string') return 'type=string';
  if (type === 'boolean' && typeof value !== 'boolean') return 'type=boolean';
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return 'type=number';
  if (type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) return 'type=integer';
  if (type === 'object' && (typeof value !== 'object' || value === null || Array.isArray(value))) return 'type=object';
  if (type === 'array' && !Array.isArray(value)) return 'type=array';
  if (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) {
    return `enum=${JSON.stringify(schema.enum)}`;
  }
  if (typeof value === 'number') {
    for (const bound of ['minimum', 'maximum'] as const) {
      const limit = schema[bound];
      const exclusive = schema[bound === 'minimum' ? 'exclusiveMinimum' : 'exclusiveMaximum'] === true;
      if (typeof limit === 'number' && (bound === 'minimum'
        ? value < limit || (exclusive && value === limit)
        : value > limit || (exclusive && value === limit))) return `${bound}=${limit}`;
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return `exclusiveMinimum=${schema.exclusiveMinimum}`;
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return `exclusiveMaximum=${schema.exclusiveMaximum}`;
  }
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) return `minLength=${schema.minLength}`;
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) return `maxLength=${schema.maxLength}`;
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) return `pattern=${JSON.stringify(schema.pattern)}`;
      } catch {
        // An unsupported specification pattern is still shown as schema, not a send ban.
      }
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return `minItems=${schema.minItems}`;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return `maxItems=${schema.maxItems}`;
    if (typeof schema.items === 'object' && schema.items !== null && !Array.isArray(schema.items)) {
      for (const item of value) {
        const mismatch = schemaMismatch(item, schema.items as Record<string, unknown>, depth + 1);
        if (mismatch) return mismatch;
      }
    }
  } else if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      const missing = schema.required.find(key => typeof key === 'string' && !Object.prototype.hasOwnProperty.call(object, key));
      if (missing !== undefined) return `required=${JSON.stringify(missing)}`;
    }
    if (typeof schema.properties === 'object' && schema.properties !== null) {
      for (const [key, property] of Object.entries(schema.properties)) {
        if (!Object.prototype.hasOwnProperty.call(object, key) || typeof property !== 'object' || property === null) continue;
        const mismatch = schemaMismatch(object[key], property as Record<string, unknown>, depth + 1);
        if (mismatch) return `${key}: ${mismatch}`;
      }
    }
  }
  return undefined;
}

export function parameterMismatch(value: string, parameter: PlaygroundParam): string | undefined {
  if (!value) return parameter.required || parameter.in === 'path' ? 'required' : undefined;
  const schema = parameter.schema ?? { type: parameter.type };
  let parsed: unknown = value;
  if (schema.type === 'number' || schema.type === 'integer') {
    parsed = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) ? Number(value) : value;
  } else if (schema.type === 'boolean') {
    parsed = value === 'true' ? true : value === 'false' ? false : value;
  }
  return schemaMismatch(parsed, schema);
}

export function parseSpec(spec: OpenAPISpec): PlaygroundEndpoint[] {
  const endpoints: PlaygroundEndpoint[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const op = operation as Record<string, unknown>;
      const tags = (op.tags as string[]) ?? ['Other'];
      const inheritedParams = Array.isArray(methods.parameters) ? methods.parameters : [];
      const params = [...inheritedParams, ...((op.parameters as unknown[]) ?? [])]
        .map(param => parseParameter(spec, param)).filter((param): param is PlaygroundParam => param !== null);
      const uniqueParams = new Map(params.map(param => [`${param.in}:${param.name}`, param]));
      endpoints.push({
        method: method.toUpperCase() as ParsedEndpoint['method'],
        path,
        tag: tags[0] ?? 'Other',
        summary: String(op.summary ?? ''),
        description: String(op.description ?? ''),
        operationId: String(op.operationId ?? ''),
        parameters: [...uniqueParams.values()],
        requestBody: parseRequestBody(spec, op.requestBody),
        responses: Object.fromEntries(Object.entries((op.responses ?? {}) as Record<string, Record<string, unknown>>)
          .map(([code, response]) => [code, { description: String(resolveRef(spec, response)?.description ?? '') }])),
      });
    }
  }
  const methodWeight: Record<string, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };
  endpoints.sort((a, b) => {
    const tagCmp = a.tag.localeCompare(b.tag);
    if (tagCmp !== 0) return tagCmp;
    const methodCmp = (methodWeight[a.method] ?? 9) - (methodWeight[b.method] ?? 9);
    return methodCmp !== 0 ? methodCmp : a.path.localeCompare(b.path);
  });
  return endpoints;
}

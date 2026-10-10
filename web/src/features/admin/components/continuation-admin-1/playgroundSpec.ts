import type { ParsedBody, ParsedEndpoint, ParsedParam } from '../EndpointSidebar';

export interface OpenAPISpec {
  paths?: Record<string, Record<string, Record<string, unknown>>>;
  components?: {
    parameters?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description?: string }>;
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

function parseParameter(spec: OpenAPISpec, raw: unknown): ParsedParam | null {
  const resolved = resolveRef(spec, raw);
  if (!resolved) return null;
  const schema = (resolved.schema ?? {}) as Record<string, unknown>;
  return {
    name: String(resolved.name ?? ''),
    in: String(resolved.in ?? 'query') as 'path' | 'query',
    required: Boolean(resolved.required),
    type: String(schema.type ?? 'string'),
    description: String(resolved.description ?? ''),
    default: schema.default != null ? String(schema.default) : undefined,
  };
}

function parseRequestBody(spec: OpenAPISpec, raw: unknown): ParsedBody | undefined {
  const resolved = resolveRef(spec, raw);
  if (!resolved) return undefined;
  const content = resolved.content as Record<string, Record<string, unknown>> | undefined;
  if (!content) return undefined;
  const jsonContent = content['application/json'];
  if (!jsonContent) {
    const firstKey = Object.keys(content)[0];
    return firstKey ? { contentType: firstKey } : undefined;
  }
  const schema = resolveRef(spec, jsonContent.schema);
  let example = jsonContent.example;
  if (!example && schema) example = schema.example;
  return {
    contentType: 'application/json',
    example: example ?? undefined,
    schema: schema ?? undefined,
  };
}

export function parseSpec(spec: OpenAPISpec): ParsedEndpoint[] {
  const endpoints: ParsedEndpoint[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const op = operation as Record<string, unknown>;
      const tags = (op.tags as string[]) ?? ['Other'];
      const params = (op.parameters as unknown[]) ?? [];
      endpoints.push({
        method: method.toUpperCase() as ParsedEndpoint['method'],
        path,
        tag: tags[0] ?? 'Other',
        summary: String(op.summary ?? ''),
        description: String(op.description ?? ''),
        operationId: String(op.operationId ?? ''),
        parameters: params.map(param => parseParameter(spec, param)).filter((param): param is ParsedParam => param !== null),
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

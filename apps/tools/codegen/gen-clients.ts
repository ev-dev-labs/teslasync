/**
 * P1/S2/0001 — Typed API client code generator (Kotlin + C#) from the OpenAPI 3.1 contract.
 *
 * SI-aware custom emitter (allowed by the S2 prompt). Deterministic output so the `--check`
 * drift gate is reliable. Generated files carry a `// GENERATED — DO NOT EDIT` header.
 *
 *   tsx gen-clients.ts            # (re)write generated clients
 *   tsx gen-clients.ts --check    # regenerate to temp + diff; non-empty diff => exit 1
 *
 * Out of scope (S4): HTTP execution, auth, retries, SSE. Endpoint descriptors are emitted as
 * plain data for S4 to wire.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const cfg = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'codegen.config.json'), 'utf8'),
);
const HEADER: string = cfg.header;

type Json = any;

interface Field {
  json: string; // snake_case JSON/wire name
  base: 'string' | 'integer' | 'number' | 'boolean' | 'datetime';
  nullable: boolean; // type-union has null OR not required
  required: boolean; // present in `required`
}

interface Model {
  name: string;
  fields: Field[];
}

interface QueryParam {
  name: string;
  required: boolean;
  type: string; // "string" | "integer" | "number" | "boolean" — for S4 formatting
}

interface Endpoint {
  operationId: string;
  method: string; // upper-case HTTP verb
  path: string; // version-prefix stripped for /api/v1 routes
  versioned: boolean;
  pathParams: string[];
  queryParams: QueryParam[];
  requiresAuth: boolean;
  responseType: string; // descriptive label: "Vehicle", "List<Drive>", "JsonElement", "Unit"
}

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

// Deterministic, locale-independent string ordering (reproducible across OS/runtime).
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── Spec parsing ────────────────────────────────────────────────────────────

function baseTypeOf(prop: Json): Field['base'] {
  if (prop.$ref) {
    throw new Error(`unsupported $ref in object property: ${prop.$ref}`);
  }
  const t = prop.type;
  const types = Array.isArray(t) ? t.filter((x: string) => x !== 'null') : [t];
  const primary = types[0];
  if (primary === 'string') return prop.format === 'date-time' ? 'datetime' : 'string';
  if (primary === 'integer') return 'integer';
  if (primary === 'number') return 'number';
  if (primary === 'boolean') return 'boolean';
  // Fail hard on anything we don't model (object/array/enum/oneOf/anyOf/unknown) rather than
  // silently degrading to String and emitting a semantically wrong client.
  throw new Error(
    `unsupported property type ${JSON.stringify(prop.type)} (format=${prop.format ?? 'none'})`,
  );
}

function paramType(schema: Json): string {
  const t = schema?.type;
  const types = Array.isArray(t) ? t.filter((x: string) => x !== 'null') : [t];
  const primary = types[0];
  if (['string', 'integer', 'number', 'boolean'].includes(primary)) return primary;
  return 'string';
}

function isNullUnion(prop: Json): boolean {
  return Array.isArray(prop.type) && prop.type.includes('null');
}

function parseModels(spec: Json): Model[] {
  const schemas = spec.components?.schemas ?? {};
  const models: Model[] = [];
  for (const name of Object.keys(schemas).sort()) {
    const s = schemas[name];
    const required: string[] = s.required ?? [];
    const props = s.properties ?? {};
    const fields: Field[] = Object.keys(props).map((json) => {
      const prop = props[json];
      const isReq = required.includes(json);
      return {
        json,
        base: baseTypeOf(prop),
        nullable: isNullUnion(prop) || !isReq,
        required: isReq,
      };
    });
    // required (no default) first, then optional; alpha within each group → deterministic + valid ctor order.
    fields.sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return cmp(a.json, b.json);
    });
    models.push({ name, fields });
  }
  return models;
}

function responseLabel(op: Json): string {
  const sc = op.responses?.['200']?.content?.['application/json']?.schema;
  if (!sc) return 'Unit';
  if (sc.$ref) return refName(sc.$ref);
  if (sc.type === 'array') {
    const it = sc.items ?? {};
    return it.$ref ? `List<${refName(it.$ref)}>` : 'JsonElement';
  }
  return 'JsonElement';
}

function refName(ref: string): string {
  return ref.split('/').pop() as string;
}

// OpenAPI auth resolution: explicit empty `security: []` or a requirement containing an empty
// object means anonymous access is allowed; a missing operation `security` inherits the global one.
function operationRequiresAuth(op: Json, globalAuth: boolean): boolean {
  if (!('security' in op)) return globalAuth;
  const reqs: Json[] = op.security ?? [];
  if (reqs.length === 0) return false;
  if (reqs.some((r) => r && Object.keys(r).length === 0)) return false;
  return true;
}

function parseEndpoints(spec: Json): Endpoint[] {
  const globalAuth = Array.isArray(spec.security) && spec.security.length > 0;
  const out: Endpoint[] = [];
  for (const rawPath of Object.keys(spec.paths)) {
    const ops = spec.paths[rawPath];
    for (const method of Object.keys(ops)) {
      if (method === 'parameters') continue;
      if (!METHOD_ORDER.includes(method)) continue;
      const op = ops[method];
      // Strip the version prefix only on an exact `/api/v1` segment boundary so the S4 client
      // prepends it exactly once (mirrors the web `request()` client; no double prefix).
      const versioned = rawPath === '/api/v1' || rawPath.startsWith('/api/v1/');
      const path = versioned ? rawPath.slice('/api/v1'.length) || '/' : rawPath;
      const params: Json[] = op.parameters ?? [];
      const pathParams = params
        .filter((p) => p.in === 'path')
        .map((p) => p.name as string)
        .sort(cmp);
      const queryParams: QueryParam[] = params
        .filter((p) => p.in === 'query')
        .map((p) => ({
          name: p.name as string,
          required: !!p.required,
          type: paramType(p.schema ?? {}),
        }))
        .sort((a, b) => cmp(a.name, b.name));
      out.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        versioned,
        pathParams,
        queryParams,
        requiresAuth: operationRequiresAuth(op, globalAuth),
        responseType: responseLabel(op),
      });
    }
  }
  out.sort(
    (a, b) =>
      cmp(a.path, b.path) ||
      METHOD_ORDER.indexOf(a.method.toLowerCase()) -
        METHOD_ORDER.indexOf(b.method.toLowerCase()),
  );
  return out;
}

// ── Name helpers ────────────────────────────────────────────────────────────

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function toPascal(snake: string): string {
  const c = toCamel(snake);
  return c.charAt(0).toUpperCase() + c.slice(1);
}

// ── Kotlin emitter ──────────────────────────────────────────────────────────

const KT_TYPE: Record<Field['base'], string> = {
  string: 'String',
  integer: 'Long',
  number: 'Double',
  boolean: 'Boolean',
  datetime: 'Instant',
};

function ktModel(m: Model): string {
  const usesInstant = m.fields.some((f) => f.base === 'datetime');
  const lines: string[] = [];
  lines.push(`// ${HEADER}`);
  lines.push(`package ${cfg.kotlin.package}`);
  lines.push('');
  lines.push('import kotlinx.serialization.SerialName');
  lines.push('import kotlinx.serialization.Serializable');
  if (usesInstant) lines.push('import kotlin.time.Instant');
  lines.push('');
  lines.push('@Serializable');
  lines.push(`public data class ${m.name}(`);
  m.fields.forEach((f, i) => {
    const kt = KT_TYPE[f.base] + (f.nullable ? '?' : '');
    const def = !f.required ? ' = null' : '';
    const comma = i < m.fields.length - 1 ? ',' : ',';
    lines.push(`    @SerialName("${f.json}") public val ${toCamel(f.json)}: ${kt}${def}${comma}`);
  });
  lines.push(')');
  lines.push('');
  return lines.join('\n');
}

function ktEndpoints(eps: Endpoint[]): string {
  const lines: string[] = [];
  lines.push(`// ${HEADER}`);
  lines.push(`package ${cfg.kotlin.package}`);
  lines.push('');
  lines.push('/** HTTP verbs used by the generated endpoint descriptors. */');
  lines.push('public enum class HttpMethod { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, TRACE }');
  lines.push('');
  lines.push('/** A single query parameter (snake_case wire name + scalar type) declared by an endpoint. */');
  lines.push('@Suppress("unused")');
  lines.push('public data class QueryParam(public val name: String, public val required: Boolean, public val type: String)');
  lines.push('');
  lines.push('/**');
  lines.push(' * Describes one OpenAPI operation. `path` already has the `/api/v1` prefix stripped when');
  lines.push(' * `versioned` is true, so the S4 networking layer prepends the version base exactly once');
  lines.push(' * (mirrors the web `request()` client; no double prefix).');
  lines.push(' */');
  lines.push('public data class EndpointDescriptor(');
  lines.push('    public val operationId: String,');
  lines.push('    public val method: HttpMethod,');
  lines.push('    public val path: String,');
  lines.push('    public val versioned: Boolean,');
  lines.push('    public val pathParams: List<String>,');
  lines.push('    public val queryParams: List<QueryParam>,');
  lines.push('    public val requiresAuth: Boolean,');
  lines.push('    public val responseType: String,');
  lines.push(')');
  lines.push('');
  lines.push('/** Every operation in the OpenAPI contract, in stable (path, method) order. */');
  lines.push('public object ApiEndpoints {');
  lines.push('    public val all: List<EndpointDescriptor> = listOf(');
  for (const e of eps) {
    const pp = e.pathParams.length
      ? 'listOf(' + e.pathParams.map((p) => `"${p}"`).join(', ') + ')'
      : 'emptyList()';
    const qp = e.queryParams.length
      ? 'listOf(' + e.queryParams.map((q) => `QueryParam("${q.name}", ${q.required}, "${q.type}")`).join(', ') + ')'
      : 'emptyList()';
    lines.push(
      `        EndpointDescriptor(${jsStr(e.operationId)}, HttpMethod.${e.method}, ${jsStr(e.path)}, ${e.versioned}, ${pp}, ${qp}, ${e.requiresAuth}, ${jsStr(e.responseType)}),`,
    );
  }
  lines.push('    )');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function jsStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// ── C# emitter ──────────────────────────────────────────────────────────────

const CS_TYPE: Record<Field['base'], string> = {
  string: 'string',
  integer: 'long',
  number: 'double',
  boolean: 'bool',
  datetime: 'System.DateTimeOffset',
};

function csModel(m: Model): string {
  const lines: string[] = [];
  lines.push(`// ${HEADER}`);
  lines.push('#nullable enable');
  lines.push('using System.Text.Json.Serialization;');
  lines.push('');
  lines.push(`namespace ${cfg.csharp.namespace};`);
  lines.push('');
  lines.push(`public sealed record ${m.name}(`);
  m.fields.forEach((f, i) => {
    const cs = CS_TYPE[f.base] + (f.nullable ? '?' : '');
    const def = !f.required ? ' = null' : '';
    const comma = i < m.fields.length - 1 ? ',' : '';
    // C# forbids a member whose identifier equals the enclosing type (CS0542); keep the
    // JSON wire name via JsonPropertyName and disambiguate only the C# identifier.
    let prop = toPascal(f.json);
    if (prop === m.name) prop = `${prop}Value`;
    lines.push(`    [property: JsonPropertyName("${f.json}")] ${cs} ${prop}${def}${comma}`);
  });
  lines.push(');');
  lines.push('');
  return lines.join('\n');
}

function csEndpoints(eps: Endpoint[]): string {
  const lines: string[] = [];
  lines.push(`// ${HEADER}`);
  lines.push('#nullable enable');
  lines.push('using System.Collections.Generic;');
  lines.push('');
  lines.push(`namespace ${cfg.csharp.namespace};`);
  lines.push('');
  lines.push('public enum HttpMethod { Get, Post, Put, Patch, Delete, Head, Options, Trace }');
  lines.push('');
  lines.push('public sealed record QueryParam(string Name, bool Required, string Type);');
  lines.push('');
  lines.push('/// <summary>');
  lines.push('/// Describes one OpenAPI operation. <c>Path</c> already has the <c>/api/v1</c> prefix');
  lines.push('/// stripped when <c>Versioned</c> is true, so the networking layer prepends the version');
  lines.push('/// base exactly once (no double prefix).');
  lines.push('/// </summary>');
  lines.push('public sealed record EndpointDescriptor(');
  lines.push('    string OperationId,');
  lines.push('    HttpMethod Method,');
  lines.push('    string Path,');
  lines.push('    bool Versioned,');
  lines.push('    IReadOnlyList<string> PathParams,');
  lines.push('    IReadOnlyList<QueryParam> QueryParams,');
  lines.push('    bool RequiresAuth,');
  lines.push('    string ResponseType);');
  lines.push('');
  lines.push('public static class ApiEndpoints');
  lines.push('{');
  lines.push('    public static readonly IReadOnlyList<EndpointDescriptor> All = new EndpointDescriptor[]');
  lines.push('    {');
  const csMethod = (m: string) => m.charAt(0) + m.slice(1).toLowerCase();
  for (const e of eps) {
    const pp = e.pathParams.length
      ? 'new[] { ' + e.pathParams.map((p) => `"${p}"`).join(', ') + ' }'
      : 'System.Array.Empty<string>()';
    const qp = e.queryParams.length
      ? 'new[] { ' + e.queryParams.map((q) => `new QueryParam("${q.name}", ${q.required}, "${q.type}")`).join(', ') + ' }'
      : 'System.Array.Empty<QueryParam>()';
    lines.push(
      `        new EndpointDescriptor(${jsStr(e.operationId)}, HttpMethod.${csMethod(e.method)}, ${jsStr(e.path)}, ${e.versioned}, ${pp}, ${qp}, ${e.requiresAuth}, ${jsStr(e.responseType)}),`,
    );
  }
  lines.push('    };');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── File map + IO ───────────────────────────────────────────────────────────

function buildFiles(): Map<string, string> {
  const specPath = path.join(repoRoot, cfg.spec);
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const models = parseModels(spec);
  const endpoints = parseEndpoints(spec);

  const files = new Map<string, string>();
  for (const m of models) {
    files.set(path.posix.join(cfg.kotlin.outDir, `${m.name}.kt`), ktModel(m));
    files.set(path.posix.join(cfg.csharp.outDir, `${m.name}.cs`), csModel(m));
  }
  files.set(path.posix.join(cfg.kotlin.outDir, 'ApiEndpoints.kt'), ktEndpoints(endpoints));
  files.set(path.posix.join(cfg.csharp.outDir, 'ApiEndpoints.cs'), csEndpoints(endpoints));
  return files;
}

function normalize(s: string): string {
  // LF-normalize for stable, OS-independent diffing.
  return s.replace(/\r\n/g, '\n');
}

// Recursively list files under a repo-relative dir, returning posix repo-relative paths.
function walkRel(dir: string): string[] {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkRel(rel));
    else out.push(rel);
  }
  return out;
}

function writeAll(files: Map<string, string>): void {
  // Clean the generated dirs so removals are reflected, then write.
  for (const dir of [cfg.kotlin.outDir, cfg.csharp.outDir]) {
    const abs = path.join(repoRoot, dir);
    fs.rmSync(abs, { recursive: true, force: true });
    fs.mkdirSync(abs, { recursive: true });
  }
  for (const [rel, content] of files) {
    const abs = path.join(repoRoot, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, normalize(content), 'utf8');
  }
}

function check(files: Map<string, string>): number {
  const drift: string[] = [];
  // Missing or mismatched expected files.
  for (const [rel, content] of files) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      drift.push(`MISSING  ${rel}`);
      continue;
    }
    if (normalize(fs.readFileSync(abs, 'utf8')) !== normalize(content)) {
      drift.push(`CHANGED  ${rel}`);
    }
  }
  // Stray generated files not in the expected set (recursive).
  for (const dir of [cfg.kotlin.outDir, cfg.csharp.outDir]) {
    for (const rel of walkRel(dir)) {
      if (!files.has(rel)) drift.push(`EXTRA    ${rel}`);
    }
  }
  if (drift.length) {
    console.error('[DRIFT] generated client is stale vs the OpenAPI spec:');
    for (const d of drift.sort()) console.error('  ' + d);
    console.error('Run: tsx apps/tools/codegen/gen-clients.ts');
    return 1;
  }
  console.log(`[OK] no drift — ${files.size} generated files match the spec.`);
  return 0;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const checkMode = process.argv.includes('--check');
  const files = buildFiles();
  if (checkMode) {
    process.exit(check(files));
  }
  writeAll(files);
  const kt = [...files.keys()].filter((f) => f.endsWith('.kt')).length;
  const cs = [...files.keys()].filter((f) => f.endsWith('.cs')).length;
  console.log(`[GEN] wrote ${kt} Kotlin + ${cs} C# files from ${cfg.spec}.`);
}

main();

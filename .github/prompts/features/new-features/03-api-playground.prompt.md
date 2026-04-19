---
description: "API Playground: in-app interactive API explorer with live request/response testing"
---

# API Playground

## Problem

TeslaSync has 258 API endpoints and an OpenAPI 3.0.3 spec (`docs/public/openapi.yaml`)
but no way for users to explore and test the API from within the app. Users creating
automations, webhooks, or external integrations need to understand the API — currently
they must read docs or guess at endpoints.

An in-app API playground (like Swagger UI or Postman) lets users browse endpoints,
fill in parameters, execute requests, and see live responses — all within the TeslaSync
UI, authenticated with their existing session.

## Current State

```
docs/public/openapi.yaml              — OpenAPI 3.0.3 spec exists ✅ (18+ tag categories)
internal/api/router.go                — 258 endpoints defined
internal/api/apikey_handler.go        — API key management exists ✅
web/src/features/admin/pages/         — Admin pages exist (DevTools, ApiLogs, etc.)
```

No Swagger UI route, no in-app API explorer.

## Task

### Step 1: Create API Playground Page

Create `web/src/features/admin/pages/ApiPlaygroundPage.tsx`:

**Layout:**
```
┌────────────────────────────────────────────────────────────────┐
│  API Playground                                     [API Key ▼]│
├────────────────┬───────────────────────────────────────────────┤
│                │                                               │
│  ENDPOINTS     │  REQUEST                                      │
│                │                                               │
│  ▸ Auth        │  GET  /api/v1/vehicles ─────────── [Send ▶]  │
│  ▸ Vehicles    │                                               │
│    GET /       │  Headers:                                     │
│    GET /{id}   │  ┌──────────────────────────────────┐        │
│    GET /state  │  │ X-API-Key: tsync_abc...          │        │
│  ▸ Drives      │  └──────────────────────────────────┘        │
│  ▸ Charging    │                                               │
│  ▸ Analytics   │  Parameters:                                  │
│  ▸ Commands    │  ┌──────────────────────────────────┐        │
│  ▸ Alerts      │  │ vehicle_id: [1          ]        │        │
│  ▸ Automations │  │ limit:      [50         ]        │        │
│  ▸ Telemetry   │  └──────────────────────────────────┘        │
│  ▸ System      │                                               │
│                │  Body (POST/PUT):                             │
│  [Search... ]  │  ┌──────────────────────────────────┐        │
│                │  │ { "command": "lock" }             │        │
│                │  └──────────────────────────────────┘        │
│                │                                               │
│                ├───────────────────────────────────────────────┤
│                │  RESPONSE                          200 OK     │
│                │  ┌──────────────────────────────────────┐    │
│                │  │ [                                    │    │
│                │  │   {                                  │    │
│                │  │     "id": 1,                         │    │
│                │  │     "vin": "5YJ3E1...",              │    │
│                │  │     "display_name": "Model Y",       │    │
│                │  │     "state": "online"                │    │
│                │  │   }                                  │    │
│                │  │ ]                                    │    │
│                │  └──────────────────────────────────────┘    │
│                │  Duration: 45ms  Size: 1.2 KB               │
└────────────────┴───────────────────────────────────────────────┘
```

### Step 2: Load and Parse OpenAPI Spec

Fetch the OpenAPI spec from the backend at build time or runtime:

```tsx
// Option A: Bundle at build time (simpler, no extra endpoint)
import spec from '../../../../docs/public/openapi.yaml';

// Option B: Fetch at runtime (allows spec updates without rebuild)
const { data: spec } = useQuery({
  queryKey: ['openapi-spec'],
  queryFn: () => fetch('/api/v1/system/openapi').then(r => r.json()),
  staleTime: Infinity,
});
```

If Option B, add an endpoint in `router.go`:
```go
r.Get("/system/openapi", func(w http.ResponseWriter, r *http.Request) {
    http.ServeFile(w, r, "docs/public/openapi.yaml")
})
```

**Parse the spec** into a navigable tree:
```typescript
interface ParsedEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;                    // /vehicles/{vehicleID}/state
  tag: string;                     // "Vehicles"
  summary: string;                 // "Get vehicle state"
  description: string;
  parameters: ParsedParam[];       // path + query params
  requestBody?: ParsedBody;        // for POST/PUT
  responses: Record<string, ParsedResponse>;
}

interface ParsedParam {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  type: string;
  description: string;
  default?: string;
}
```

### Step 3: Endpoint Sidebar

Create `web/src/features/admin/components/EndpointSidebar.tsx`:

- Tree view grouped by tags (Auth, Vehicles, Drives, etc.)
- Collapsible tag sections
- Each endpoint shows: `[METHOD] /path`
- Color-coded methods: GET=green, POST=blue, PUT=amber, DELETE=red
- Search input filters endpoints by path or summary
- Click an endpoint to load it in the request panel

```tsx
function EndpointSidebar({ endpoints, selected, onSelect, search, onSearch }: EndpointSidebarProps) {
  const grouped = useMemo(() => groupBy(
    endpoints.filter(e =>
      !search || e.path.toLowerCase().includes(search) || e.summary.toLowerCase().includes(search)
    ),
    e => e.tag
  ), [endpoints, search]);

  return (
    <div className="w-64 border-r border-white/[0.06] overflow-y-auto">
      <Input
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder={t('playground.search', 'Search endpoints...')}
        className="m-2"
      />
      {Object.entries(grouped).map(([tag, eps]) => (
        <Accordion key={tag} title={tag} defaultOpen={tag === selected?.tag}>
          {eps.map(ep => (
            <button
              key={`${ep.method}-${ep.path}`}
              onClick={() => onSelect(ep)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5',
                selected?.path === ep.path && selected?.method === ep.method && 'bg-white/5'
              )}
            >
              <MethodBadge method={ep.method} />
              <span className="truncate text-white/70">{ep.path}</span>
            </button>
          ))}
        </Accordion>
      ))}
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors = {
    GET: 'bg-green-500/20 text-green-400',
    POST: 'bg-blue-500/20 text-blue-400',
    PUT: 'bg-amber-500/20 text-amber-400',
    DELETE: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-mono font-bold w-12 text-center', colors[method])}>
      {method}
    </span>
  );
}
```

### Step 4: Request Builder Panel

Create `web/src/features/admin/components/RequestBuilder.tsx`:

```tsx
function RequestBuilder({ endpoint, onSend }: RequestBuilderProps) {
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});

  // Pre-fill default values from spec
  useEffect(() => {
    const defaults: Record<string, string> = {};
    endpoint.parameters.forEach(p => {
      if (p.default) defaults[p.name] = p.default;
    });
    setParams(defaults);
    if (endpoint.requestBody) {
      setBody(JSON.stringify(endpoint.requestBody.example ?? {}, null, 2));
    }
  }, [endpoint]);

  // Build the final URL with path and query params
  const buildUrl = () => {
    let url = endpoint.path;
    endpoint.parameters.filter(p => p.in === 'path').forEach(p => {
      url = url.replace(`{${p.name}}`, params[p.name] ?? `{${p.name}}`);
    });
    const queryParams = endpoint.parameters
      .filter(p => p.in === 'query' && params[p.name])
      .map(p => `${p.name}=${encodeURIComponent(params[p.name])}`)
      .join('&');
    return queryParams ? `${url}?${queryParams}` : url;
  };

  return (
    <div className="space-y-4">
      {/* URL bar */}
      <div className="flex gap-2">
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 text-sm text-white/80 font-mono bg-white/5 rounded px-3 py-1.5">
          {buildUrl()}
        </code>
        <Button onClick={() => onSend(buildUrl(), endpoint.method, body, headers)}>
          {t('playground.send', 'Send')} ▶
        </Button>
      </div>

      {/* Description */}
      {endpoint.description && (
        <p className="text-xs text-white/40">{endpoint.description}</p>
      )}

      {/* Parameters */}
      {endpoint.parameters.length > 0 && (
        <GlassPanel className="p-4 space-y-3">
          <h4 className="text-xs font-medium text-white/60">{t('Parameters')}</h4>
          {endpoint.parameters.map(p => (
            <div key={p.name} className="flex items-center gap-3">
              <label className="text-xs text-white/50 w-32 font-mono">
                {p.name} {p.required && <span className="text-red-400">*</span>}
              </label>
              <Input
                value={params[p.name] ?? ''}
                onChange={e => setParams(prev => ({ ...prev, [p.name]: e.target.value }))}
                placeholder={p.description || p.type}
                className="flex-1 text-xs font-mono"
              />
            </div>
          ))}
        </GlassPanel>
      )}

      {/* Request Body */}
      {endpoint.requestBody && (
        <GlassPanel className="p-4">
          <h4 className="text-xs font-medium text-white/60 mb-2">{t('Request Body')}</h4>
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            placeholder='{ "key": "value" }'
          />
        </GlassPanel>
      )}
    </div>
  );
}
```

### Step 5: Response Viewer

Create `web/src/features/admin/components/ResponseViewer.tsx`:

```tsx
interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  duration: number;  // ms
  size: number;      // bytes
}

function ResponseViewer({ response, loading }: { response: ApiResponse | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-64" />;
  if (!response) return <EmptyState message={t('playground.noResponse', 'Send a request to see the response')} />;

  const statusColor = response.status < 300 ? 'text-green-400'
    : response.status < 400 ? 'text-amber-400' : 'text-red-400';

  return (
    <GlassPanel className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className={cn('font-mono text-sm font-bold', statusColor)}>
          {response.status} {response.statusText}
        </span>
        <span className="text-xs text-white/40">
          {response.duration}ms · {formatBytes(response.size)}
        </span>
      </div>
      <pre className="text-xs font-mono text-white/70 overflow-auto max-h-96 bg-black/30 rounded-lg p-3">
        {typeof response.body === 'string'
          ? response.body
          : JSON.stringify(response.body, null, 2)}
      </pre>
    </GlassPanel>
  );
}
```

### Step 6: Request Execution

```tsx
async function executeRequest(url: string, method: string, body?: string, headers?: Record<string, string>) {
  const start = performance.now();

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = body;
  }

  // Use the app's API base + /api/v1 prefix
  const fullUrl = `${getApiBase()}/api/v1${url}`;

  const resp = await fetch(fullUrl, options);
  const duration = Math.round(performance.now() - start);
  const text = await resp.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: Object.fromEntries(resp.headers.entries()),
    body: parsed,
    duration,
    size: new Blob([text]).size,
  };
}
```

**Important:** Requests go through the same auth as the rest of the app (cookies/ForwardAuth),
so users can test endpoints with their existing session. For API key testing, add an
optional "X-API-Key" header input.

### Step 7: Request History

Store the last 20 requests in sessionStorage:

```typescript
interface HistoryEntry {
  method: string;
  path: string;
  status: number;
  duration: number;
  timestamp: string;
}

// Show as a small timeline under the response viewer
function RequestHistory({ history, onReplay }: { history: HistoryEntry[]; onReplay: (e: HistoryEntry) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto py-2">
      {history.map((h, i) => (
        <button
          key={i}
          onClick={() => onReplay(h)}
          className="flex-shrink-0 px-2 py-1 rounded text-[10px] font-mono bg-white/5 hover:bg-white/10"
        >
          <MethodBadge method={h.method} />
          <span className="text-white/50 ml-1">{h.path.slice(0, 20)}</span>
          <span className={cn('ml-1', h.status < 300 ? 'text-green-400' : 'text-red-400')}>
            {h.status}
          </span>
        </button>
      ))}
    </div>
  );
}
```

### Step 8: Add Route and Navigation

```tsx
const ApiPlaygroundPage = lazy(() => import('./features/admin/pages/ApiPlaygroundPage'));
// Route: /admin/api-playground or /api-playground
```

Add to sidebar under SYSTEM section:
- Icon: `Terminal` from lucide-react
- Label: "API Playground"

### Step 9: Code Generation Snippets

Add a "Copy as..." button that generates code snippets for the current request:

```typescript
function generateSnippet(method: string, url: string, body?: string, format: string): string {
  switch (format) {
    case 'curl':
      return `curl -X ${method} '${url}'${body ? ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${body}'` : ''}`;
    case 'javascript':
      return `const response = await fetch('${url}', {\n  method: '${method}',${body ? `\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify(${body})` : ''}\n});\nconst data = await response.json();`;
    case 'python':
      return `import requests\n\nresponse = requests.${method.toLowerCase()}('${url}'${body ? `, json=${body}` : ''})\ndata = response.json()`;
    case 'go':
      return `resp, err := http.${method === 'GET' ? 'Get' : 'Post'}("${url}"${body ? `, "application/json", strings.NewReader(\`${body}\`)` : ''})\ndefer resp.Body.Close()`;
  }
}
```

Show as a dropdown: "Copy as cURL | JavaScript | Python | Go"

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Endpoint sidebar shows all 258 routes grouped by tag
- [ ] Search filters endpoints by path and summary
- [ ] Clicking an endpoint loads its parameters in the request builder
- [ ] Path parameters are substituted in the URL preview
- [ ] Send button executes the request and shows the response
- [ ] Status code is color-coded (green/amber/red)
- [ ] Duration and response size displayed
- [ ] JSON response is pretty-printed
- [ ] Request history shows last 20 requests
- [ ] Code snippets generate correctly for curl/JS/Python/Go
- [ ] POST/PUT requests include request body
- [ ] Works without API key (uses session auth)

## Commit

```bash
git add -A
git commit -m "feat(web): add in-app API Playground for interactive endpoint testing

- Parse OpenAPI 3.0.3 spec into navigable endpoint tree
- Create endpoint sidebar with search and tag grouping
- Build request builder with parameter inputs and body editor
- Add response viewer with syntax highlighting and metrics
- Store request history in sessionStorage (last 20)
- Generate code snippets in cURL, JavaScript, Python, Go
- Add route /admin/api-playground with sidebar link"
```

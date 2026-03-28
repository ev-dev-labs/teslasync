---
applyTo: "web/**"
---

# React Frontend Instructions

## Tech Stack

- **React 18** with functional components and hooks only
- **TypeScript 5.4** in strict mode — all props, state, and returns typed
- **Vite 5** for dev server and production builds (`tsc && vite build`)
- **Tailwind CSS 3.4** with custom glassmorphism design system
- **TanStack Query v5** for server state management and caching
- **react-router-dom v6** for client-side routing

## Project Structure

```
web/
  src/
    api.ts           # Centralized API client — all backend calls
    App.tsx          # Root component with router + providers
    pages/           # Route-level components (code-split with React.lazy)
    components/      # Shared UI components
    hooks/           # Custom React hooks
    types/           # TypeScript type definitions
  public/            # Static assets, PWA icons, manifest
  index.html         # SPA entry point
  vite.config.ts     # Vite configuration
  tailwind.config.js # Tailwind theme customization
  tsconfig.json      # TypeScript config (strict mode)
```

## API Client Pattern

All backend calls go through `web/src/api.ts`:

```typescript
// Resilient fetch wrapper with automatic retry
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  return resilientFetch<T>(path, options)
}

// Typed endpoint functions
export const getVehicles = () => request<Vehicle[]>('/vehicles')
export const getVehicle = (id: number) => request<Vehicle>(`/vehicles/${id}`)
export const sendCommand = (vehicleId: number, command: string, params?: Record<string, unknown>) =>
  request<CommandResult>(`/vehicles/${vehicleId}/command`, { method: 'POST', body: JSON.stringify({ command, ...params }) })
```

- API base path is `/api/v1/` (prepended by the fetch wrapper)
- All functions return typed promises
- Use `URLSearchParams` for query parameters
- POST/PUT bodies use `JSON.stringify()`

## Design System

### Glassmorphism Theme
- Frosted glass panels with `backdrop-blur` and semi-transparent backgrounds
- Neon accent colors that glow on hover/focus
- Smooth transitions and animations via Framer Motion
- Dark-first design — all 5 themes are dark mode

### 5 Color Themes
Themes are swapped via CSS custom properties on the root element:
1. **Neon Cyan** (default) — cyan/teal accents
2. **Tesla Red** — red accents
3. **Matrix Green** — green accents
4. **Royal Purple** — purple accents
5. **Solar Amber** — amber/orange accents

Each theme has 4 display modes configurable in settings.

## Component Conventions

- **Functional components only** — no class components
- **Code-splitting:** All page components wrapped in `React.lazy()` for route-level splitting
- **Error boundaries:** Wrap major sections for graceful error recovery
- **Loading states:** Use animated car SVG component for loading indicators
- **Icons:** `lucide-react` for all icons — import individually to minimize bundle
- **Classnames:** Use `clsx()` for conditional class composition
- **Dates:** `date-fns` for all date formatting and manipulation

## Key Libraries

| Library | Usage |
|---------|-------|
| `@tanstack/react-query` | Server state, caching, refetching |
| `recharts` | Charts and data visualization |
| `react-leaflet` + `leaflet` | GPS map visualization |
| `framer-motion` | Page transitions, component animations |
| `i18next` + `react-i18next` | Internationalization |
| `lucide-react` | SVG icons |
| `clsx` | Conditional CSS classes |
| `date-fns` | Date utilities |
| `idb` | IndexedDB for offline persistence |

## TypeScript Conventions

- All API response types defined matching Go struct JSON tags (snake_case):
  ```typescript
  export interface Vehicle {
    id: number
    vehicle_id: number
    vin: string
    display_name: string
    state: string      // "online" | "asleep" | "offline"
    created_at: string // ISO 8601
  }
  ```
- Nullable Go pointers (`*float64`) map to `number | null`
- Use `Record<string, unknown>` for dynamic objects, not `any`
- Prefer interfaces over type aliases for object shapes

## PWA

- Service worker via `vite-plugin-pwa`
- Custom splash screen and app icons in `public/`
- Installable as native app on mobile and desktop
- Command palette: `Cmd+K` / `Ctrl+K` for instant navigation

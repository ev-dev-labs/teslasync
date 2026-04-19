---
description: "Handle auth middleware (Authentik/ForwardAuth) session expiry with automatic redirect to login"
---

# Auth Session Expiry Redirect

## Problem

When using an auth middleware like Authentik (ForwardAuth), sessions expire after a
configured period (e.g. 24 hours). After expiry:

1. **Regular browser:** Navigating to any page returns a 302 redirect from the reverse
   proxy to the Authentik login page. This works for full page navigations but **NOT**
   for AJAX/fetch API calls — those silently fail with an opaque redirect or CORS error.

2. **PWA (standalone mode):** Even worse — there's no browser address bar, so a redirect
   to Authentik's login page breaks the app entirely. The user sees a white screen or
   an error with no way to re-authenticate.

3. **Current behavior in TeslaSync:** The `resilientFetch` function in `web/src/lib/resilience.ts`
   handles 401 by calling `/api/v1/auth/refresh` (Tesla token refresh), which is unrelated
   to the auth middleware session. The Authentik session expiry is never detected.

**Authentik is optional.** Many users don't use any auth middleware. The fix must be
non-breaking for users without auth middleware.

## Current State

```
web/src/lib/resilience.ts:84-94     — 401 handler tries Tesla token refresh only
web/src/lib/resilience.ts:174-186   — error handling for non-OK responses
web/nginx.conf                       — no auth-related config
helm/teslasync/templates/configmap-nginx.yaml — no auth snippet handling
internal/api/authentik_middleware.go  — backend Authentik JWT validation
```

### The Auth Flow (When Authentik Is Configured)
```
Browser → Traefik/Nginx Ingress → ForwardAuth middleware → Authentik
                                         ↓ (if valid session)
                                    teslasync-web (Nginx)
                                         ↓ (/api/* proxy)
                                    teslasync-api (:8080)
```

When the Authentik session expires:
- Full page navigations → 302 redirect to Authentik login → works ✅
- AJAX fetch (`/api/v1/*`) → 302 or 401 → `resilientFetch` gets confused → shows
  "Session expired. Please reconnect Tesla." which is wrong ❌
- PWA fetch → same as above, but no way to redirect ❌

## Task

### Step 1: Detect Auth Middleware Redirect in resilientFetch

In `web/src/lib/resilience.ts`, add detection for auth middleware session expiry.

When a reverse proxy's ForwardAuth returns 401 or redirects to a login page,
the fetch response will have one of these characteristics:
- **Status 401** with no JSON body (auth middleware 401, not our API 401)
- **Status 0** with CORS error (redirect to external auth domain blocked by CORS)
- **Redirect response** (3xx) that fetch follows to an HTML login page

Add a check BEFORE the existing 401 Tesla token refresh logic:

```typescript
// In resilientFetch, after res = await fetch(...)

// Detect auth middleware session expiry.
// When a ForwardAuth proxy (Authentik, Authelia, etc.) rejects the request,
// the response is either:
// 1. A redirect to an HTML login page (content-type: text/html on an /api/ request)
// 2. A 401 with no JSON body
// 3. A CORS error (status 0) when redirected to external auth domain
const contentType = res.headers.get('content-type') ?? '';
const isApiPath = url.includes('/api/');

if (isApiPath && res.ok && contentType.includes('text/html')) {
  // We asked for JSON from /api/ but got HTML — this is a login page redirect
  handleAuthExpired();
  throw new ApiError('Authentication session expired', 401);
}

if (res.status === 401 && !contentType.includes('application/json')) {
  // 401 from auth middleware (not our API — our API always returns JSON)
  handleAuthExpired();
  throw new ApiError('Authentication session expired', 401);
}
```

### Step 2: Create handleAuthExpired Function

```typescript
let _authExpiredHandled = false;

function handleAuthExpired() {
  // Only handle once — avoid multiple redirect loops
  if (_authExpiredHandled) return;
  _authExpiredHandled = true;

  // Store the current URL so we can return after login
  const returnUrl = window.location.href;
  sessionStorage.setItem('teslasync-return-url', returnUrl);

  // In PWA standalone mode, we need to open the login in a real browser
  // because the PWA can't handle external auth flows
  const isPWA = window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as any).standalone === true;

  if (isPWA) {
    // Show a user-friendly message and "Re-authenticate" button
    // instead of silently redirecting
    document.dispatchEvent(new CustomEvent('teslasync:auth-expired', {
      detail: { returnUrl, isPWA }
    }));
  } else {
    // Regular browser — reload the page, which will trigger the
    // ForwardAuth redirect to the login page
    window.location.reload();
  }
}
```

### Step 3: Create Auth Expired UI Overlay

Create `web/src/components/feedback/AuthExpiredOverlay.tsx`:

A full-screen overlay that appears when auth expires in PWA mode:

```tsx
export function AuthExpiredOverlay() {
  const [show, setShow] = useState(false);
  const [returnUrl, setReturnUrl] = useState('');
  const { t } = useTranslation();

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setShow(true);
      setReturnUrl(e.detail.returnUrl);
    };
    document.addEventListener('teslasync:auth-expired', handler as EventListener);
    return () => document.removeEventListener('teslasync:auth-expired', handler as EventListener);
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6">
      <GlassPanel className="p-8 max-w-sm text-center space-y-4">
        <Lock className="h-12 w-12 text-neon-amber mx-auto" />
        <h2 className="text-lg font-semibold text-white/90">
          {t('auth.expired.title', 'Session Expired')}
        </h2>
        <p className="text-sm text-white/60">
          {t('auth.expired.message', 'Your authentication session has expired. Please sign in again to continue.')}
        </p>
        <Button
          onClick={() => window.location.reload()}
          className="w-full"
        >
          {t('auth.expired.signIn', 'Sign In Again')}
        </Button>
      </GlassPanel>
    </div>
  );
}
```

Mount in `App.tsx` or `Layout.tsx`:
```tsx
<AuthExpiredOverlay />
```

### Step 4: Return to Original Page After Login

In `App.tsx` or the root layout, on mount check for a stored return URL:

```typescript
useEffect(() => {
  const returnUrl = sessionStorage.getItem('teslasync-return-url');
  if (returnUrl) {
    sessionStorage.removeItem('teslasync-return-url');
    const url = new URL(returnUrl);
    // Only navigate if it's the same origin (security)
    if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
      navigate(url.pathname + url.search + url.hash);
    }
  }
}, []);
```

### Step 5: Handle CORS-Blocked Redirects

When ForwardAuth redirects to `auth.example.com` but the fetch was to `/api/v1/*`,
the browser blocks the cross-origin redirect and the fetch fails with a TypeError
(network error, status 0).

In the catch block of `resilientFetch`:

```typescript
} catch (err) {
  if (err instanceof ApiError) throw err;

  // Network error on an API call might be a CORS-blocked auth redirect
  if (err instanceof TypeError && isApiPath) {
    // Try a simple HEAD to /api/v1/system/version to confirm
    try {
      const probe = await fetch(`${base}/api/v1/system/version`, { method: 'HEAD' });
      if (!probe.ok || probe.headers.get('content-type')?.includes('text/html')) {
        handleAuthExpired();
        throw new ApiError('Authentication session expired', 401);
      }
    } catch {
      // Probe also failed — likely auth middleware redirect
      handleAuthExpired();
      throw new ApiError('Authentication session expired', 401);
    }
  }
  // ... existing error handling
}
```

### Step 6: Non-Breaking for Users Without Auth Middleware

All detection is **passive** — it only triggers when:
1. An `/api/` call returns HTML instead of JSON (never happens without auth middleware)
2. A 401 has no JSON body (our API always returns JSON on 401)
3. A CORS error occurs on an API call (doesn't happen without external auth)

Users without auth middleware will never hit these code paths. No configuration needed.

## Verification

```bash
cd web && npx tsc --noEmit
```

### Test Scenarios
- [ ] **No auth middleware:** App works exactly as before, no regressions
- [ ] **Authentik (browser):** After session expires, next API call triggers page reload → redirect to login
- [ ] **Authentik (PWA):** After session expires, overlay appears with "Sign In Again" button
- [ ] **Return URL:** After re-authenticating, user returns to the page they were on
- [ ] **No redirect loop:** Multiple expired API calls only trigger one reload
- [ ] **Probe request:** CORS-blocked redirects are detected via HEAD probe

## Commit

```bash
git add -A
git commit -m "fix(web): detect auth middleware session expiry and redirect to login

- Detect ForwardAuth 401/redirect in resilientFetch (HTML on API path)
- Handle CORS-blocked redirects via probe request
- Create AuthExpiredOverlay for PWA standalone mode
- Store return URL in sessionStorage for post-login redirect
- Non-breaking for users without auth middleware"
```

## What NOT To Change

- Do not add Authentik-specific configuration — detection must be generic
  (works with Authentik, Authelia, Keycloak, any ForwardAuth setup)
- Do not remove the existing Tesla token refresh on 401 — that handles a
  different auth flow (Tesla API tokens, not session middleware)
- Do not add login/logout routes — authentication is handled entirely by
  the external middleware, not by TeslaSync

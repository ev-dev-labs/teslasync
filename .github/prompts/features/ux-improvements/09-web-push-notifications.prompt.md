---
description: "Add browser push notifications for charge complete, drive end, and alert triggers"
---

# Web Push Notifications

## Problem

Notifications currently only go through external channels (Discord, Slack, Telegram,
Email, Webhook, ntfy, Pushover). Users who have the app open in a browser tab don't
get notified when their car finishes charging, completes a drive, or triggers an alert.

The PWA infrastructure is already in place (service worker via vite-plugin-pwa,
manifest configured). Web Push just needs to be wired in.

## Current State

```
web/vite.config.ts — vite-plugin-pwa configured, service worker auto-generated
web/vite.config.ts:50-85 — workbox config, blocks /api and /ws from caching
internal/notification/ — 7-channel dispatcher (Discord, Slack, etc.)
internal/api/router.go — SSE endpoint exists for real-time events
```

## Task

### Step 1: Add Notification Permission Request

Create `web/src/hooks/useWebPush.ts`:

```typescript
export function useWebPush() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'denied';
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const sendNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (permission !== 'granted') return;
    new Notification(title, {
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      ...options,
    });
  }, [permission]);

  return { permission, requestPermission, sendNotification };
}
```

**Note:** This uses the basic Notification API (not Push API with VAPID keys).
It works when the app tab is open (which covers the main use case). Full Push API
with background delivery would be a separate, larger effort requiring backend
VAPID key management.

### Step 2: Add Permission Request UI

In the Settings page (Notification section), add a toggle:

```tsx
<FormSection title={t('settings.browserNotifications', 'Browser Notifications')}>
  {permission === 'default' && (
    <Button onClick={requestPermission}>
      {t('settings.enableBrowserNotifications', 'Enable Browser Notifications')}
    </Button>
  )}
  {permission === 'granted' && (
    <Badge variant="success">{t('settings.notificationsEnabled', 'Enabled')}</Badge>
  )}
  {permission === 'denied' && (
    <span className="text-xs text-white/40">
      {t('settings.notificationsBlocked', 'Notifications are blocked. Enable in browser settings.')}
    </span>
  )}
</FormSection>
```

### Step 3: Subscribe to SSE Events

The backend already has an SSE (Server-Sent Events) endpoint for real-time events.
Create a listener that triggers browser notifications:

Create `web/src/hooks/useNotificationListener.ts`:

```typescript
export function useNotificationListener() {
  const { permission, sendNotification } = useWebPush();

  // Listen to SSE events and trigger browser notifications
  useEffect(() => {
    if (permission !== 'granted') return;

    const eventSource = new EventSource('/api/v1/events');

    eventSource.addEventListener('charge_complete', (e) => {
      const data = JSON.parse(e.data);
      sendNotification('Charge Complete', {
        body: `${data.vehicle_name} charged to ${data.battery_level}% (${data.range} mi)`,
        tag: `charge-${data.vehicle_id}`,
      });
    });

    eventSource.addEventListener('drive_end', (e) => {
      const data = JSON.parse(e.data);
      sendNotification('Drive Complete', {
        body: `${data.vehicle_name} — ${data.distance} mi in ${data.duration}`,
        tag: `drive-${data.vehicle_id}`,
      });
    });

    eventSource.addEventListener('alert', (e) => {
      const data = JSON.parse(e.data);
      sendNotification(`Alert: ${data.title}`, {
        body: data.message,
        tag: `alert-${data.id}`,
      });
    });

    return () => eventSource.close();
  }, [permission, sendNotification]);
}
```

### Step 4: Mount Notification Listener

In `Layout.tsx` or `App.tsx`, mount the listener globally:

```tsx
function App() {
  useNotificationListener(); // fires browser notifications from SSE
  return <RouterProvider ... />;
}
```

### Step 5: Notification Preferences

Add settings for which events trigger browser notifications. Store in localStorage:

```typescript
interface WebPushPreferences {
  chargeComplete: boolean;   // default: true
  driveEnd: boolean;         // default: true
  alerts: boolean;           // default: true
  automations: boolean;      // default: false
}
```

Add toggles in the Settings page notification section.

### Step 6: Verify SSE Events Exist

Check that the backend SSE endpoint emits `charge_complete`, `drive_end`, and `alert`
event types. If these specific event types don't exist in the SSE handler, document
what events ARE available and subscribe to those instead. Adjust event names in the
listener to match the actual backend event types.

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Permission request shows browser dialog
- [ ] After granting, Settings shows "Enabled" badge
- [ ] Charge complete event triggers browser notification
- [ ] Drive end event triggers browser notification
- [ ] Alert event triggers browser notification
- [ ] Notification has TeslaSync icon
- [ ] Clicking notification focuses the app tab
- [ ] Notifications respect per-event preferences

## Commit

```bash
git add -A
git commit -m "feat(web): add browser push notifications for vehicle events

- Create useWebPush hook for Notification API
- Create useNotificationListener for SSE event subscriptions
- Add permission request UI in Settings
- Support charge_complete, drive_end, and alert notifications
- Add per-event notification preferences in localStorage"
```

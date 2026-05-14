/**
 * LegacyNotificationsRedirect — Smart query-aware redirect from the legacy
 * `/notifications?tab=…` route to the new top-level Notifications routes.
 * Forwards remaining search params so filter/search state survives.
 *
 *   /notifications                → /notifications/inbox
 *   /notifications?tab=inbox      → /notifications/inbox
 *   /notifications?tab=archived   → /notifications/archived
 *   /notifications?tab=channels   → /notifications/channels
 */

import { Navigate, useLocation } from 'react-router-dom';

const TAB_TO_ROUTE: Record<string, string> = {
  inbox: '/notifications/inbox',
  archived: '/notifications/archived',
  channels: '/notifications/channels',
};

export default function LegacyNotificationsRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab') ?? 'inbox';
  params.delete('tab');
  const target = TAB_TO_ROUTE[tab] ?? '/notifications/inbox';
  const qs = params.toString();
  const to = qs ? `${target}?${qs}` : target;
  return <Navigate to={to} replace />;
}

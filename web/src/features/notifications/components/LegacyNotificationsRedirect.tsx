/**
 * LegacyNotificationsRedirect — Smart query-aware redirect from the legacy
 * `/notifications?tab=…` route to the new top-level Notifications routes.
 * Forwards remaining search params (and any hash fragment) so filter/search
 * state and in-page deep links survive.
 *   /notifications                → /notifications/inbox
 *   /notifications?tab=inbox      → /notifications/inbox
 *   /notifications?tab=archived   → /notifications/archived
 *   /notifications?tab=channels   → /notifications/channels
 * Unknown / empty tabs fall back to the inbox.
 */

import { Navigate, useLocation } from 'react-router-dom';

const DEFAULT_ROUTE = '/notifications/inbox';

const TAB_TO_ROUTE: Record<string, string> = {
  inbox: '/notifications/inbox',
  archived: '/notifications/archived',
  channels: '/notifications/channels',
};

export default function LegacyNotificationsRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab') ?? 'inbox';
  // The tab is now encoded in the path, so strip it from the forwarded query.
  params.delete('tab');
  const target = TAB_TO_ROUTE[tab] ?? DEFAULT_ROUTE;
  const qs = params.toString();
  // Preserve any hash fragment so in-page deep links (#slack, #top, …) survive.
  const hash = location.hash ?? '';
  const to = `${target}${qs ? `?${qs}` : ''}${hash}`;
  return <Navigate to={to} replace />;
}

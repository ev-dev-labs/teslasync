/**
 * Global screen-reader announcer.
 *
 * Single shared live-region API for firing imperative SR
 * announcements from anywhere in the app — bulk action completed,
 * filter applied, saved view applied, etc. Without a shared region,
 * each call-site has to render its own `<span aria-live>` and mutate
 * it via state, which devs invariably get wrong (forgetting one of
 * `role` / `aria-live` / `aria-atomic`, or rendering the region
 * inside a conditional that unmounts before the AT can read it).
 *
 * Mechanism
 * ---------
 * The `<AnnouncerRegion>` component (see
 * `web/src/components/a11y/AnnouncerRegion.tsx`) is mounted once per
 * app — in `Layout.tsx`. It renders two visually-hidden live regions
 * (one polite, one assertive) and subscribes to this module's
 * subscriber list. Calls to `announce(...)` push a message into every
 * subscribed region's local state, which re-renders with the new
 * text content and the AT picks it up.
 *
 * Notes
 * -----
 * - Duplicate messages are de-duped by appending a small zero-width
 *   space suffix that rotates per call. Without this, screen readers
 *   skip identical consecutive announcements ("Selection cleared" →
 *   user re-runs the same action → no announcement second time).
 * - This module is SAFE to call before `<AnnouncerRegion>` mounts:
 *   announcements made before the region exists are simply dropped
 *   (no listeners). That mirrors the AT behaviour anyway — without a
 *   live region the message can't be voiced.
 * - The hook returns a stable object so it's safe in dependency
 *   arrays.
 */

import { useMemo } from 'react';

/** Live-region urgency. */
export type AnnouncerPriority = 'polite' | 'assertive';

/** Listener callback signature — one per mounted live region. */
export type AnnouncerListener = (
  message: string,
  priority: AnnouncerPriority,
) => void;

const listeners = new Set<AnnouncerListener>();

/**
 * Counter used to suffix announcements with a rotating zero-width
 * space so screen readers re-read identical consecutive messages.
 * Module-level so the suffix progression is shared across every
 * call-site.
 */
let announceCounter = 0;

/**
 * Fire a screen-reader announcement on the global live region.
 *
 * Safe to call from event handlers, mutation callbacks, useEffect,
 * etc. No-ops silently when no `<AnnouncerRegion>` is mounted (e.g.
 * inside a component test that renders the call-site in isolation
 * without the surrounding `Layout`).
 *
 * @param message - The text to announce. Empty strings are skipped.
 * @param priority - `polite` (default) waits for the AT to finish
 *   its current activity; `assertive` interrupts. Reserve assertive
 *   for genuine errors and security-sensitive messages.
 */
export function announce(
  message: string,
  priority: AnnouncerPriority = 'polite',
): void {
  if (!message) return;
  announceCounter += 1;
  // Trailing zero-width spaces force a fresh string for AT
  // re-announcement of duplicate messages. The mod-4 keeps the
  // suffix bounded so the message length never grows unbounded.
  const padding = '\u200B'.repeat(announceCounter % 4);
  const padded = `${message}${padding}`;
  for (const listener of listeners) {
    listener(padded, priority);
  }
}

/**
 * Subscribe a live region to the announcer. Used by
 * `<AnnouncerRegion>` — call-sites should NOT subscribe directly;
 * use `useAnnouncer()` to fire announcements instead.
 *
 * @returns An unsubscribe function. Call it on unmount.
 */
export function subscribeAnnouncer(listener: AnnouncerListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hook returning a stable object with the `announce` function so it
 * can safely live in dependency arrays. Equivalent to importing
 * `announce` directly, but the hook form makes intent at the
 * call-site clearer ("this component fires SR announcements").
 *
 * @example
 *   const { announce } = useAnnouncer();
 *   announce(t('bulk.archived', '{{count}} items archived', { count }));
 */
export function useAnnouncer() {
  return useMemo(() => ({ announce }), []);
}

/**
 * Test-only helper. Resets the listener set and announcement counter
 * so each test starts from a clean slate. Not exported from any
 * barrel — import directly from `@/hooks/useAnnouncer`.
 */
export function __resetAnnouncerForTests(): void {
  listeners.clear();
  announceCounter = 0;
}

/**
 * Test-only helper. Inspect the currently-subscribed listener count
 * to assert mount/unmount behaviour. Not exported from any barrel.
 */
export function __getAnnouncerListenerCountForTests(): number {
  return listeners.size;
}

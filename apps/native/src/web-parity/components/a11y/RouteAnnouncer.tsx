import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  type AccessibilityRole,
} from 'react-native';

/** Default delay before reading the route title after a route change. */
const DEFAULT_ANNOUNCE_DELAY_MS = 100;

export const nativeRouteAnnouncerCapabilities = {
  reactRouterLocationAvailable: false,
  documentTitleAvailable: false,
  nativeTitlePropsSupported: true,
} as const;

export interface RouteAnnouncerProps {
  /**
   * Override the read delay. Used by tests to drive the timer with fake timers.
   * Production should leave the default.
   */
  delayMs?: number;
  /**
   * Native-safe replacement for React Router's pathname. Pass the current route
   * key/path from the native navigation shell so announcements fire on changes.
   */
  pathname?: string;
  /**
   * Native-safe replacement for document.title. Empty values intentionally clear
   * the hidden region instead of repeating a stale announcement.
   */
  title?: string;
}

const routeAnnouncerRole: AccessibilityRole = 'text';

export function RouteAnnouncer({
  delayMs = DEFAULT_ANNOUNCE_DELAY_MS,
  pathname,
  title,
}: RouteAnnouncerProps = {}) {
  const [message, setMessage] = useState('');
  const firstRender = useRef(true);
  const counter = useRef(0);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }

    const id = setTimeout(() => {
      const routeTitle = title ?? '';
      if (!routeTitle) {
        setMessage('');
        return;
      }

      counter.current = (counter.current + 1) % 4;
      const padding = '\u200B'.repeat(counter.current);
      const nextMessage = `${routeTitle}${padding}`;
      setMessage(nextMessage);
      AccessibilityInfo.announceForAccessibility(nextMessage);
    }, delayMs);

    return () => clearTimeout(id);
  }, [pathname, title, delayMs]);

  return (
    <Text
      accessible
      accessibilityElementsHidden={false}
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
      accessibilityRole={routeAnnouncerRole}
      importantForAccessibility="yes"
      maxFontSizeMultiplier={1}
      style={styles.liveRegion}
      testID="route-announcer">
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  liveRegion: {
    height: 1,
    left: 0,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    top: 0,
    width: 1,
  },
});

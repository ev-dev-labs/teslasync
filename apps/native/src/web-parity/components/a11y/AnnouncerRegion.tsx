import React, {useEffect, useState} from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  type AccessibilityRole,
} from 'react-native';

export type AnnouncerPriority = 'polite' | 'assertive';

export type AnnouncerListener = (
  message: string,
  priority: AnnouncerPriority,
) => void;

const listeners = new Set<AnnouncerListener>();

let announceCounter = 0;

export const nativeAnnouncerRegionCapabilities = {
  domLiveRegionAvailable: false,
  nativeAccessibilityAnnouncementAvailable: true,
  hiddenTestRegionsRendered: true,
} as const;

export function announce(
  message: string,
  priority: AnnouncerPriority = 'polite',
): void {
  if (!message) {
    return;
  }

  announceCounter += 1;
  const padding = '\u200B'.repeat(announceCounter % 4);
  const padded = `${message}${padding}`;

  for (const listener of listeners) {
    listener(padded, priority);
  }
}

export function subscribeAnnouncer(listener: AnnouncerListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function __resetAnnouncerForTests(): void {
  listeners.clear();
  announceCounter = 0;
}

export function __getAnnouncerListenerCountForTests(): number {
  return listeners.size;
}

interface NativeLiveRegionProps {
  message: string;
  priority: AnnouncerPriority;
  testID: string;
}

function NativeLiveRegion({message, priority, testID}: NativeLiveRegionProps) {
  const accessibilityRole: AccessibilityRole =
    priority === 'assertive' ? 'alert' : 'text';

  return (
    <Text
      accessible
      accessibilityElementsHidden={false}
      accessibilityLabel={message}
      accessibilityLiveRegion={priority}
      accessibilityRole={accessibilityRole}
      importantForAccessibility="yes"
      maxFontSizeMultiplier={1}
      style={styles.liveRegion}
      testID={testID}>
      {message}
    </Text>
  );
}

export function AnnouncerRegion() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  useEffect(() => {
    return subscribeAnnouncer((message, priority) => {
      if (priority === 'assertive') {
        setAssertive(message);
      } else {
        setPolite(message);
      }

      if (message) {
        AccessibilityInfo.announceForAccessibility(message);
      }
    });
  }, []);

  return (
    <>
      <NativeLiveRegion
        message={polite}
        priority="polite"
        testID="announcer-polite"
      />
      <NativeLiveRegion
        message={assertive}
        priority="assertive"
        testID="announcer-assertive"
      />
    </>
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

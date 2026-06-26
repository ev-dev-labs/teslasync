import React, {useEffect, useState} from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  type AccessibilityRole,
} from 'react-native';
import {
  announce,
  subscribeAnnouncer,
  __getAnnouncerListenerCountForTests,
  __resetAnnouncerForTests,
  type AnnouncerListener,
  type AnnouncerPriority,
} from '../../hooks/useAnnouncer';

// The announcer pub/sub module is now owned by ../../hooks/useAnnouncer (the
// parity port of web/src/hooks/useAnnouncer.ts), mirroring the web split where
// AnnouncerRegion consumes `subscribeAnnouncer` from the hook. Re-export the
// same symbols here so existing AnnouncerRegion consumers keep working while a
// single shared listener set drives the live regions below.
export {
  announce,
  subscribeAnnouncer,
  __getAnnouncerListenerCountForTests,
  __resetAnnouncerForTests,
};
export type {AnnouncerListener, AnnouncerPriority};

export const nativeAnnouncerRegionCapabilities = {
  domLiveRegionAvailable: false,
  nativeAccessibilityAnnouncementAvailable: true,
  hiddenTestRegionsRendered: true,
} as const;

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

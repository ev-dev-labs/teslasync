import { AppRegistry } from 'react-native';

import App from '../../App';
import { name as appName } from '../../app.json';

export const WEB_ROOT_ELEMENT_ID = 'root';

export interface WebRootElement {
  readonly nodeType?: number;
}

export interface WebRootDocument {
  getElementById(elementId: string): WebRootElement | null;
}

export function getWebRootElement(
  documentRef: WebRootDocument,
  elementId: string = WEB_ROOT_ELEMENT_ID,
): WebRootElement {
  const rootTag = documentRef.getElementById(elementId);

  if (!rootTag) {
    throw new Error(
      `Missing React Native Web root element with id "${elementId}".`,
    );
  }

  return rootTag;
}

export function registerWebApp(rootTag: WebRootElement): void {
  AppRegistry.registerComponent(appName, () => App);
  AppRegistry.runApplication(appName, {
    rootTag,
    initialProps: {},
  });
}

import { AppRegistry } from 'react-native';

import {
  getWebRootElement,
  registerWebApp,
  WEB_ROOT_ELEMENT_ID,
  type WebRootDocument,
  type WebRootElement,
} from '../src/platform/webBootstrap';
import { name as appName } from '../app.json';

describe('React Native Web bootstrap', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('resolves the typed web root element', () => {
    const rootElement = { nodeType: 1 } satisfies WebRootElement;
    const documentRef: WebRootDocument = {
      getElementById: jest.fn(() => rootElement),
    };

    expect(getWebRootElement(documentRef)).toBe(rootElement);
    expect(documentRef.getElementById).toHaveBeenCalledWith(
      WEB_ROOT_ELEMENT_ID,
    );
  });

  test('throws when the web root element is missing', () => {
    const documentRef: WebRootDocument = {
      getElementById: jest.fn(() => null),
    };

    expect(() => getWebRootElement(documentRef)).toThrow(
      'Missing React Native Web root element with id "root".',
    );
  });

  test('registers the native shell through AppRegistry for web', () => {
    const rootElement = { nodeType: 1 } satisfies WebRootElement;
    const registerComponent = jest
      .spyOn(AppRegistry, 'registerComponent')
      .mockImplementation(appKey => appKey);
    const runApplication = jest
      .spyOn(AppRegistry, 'runApplication')
      .mockImplementation(() => undefined);

    registerWebApp(rootElement);

    expect(registerComponent).toHaveBeenCalledWith(
      appName,
      expect.any(Function),
    );
    expect(runApplication).toHaveBeenCalledWith(appName, {
      rootTag: rootElement,
      initialProps: {},
    });
  });
});

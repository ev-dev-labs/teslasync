import {
  getWebRootElement,
  registerWebApp,
  type WebRootDocument,
} from './src/platform/webBootstrap';

declare const document: WebRootDocument;

registerWebApp(getWebRootElement(document));

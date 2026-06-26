import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import LegacyAlertStudioRedirect, {
  LEGACY_ALERT_STUDIO_REDIRECT_TARGET,
  buildAlertStudioRedirectTarget,
  nativeLegacyAlertStudioRedirectCapabilities,
} from '../src/web-parity/features/notifications/components/LegacyAlertStudioRedirect';

type RedirectCall = {to: string; options: {replace: boolean}};

async function renderRedirect(
  props: React.ComponentProps<typeof LegacyAlertStudioRedirect>,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<LegacyAlertStudioRedirect {...props} />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('redirect target preserves the search string like the web Navigate', () => {
  expect(LEGACY_ALERT_STUDIO_REDIRECT_TARGET).toBe('/notifications/studio');
  expect(buildAlertStudioRedirectTarget('?rule=42')).toBe(
    '/notifications/studio?rule=42',
  );
  expect(buildAlertStudioRedirectTarget('?signals=a,b&from=signal-diff')).toBe(
    '/notifications/studio?signals=a,b&from=signal-diff',
  );
});

test('redirect target is the bare path when there is no search string', () => {
  expect(buildAlertStudioRedirectTarget()).toBe('/notifications/studio');
  expect(buildAlertStudioRedirectTarget('')).toBe('/notifications/studio');
});

test('documents that the DOM router redirect is unavailable natively', () => {
  expect(nativeLegacyAlertStudioRedirectCapabilities).toEqual({
    reactRouterLocationAvailable: false,
    domNavigateAvailable: false,
    nativeRedirectPropsSupported: true,
  });
});

test('fires onRedirect with the preserved search and replace by default', async () => {
  const calls: RedirectCall[] = [];

  const tree = await renderRedirect({
    search: '?id=42',
    onRedirect: (to, options) => calls.push({to, options}),
  });

  expect(calls).toEqual([
    {to: '/notifications/studio?id=42', options: {replace: true}},
  ]);
  // Like the web Navigate, the component renders nothing visible.
  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('honors an explicit replace=false override', async () => {
  const calls: RedirectCall[] = [];

  const tree = await renderRedirect({
    onRedirect: (to, options) => calls.push({to, options}),
    replace: false,
  });

  expect(calls).toEqual([
    {to: '/notifications/studio', options: {replace: false}},
  ]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders null without throwing when no onRedirect handler is wired', async () => {
  const tree = await renderRedirect({search: '?test=1'});

  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

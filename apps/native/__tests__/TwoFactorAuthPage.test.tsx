import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// TwoFactorAuthPage is a pure thin shell (no data hooks), so it renders
// synchronously without a QueryClientProvider, network/fetch, or Alert side
// effects — keeping the suite deterministic + free of open handles.
import TwoFactorAuthPage from '../src/web-parity/features/settings/pages/TwoFactorAuthPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

/* ── scaffold ── */

test('renders the page scaffold with the title and subtitle', () => {
  const tree = render(<TwoFactorAuthPage />);
  expect(hasHost(tree, 'two-factor-auth-page')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Two-factor authentication');
  expect(text).toContain(
    'Add a second factor to your sign-in. Required for sensitive admin actions.',
  );
});

/* ── copy-link affordance ── */

test('renders the copy-link affordance from the copyLink prop', () => {
  const tree = render(<TwoFactorAuthPage />);
  expect(hasHost(tree, 'two-factor-auth-copy-link')).toBe(true);
  expect(allText(tree)).toContain('Copy link');
});

/* ── TOTP enrollment section stand-in ── */

test('renders the TOTP enrollment section stand-in with its title, status pill, and native-unavailable state', () => {
  const tree = render(<TwoFactorAuthPage />);
  expect(hasHost(tree, 'totp-section')).toBe(true);
  expect(hasHost(tree, 'totp-status-pill')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Unavailable on native');
  expect(text).toContain(
    'TOTP codes from your authenticator app are required for the sudo step-up before destructive admin actions.',
  );
  expect(text).toContain('are not yet available in this native build');
});

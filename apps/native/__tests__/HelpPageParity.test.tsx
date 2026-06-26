import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import HelpPage from '../src/web-parity/features/system/pages/HelpPage';

// AIRAGHelp self-gates on useSettings (ai_mode + rag-help flag). Mocking the
// settings hook lets us drive the AI-off baseline-intact case: AIRAGHelp must
// render null while every curated link stays visible (the native analogue of
// the web TestRagHelpAIOffHidesAssistantAndDocsLinksWork off-mode assertion).
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseSettings = useSettings as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

const CURATED_LINKS: ReadonlyArray<{id: string; to: string; title: string}> = [
  {id: 'docs-status-api', to: '/docs/status-api', title: 'Documentation'},
  {id: 'onboarding', to: '/onboarding', title: 'Onboarding'},
  {id: 'system-status', to: '/system-status', title: 'System status'},
  {id: 'search', to: '/search', title: 'Search'},
  {id: 'chatbot', to: '/chatbot', title: 'Chatbot'},
];

beforeEach(() => {
  // AI off: no settings -> useAiEnabled() is false -> AIRAGHelp renders null.
  mockUseSettings.mockReturnValue({data: undefined});
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  onNavigate?: (to: string) => void,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<HelpPage onNavigate={onNavigate} />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('renders the help page title and curated link grid', async () => {
  const tree = await render();
  const raw = rawOf(tree);

  expect(textOf(tree)).toContain('Help');
  expect(raw).toContain('help-page');
  expect(raw).toContain('help-baseline-links');
});

test('renders all five curated baseline links with their titles', async () => {
  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  for (const link of CURATED_LINKS) {
    expect(raw).toContain(`help-baseline-link-${link.id}`);
    expect(text).toContain(link.title);
  }
});

test('navigates to the canonical route when a card is pressed', async () => {
  const onNavigate = jest.fn();
  const tree = await render(onNavigate);

  for (const link of CURATED_LINKS) {
    const card = tree.root.findByProps({
      testID: `help-baseline-link-${link.id}`,
    });
    await ReactTestRenderer.act(async () => {
      card.props.onPress();
    });
    expect(onNavigate).toHaveBeenCalledWith(link.to);
  }

  expect(onNavigate).toHaveBeenCalledTimes(CURATED_LINKS.length);
});

test('hides the AI assistant surface when AI mode is off', async () => {
  const tree = await render();
  const raw = rawOf(tree);

  // Baseline intact: the AI surface is absent but every curated link remains.
  expect(raw).not.toContain('ai-feature-rag-help-root');
  expect(raw).toContain('help-baseline-links');
  expect(raw).toContain('help-baseline-link-chatbot');
});

test('does not crash and renders all links when no onNavigate is provided', async () => {
  const tree = await render();

  const card = tree.root.findByProps({
    testID: 'help-baseline-link-search',
  });
  expect(() => card.props.onPress()).not.toThrow();
});

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {IncidentsCard} from '../src/web-parity/features/system/components/status/IncidentsCard';
import {
  useCreateIncident,
  useIncidents,
} from '../src/web-parity/api/hooks/useIncidents';

// The incidents hooks are mocked so the card renders controlled data without a
// QueryClient / network and the inline IncidentForm's create mutation is inert.
jest.mock('../src/web-parity/api/hooks/useIncidents', () => ({
  useIncidents: jest.fn(),
  useCreateIncident: jest.fn(),
}));

const mockUseIncidents = useIncidents as unknown as jest.Mock;
const mockUseCreateIncident = useCreateIncident as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {props?: Record<string, unknown>; children?: JsonNode | JsonNode[]}
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
    return node.map(flattenText).join(' ');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  return flattenText(tree.toJSON() as JsonNode);
}

// 2026-06-26T10:00:00Z; an incident started 5 minutes earlier -> "5m ago".
const NOW = Date.parse('2026-06-26T10:00:00Z');

const INCIDENT = {
  id: 7,
  title: 'Wall connector offline',
  description: '',
  severity: 'major' as const,
  status: 'investigating' as const,
  source: 'manual' as const,
  affected_components: ['tesla', 'telemetry'],
  updates: [
    {at: '2026-06-26T09:55:00Z', status: 'investigating' as const, message: 'x'},
    {at: '2026-06-26T09:57:00Z', status: 'investigating' as const, message: 'y'},
  ],
  started_at: '2026-06-26T09:55:00Z',
  created_at: '2026-06-26T09:55:00Z',
  updated_at: '2026-06-26T09:57:00Z',
};

function setIncidents(incidents: unknown[]): void {
  mockUseIncidents.mockReturnValue({data: {incidents, count: incidents.length}});
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<IncidentsCard now={NOW} />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockUseCreateIncident.mockReturnValue({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
    isPending: false,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('IncidentsCard (native parity)', () => {
  it('renders nothing when there are no active incidents', async () => {
    setIncidents([]);
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });

  it('renders the header, count badge and an incident row', async () => {
    setIncidents([INCIDENT]);
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain('Active incidents');
    // Count badge + CTA.
    expect(text).toContain('1');
    expect(text).toContain('+ Log incident');
    // Row: title, status badge, severity label.
    expect(text).toContain('Wall connector offline');
    expect(text).toContain('investigating');
    expect(text).toContain('major');
    // Affected components + relative started line with the updates count.
    expect(text).toContain('Affects: tesla, telemetry');
    expect(text).toContain('Started 5m ago · 2 updates');
  });

  it('opens the inline IncidentForm when "Log incident" is pressed', async () => {
    setIncidents([INCIDENT]);
    const tree = await render();

    expect(textOf(tree)).not.toContain('Log an incident');

    const cta = tree.root
      .findAllByProps({accessibilityLabel: 'Log incident'})
      .find(node => typeof node.props.onPress === 'function');
    expect(cta).toBeDefined();

    await ReactTestRenderer.act(async () => {
      cta?.props.onPress();
    });

    const text = textOf(tree);
    expect(text).toContain('Log an incident');
    expect(text).toContain('Title');
    expect(text).toContain('Severity');
    expect(text).toContain('Log incident');
  });
});

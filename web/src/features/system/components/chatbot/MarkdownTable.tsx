import { createContext, useContext, type JSX } from 'react';
import type { ExtraProps } from 'react-markdown';
import { Table } from '@/components/ui';

type MarkdownNode = NonNullable<ExtraProps['node']>;
type MarkdownChild = MarkdownNode['children'][number];

const ColumnLabels = createContext<ReadonlyMap<MarkdownNode, string>>(new Map());

function elements(node: MarkdownNode | undefined, tag: string): MarkdownNode[] {
  return (node?.children ?? []).filter(
    (child): child is MarkdownNode => child.type === 'element' && child.tagName === tag,
  );
}

function textContent(node: MarkdownChild): string {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return '';
  if (node.tagName === 'img' && typeof node.properties.alt === 'string') return node.properties.alt;
  return node.children.map(textContent).join('');
}

function columnLabels(table: MarkdownNode | undefined): ReadonlyMap<MarkdownNode, string> {
  const labels = new Map<MarkdownNode, string>();
  const row = elements(elements(table, 'thead')[0], 'tr')[0];
  const headings = elements(row, 'th').map(header => textContent(header).replace(/\s+/g, ' ').trim());
  for (const body of elements(table, 'tbody')) {
    for (const bodyRow of elements(body, 'tr')) {
      elements(bodyRow, 'td').forEach((cell, index) => {
        const label = headings[index];
        if (label) labels.set(cell, label);
      });
    }
  }
  return labels;
}

export function MarkdownTable({ children, node }: JSX.IntrinsicElements['table'] & ExtraProps) {
  return (
    <div className="my-2 max-w-full overflow-x-auto">
      <ColumnLabels.Provider value={columnLabels(node)}>
        <Table data-conversation-table>{children}</Table>
      </ColumnLabels.Provider>
    </div>
  );
}

export function useMarkdownTableLabel(node: MarkdownNode | undefined) {
  const labels = useContext(ColumnLabels);
  return node ? labels.get(node) : undefined;
}

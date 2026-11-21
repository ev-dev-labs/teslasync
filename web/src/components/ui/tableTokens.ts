export const tableTokens = {
  frame: 'min-w-0 max-w-full space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-1)] p-3 shadow-e1',
  toolbar: 'flex flex-wrap items-center justify-between gap-2',
  wrapper: 'w-full border-collapse text-sm text-[var(--text-primary)]',
  head: 'border-b border-[var(--border-default)] bg-[var(--surface-2)] text-[var(--text-secondary)] text-xs normal-case tracking-normal',
  headCell: 'px-4 py-3.5 text-left font-semibold',
  body: 'divide-y divide-[var(--border-subtle)]',
  row: 'align-middle transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
  cell: 'px-4 py-3.5',
  scrollContainer: 'relative overflow-auto rounded-panel border border-[var(--border-default)]',
  stickyHead: 'sticky top-0 z-20 bg-[var(--surface-2)] backdrop-blur-sm',
  rowSelected: '[&>td:first-child]:shadow-[inset_3px_0_0_var(--theme-accent)] rtl:[&>td:first-child]:shadow-[inset_-3px_0_0_var(--theme-accent)]',
  groupStart: 'border-l border-[var(--border-subtle)]',
  semantic: '[&_thead]:border-b [&_thead]:border-[var(--border-default)] [&_thead]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:normal-case [&_th]:tracking-normal [&_th]:text-[var(--text-secondary)] [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:align-middle [&_tbody_tr]:border-b [&_tbody_tr]:border-[var(--border-subtle)] [&_tbody_tr:nth-child(even)]:bg-[var(--surface-2)] [&_tbody_tr:hover]:bg-[var(--control-bg-hover)] [&_tbody_tr:focus-within]:bg-[var(--control-bg-hover)]',
  bulkBar:
    'flex flex-wrap items-center gap-2 px-3 py-2 mb-2 rounded-lg ' +
    'border border-[var(--border-default)] bg-[var(--control-bg)] text-sm text-[var(--text-primary)]',
  leadingColWidth: 'w-10',
  resizer:
    'absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none ' +
    'opacity-0 hover:opacity-100 hover:bg-[var(--text-muted)] transition-opacity ' +
    'focus-visible:opacity-100 focus-visible:bg-[var(--text-secondary)] outline-none',
  expandedCell: 'px-4 py-3 bg-[var(--surface-2)] border-l-2 border-[var(--border-default)]',
} as const

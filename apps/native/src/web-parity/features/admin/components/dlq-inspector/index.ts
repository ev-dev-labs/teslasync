// Native parity port of web/src/features/admin/components/dlq-inspector/index.ts.
//
// The web barrel re-exports four sibling components:
//   export { StatusHeader } from './StatusHeader';
//   export { EntriesTable } from './EntriesTable';
//   export { AuditPanel } from './AuditPanel';
//   export { EntryDrawer } from './EntryDrawer';
//
// Those siblings are not yet native conversion targets, so to keep this barrel a
// valid (JSX-free) .ts module that type-checks today, the four native ports live
// in the co-located ./DlqInspectorPanels module and are surfaced here under the
// exact same public names. The public API is identical to the web barrel.
export {
  StatusHeader,
  EntriesTable,
  AuditPanel,
  EntryDrawer,
} from './DlqInspectorPanels';

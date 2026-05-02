# Printing TeslaSync pages

TeslaSync ships an `@media print` stylesheet that turns the live SPA into a
paper-friendly white-on-black document. Both the native browser print dialog
(`Ctrl+P` / `Cmd+P`) and the in-app **Print** button (`<PrintButton>`) trigger
the same stylesheet, so any page in the app can be printed without first
opening a designer-built export.

## Print-friendly pages

These pages have an explicit **Print** button in their header actions slot:

| Page                | Typical use case                                         |
| ------------------- | -------------------------------------------------------- |
| Dashboard           | One-page snapshot of fleet status                        |
| Drives → drive detail | Insurance evidence for a specific trip                 |
| Charging → session detail | Receipts for charging-cost reimbursement / expenses |
| Charging → Cost Analysis  | Monthly / annual cost summary for spreadsheets      |
| Alerts              | Warranty/service evidence for an alert event             |

Any other page is also printable via `Ctrl+P` — the print stylesheet runs
regardless of how the dialog was opened. The shared `<PrintButton>` is opt-in
and lives in `web/src/components/ui/PrintButton.tsx`.

## What the print stylesheet does

- Hides the sidebar, mobile top bar, command palette, toast container, and
  any element marked with `data-print-hide`.
- Forces a white background with black/dark-grey text via the `--text-*`
  tokens.
- Strips glass / glow / shadow / `backdrop-filter` from cards so they render
  with a plain `1px` border on white paper.
- Recolors recharts grids (light grey) and axis/legend labels (dark grey) so
  charts remain readable on white.
- Uses `break-inside: avoid` on cards, tables, and figures to prevent
  unsightly mid-element page breaks.
- Expands the main content area to full width once the sidebar is gone.
- Spells out external link targets after the link text (so a printed page
  shows the URL behind every link).
- Sets a 12 mm `@page` margin (A4 / Letter friendly).

## Opting out

To exclude a specific element from the printed page, add `data-print-hide`:

```tsx
<button data-print-hide onClick={openConfigModal}>
  Edit filters
</button>
```

This is the right escape hatch for one-off chrome (filter toolbars, edit
buttons, in-page actions) that doesn't need to appear on paper. The print
stylesheet always hides any element carrying the attribute.

The `<PrintButton>` itself carries `data-print-hide` so the trigger never
appears on the printed page.

## Adding `<PrintButton>` to a new page

```tsx
import { PageContainer } from '@/components/layout';
import { PrintButton } from '@/components/ui';

export default function MyReportPage() {
  return (
    <PageContainer
      title="My Report"
      actions={
        <div data-print-hide className="flex items-center gap-2">
          <PrintButton />
        </div>
      }
    >
      …
    </PageContainer>
  );
}
```

`<PrintButton>` accepts an optional `beforePrint` callback that runs before
the print dialog opens — use it to expand collapsed sections or switch to
the tab the user expects on paper:

```tsx
<PrintButton beforePrint={() => expandAllSections()} label="Print report" />
```

## Limitations

- Map tiles (Leaflet) may render as grey boxes in print — that's a browser
  limitation. The polyline / markers still draw on top of whatever the
  browser captured.
- Browsers control the page header / footer (page numbers, dates, URL).
  The print stylesheet does not customize these — use the print dialog's
  built-in "Headers and footers" toggle.
- Server-side PDF rendering (headless Chrome → PDF) is **not** part of this
  feature. Native browser print covers the immediate need.

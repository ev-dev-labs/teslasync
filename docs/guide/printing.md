# Printing

Printing isn't a feature most platforms invest in. TeslaSync does, because the same data that lives on screen is occasionally needed on paper — insurance evidence for a specific drive, monthly cost summaries for a spreadsheet, alert documentation for a warranty claim, a fleet status snapshot to drop into a board meeting.

The platform handles all of these without a separate "report builder", a PDF service, or a designer-exported template. The live UI itself prints, with a stylesheet that turns the running SPA into a paper-friendly document.

## The one paragraph if you only read this much

Every page in TeslaSync is printable. `Ctrl+P` (`Cmd+P` on macOS) works on any route, and a handful of pages add an explicit `<PrintButton>` in their header for discoverability. The `@media print` stylesheet hides app chrome, switches to a white background, strips glow/shadow/glass effects, recolours charts for paper, expands the link URLs after the link text, and forces sensible page breaks. To exclude a piece of UI from the printed page, give it `data-print-hide`. There is no headless-Chrome-to-PDF backend; the browser's print dialog covers the use cases.

## How the print stylesheet thinks about your page

When the browser fires `@media print`, the stylesheet transforms three things:

### 1. Chrome → gone

The sidebar, mobile top bar, command palette, toast container, in-page tab switchers, filter toolbars, action buttons, and anything tagged `data-print-hide` disappear. What's left is the page content — the cards, the charts, the tables, the prose. The main content area expands to fill the page width once the sidebar is removed.

### 2. Dark theme → light theme, regardless of UI preference

The UI's dark surfaces (`--bg-*`, `--surface-*`) flip to white. Body text uses dark grey via `--text-*` tokens. Glass effects, glow shadows, and `backdrop-filter` are stripped because they don't translate to ink. Cards get a plain `1px` border on white so the layout still reads as panels of grouped information.

This is the right behaviour even for users running the app in light mode — the print stylesheet enforces white-on-black-text deliberately because some print drivers (especially mobile) ignore page backgrounds, which would leave the dark-theme text invisible.

### 3. Charts → paper-friendly

Recharts gridlines render in light grey, axis and legend labels in dark grey, line strokes in dark colours rather than the glow-emphasised UI tones. The data is the same; only the colour ramp adapts.

### Layout sanity

- `break-inside: avoid` on cards, tables, and figures so a card doesn't get sliced across two pages
- `@page` margin of 12 mm — comfortable on both A4 and Letter
- External link URLs print after the link text in parentheses, so a printed page still shows where every link pointed

## Pages with an explicit Print button

These five pages have a `<PrintButton>` in their header actions slot. The button is shared (`web/src/components/ui/PrintButton.tsx`) and adds nothing the keyboard shortcut doesn't — it's a discoverability affordance for users who don't think to `Ctrl+P` a web app.

| Page                      | Why someone prints it                                          |
| ------------------------- | -------------------------------------------------------------- |
| Dashboard                 | One-page snapshot of fleet status for a meeting or wall mount  |
| Drives → drive detail     | Evidence of a specific trip for insurance, dispute, or expense |
| Charging → session detail | Receipt for charging-cost reimbursement / expense submission   |
| Charging → Cost Analysis  | Monthly / annual summary for tax, accounting, or budgeting     |
| Alerts                    | Warranty / service evidence for a specific alert event         |

Any other page prints via the browser shortcut. The stylesheet applies regardless of how the print dialog was opened.

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

The `data-print-hide` on the wrapping `<div>` is important: it prevents the action toolbar from printing alongside the report itself. The `<PrintButton>` carries its own `data-print-hide`, so even without the wrapper it doesn't print — but other action buttons in that slot would.

### The `beforePrint` escape hatch

`<PrintButton>` takes an optional `beforePrint` callback that runs before the print dialog opens. Use it to expand collapsed sections, switch to the tab that makes sense on paper, or trigger any one-shot work the printed page needs:

```tsx
<PrintButton
  beforePrint={() => {
    expandAllSections();
    switchToFullYearTab();
  }}
  label="Print annual report"
/>
```

The `label` prop overrides the default button text. Use it when the printable artifact has a more specific name than "Print".

## Opting elements out of the printed page

Any element with `data-print-hide` is omitted from the print output:

```tsx
<button data-print-hide onClick={openConfigModal}>
  Edit filters
</button>
```

This is the right escape hatch for:

- Filter toolbars (the filtered data still prints; the filter UI doesn't)
- In-page action buttons (edit, delete, share)
- Tab switchers when one tab is the canonical print view
- Dev/debug overlays that exist in production but shouldn't appear on paper

The stylesheet uses `display: none !important` for elements carrying the attribute, so it wins over any per-component overrides.

## Things that don't print well — and what to do about them

### Map tiles

Leaflet renders OSM tiles to a canvas. Some browsers' print drivers render the canvas as a grey box. The polyline (drive route) and markers still draw on top of whatever the browser captured, so the route shape and waypoints are visible even if the basemap isn't.

Workaround: if a paper map is critical, screenshot the map separately and include it as an attachment to the printed page.

### Background images

Browsers default to **not** printing background colours and images to save ink. Critical-info backgrounds in the UI (e.g., signal-strength chips, status badges) are reproduced as foreground colour or as a left border so the information survives the "no backgrounds" default. There's nothing the user needs to toggle.

### Iframes

VitePress docs (the docs site you're reading) embed the database schema as an iframe. Iframes have their own print stylesheet and may not honour the parent's. To print iframe content, navigate to the iframe URL directly and print from there.

### Long tables

Tables paginate by row, and `break-inside: avoid` is applied to `<tr>` elements where the table primitive supports it. If you're printing a table with 10,000 rows you probably want the CSV export instead — see [Data Export](/features/data-export).

## What's deliberately not part of this feature

- **Server-side PDF rendering.** No headless Chrome, no Puppeteer, no /print-to-pdf endpoint. The browser already knows how to render to PDF (every modern browser includes "Save as PDF" in the print dialog destinations). Reinventing that in the server would be infrastructure for an already-solved problem.
- **Per-page customised paper templates.** The same stylesheet drives every page. Pages that need a different paper layout (e.g., a 4-up label sheet) wouldn't benefit from the in-app print pipeline anyway — they belong in a dedicated export.
- **Email-to-PDF or scheduled report mailing.** That's reporting infrastructure, which is what [Data Export](/features/data-export) is for. Printing is the immediate-physical-paper path; exports are the asynchronous-shareable path.

## Where to look in the code

- `web/src/styles/print.css` — the print stylesheet itself
- `web/src/components/ui/PrintButton.tsx` — the shared button + `beforePrint` plumbing
- Any feature page with `<PrintButton>` in its actions slot for examples

## Related

- [Data Export](/features/data-export) — when you want CSV/JSON/Parquet instead of paper
- [Dashboard](/features/dashboard) — the printable fleet-status snapshot
- [Analytics](/features/analytics) — printable monthly/annual summaries

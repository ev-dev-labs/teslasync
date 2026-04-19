---
description: "Add chart export as PNG button to ChartContainer component"
---

# Chart Export as PNG

## Problem

Users screenshot charts to share with others or save for records. There's no
built-in export button. The `ChartContainer` component has an `action` prop
slot that's perfect for an export button.

## Current State

```
web/src/components/charts/ChartContainer.tsx — has action?: ReactNode prop
web/package.json — no html2canvas dependency
```

## Task

### Step 1: Install html2canvas

```bash
cd web && npm install html2canvas-pro
```

Use `html2canvas-pro` (maintained fork) instead of `html2canvas` (stale).

### Step 2: Create useChartExport Hook

Create `web/src/hooks/useChartExport.ts`:

```typescript
import { useRef, useCallback, useState } from 'react';
import html2canvas from 'html2canvas-pro';

export function useChartExport(filename?: string) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const exportPNG = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(chartRef.current, {
        backgroundColor: '#0a0a0f',  // match dark background
        scale: 2,                    // 2x for retina quality
        useCORS: true,
        logging: false,
      });
      const link = document.createElement('a');
      link.download = `${filename ?? 'chart'}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Chart export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [filename, exporting]);

  return { chartRef, exportPNG, exporting };
}
```

### Step 3: Add Export Button to ChartContainer

Update `web/src/components/charts/ChartContainer.tsx`:

Add a built-in export button when `exportable` prop is true:

```tsx
interface ChartContainerProps {
  // ... existing props
  exportable?: boolean;      // show export button (default: false)
  exportFilename?: string;   // custom filename prefix
}
```

Inside the component, add a download icon button in the header:
```tsx
{exportable && (
  <button
    onClick={exportPNG}
    disabled={exporting}
    className="p-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors"
    aria-label={t('chart.export', 'Export as PNG')}
  >
    {exporting ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      <Download className="h-4 w-4" />
    )}
  </button>
)}
```

Wrap the chart content area with the `chartRef`:
```tsx
<div ref={chartRef}>
  {children}
</div>
```

### Step 4: Enable on Key Pages

Add `exportable` prop to charts on high-value pages:
- Battery Health chart
- Driving Dynamics charts
- Energy consumption charts
- Charging session charts
- Analytics charts

Example:
```tsx
<ChartContainer title={t('battery.degradation')} height={300} exportable exportFilename="battery-degradation">
  <ResponsiveContainer>...</ResponsiveContainer>
</ChartContainer>
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Download icon appears on charts with `exportable` prop
- [ ] Clicking downloads a PNG with correct filename
- [ ] PNG has dark background (not transparent)
- [ ] PNG is 2x resolution (retina quality)
- [ ] Button shows spinner during export
- [ ] Charts without `exportable` prop are unchanged

## Commit

```bash
git add -A
git commit -m "feat(web): add chart export as PNG to ChartContainer

- Install html2canvas-pro for chart rendering
- Create useChartExport hook with 2x retina export
- Add exportable prop to ChartContainer with download button
- Enable on battery, driving, energy, and analytics charts"
```

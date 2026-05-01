# Iconography audit

Generated: 2026-05-01T16:32:57.5178017-07:00

## Summary

- Files importing directly from lucide-react: **450**
- Total icon imports across those files: **1852**
- Files with arbitrary pixel sizing (h-[Npx] w-[Npx]): **3**
- Files with inline <svg> elements: **21**

See [`docs/ICON_GUIDELINES.md`](../ICON_GUIDELINES.md) for the migration policy.

## Top 10 worst offenders

| Icons | File |
| ----: | :--- |
| 18 | `web\src\features\battery\pages\BatteryHealthPage.tsx` |
| 17 | `web\src\features\maps\pages\NavigationRoutePage.tsx` |
| 17 | `web\src\features\system\pages\RoadmapPage.tsx` |
| 16 | `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` |
| 15 | `web\src\features\admin\components\devtools\ClientUtilitiesSection.tsx` |
| 15 | `web\src\features\battery\pages\BatteryCellsPage.tsx` |
| 14 | `web\src\features\notifications\components\NotificationChannelsView.tsx` |
| 14 | `web\src\features\analytics\pages\LifetimeStatsPage.tsx` |
| 14 | `web\src\features\analytics\pages\ComparisonPage.tsx` |
| 14 | `web\src\features\driving\pages\TripReplayPage.tsx` |

## Inline pixel sizing

| File | Line | Snippet |
| :--- | ---: | :--- |
| `web\src\components\data-display\Timeline.tsx` | 29 | `'absolute left-0 top-1 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 bg-white dark:bg-gray-900',` |
| `web\src\components\layout\Layout.tsx` | 807 | `<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-neon-blue/[0.01] blur-[120px]" />` |
| `web\src\features\driving\components\driving-dynamics\LiveMotorStatus.tsx` | 84 | `<div className="flex h-[120px] w-[120px] items-center justify-center">` |

## Inline `<svg>` usages

| Count | File |
| ----: | :--- |
| 2 | `web\src\components\data-display\TeslaCarViz.tsx` |
| 2 | `web\src\components\feedback\Spinner.tsx` |
| 2 | `web\src\components\vehicles\VehicleTwin.tsx` |
| 1 | `web\src\components\charts\MiniChart.tsx` |
| 1 | `web\src\features\dashboard\widgets\TirePressureVisualWidget.tsx` |
| 1 | `web\src\features\dashboard\widgets\SpeedHeatmapWidget.tsx` |
| 1 | `web\src\features\dashboard\widgets\shared\WidgetFlowDiagram.tsx` |
| 1 | `web\src\features\dashboard\widgets\BatteryRadialGaugeWidget.tsx` |
| 1 | `web\src\features\charging\components\cost-analysis\MonthlyCostChart.tsx` |
| 1 | `web\src\features\battery\pages\BatteryDegradationPage.tsx` |
| 1 | `web\src\components\ui\Logo.tsx` |
| 1 | `web\src\components\ui\Icon.tsx` |
| 1 | `web\src\components\ui\Button.tsx` |
| 1 | `web\src\components\motion\CarAnimation.tsx` |
| 1 | `web\src\components\feedback\QueryError.tsx` |
| 1 | `web\src\components\data-display\ProgressRing.tsx` |
| 1 | `web\src\components\data-display\DriveScore.tsx` |
| 1 | `web\src\components\charts\Sparkline.tsx` |
| 1 | `web\src\components\charts\RadialGauge.tsx` |
| 1 | `web\src\features\system\components\FSMStateDiagram.tsx` |
| 1 | `web\src\features\watch\pages\WatchFacePage.tsx` |

## How to reduce these counts

1. Replace `import { X } from 'lucide-react'` with `import { Icons } from '@/lib/icons'`.
2. Replace `<X className="h-5 w-5" />` with `<Icon icon={Icons.x} size="lg" />` from `@/components/ui`.
3. If the concept is missing from the registry, add it to `web/src/lib/icons.ts`.
4. Re-run `pwsh scripts/icon-audit.ps1` to regenerate this report.

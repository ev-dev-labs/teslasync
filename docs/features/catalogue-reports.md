# Reports

The detailed sidebar's **Reports** group has six destinations; the compact
sidebar shows them under **Insights**. **Fleet Insights** links
Statistics, Analytics, and Period Comparison; **Driving Efficiency** links
Efficiency, Temperature Impact, and Drive Archetypes; **Costs** links Cost
Analysis and Cost of Ownership. Each screen keeps its own URL, filters, and
full functionality, with links between screens in its group. Carbon
Intelligence, Share Card Studio, and Private Benchmarks remain separate.
All eleven screens remain directly accessible via their existing URLs,
bookmarks, the feature catalog, and search.

| Screen | Path | What it does | When empty |
| ------ | ---- | ------------ | ---------- |
| Statistics | `/statistics` | Bar and pie charts across every metric in the system. | Renders an empty state when no data is available — the page is not hidden. |
| Analytics | `/analytics` | Long-range trends and correlations you can drill into. | Renders an empty state when no data is available — the page is not hidden. |
| Period Comparison | `/period-compare` | Compare two windows with per-metric values and a unitless percentage-change chart relative to Period B. | Metrics without a nonzero Period B baseline remain in the details table but are omitted from the percent chart rather than shown as 0%. |
| Efficiency | `/efficiency` | Wh/mile broken down by speed, climate, and elevation. | Renders an empty state when no data is available — the page is not hidden. |
| Temperature Impact | `/temperature-impact` | How outside temperature affects range and efficiency. | Renders an empty state when no data is available — the page is not hidden. |
| Cost Analysis | `/cost-analysis` | Electricity cost per drive and per mile. | Renders an empty state when no data is available — the page is not hidden. |
| Cost of Ownership | `/tco` | Total cost of ownership — energy, insurance, service, depreciation. | Renders an empty state when no data is available — the page is not hidden. |
| Share Card Studio | `/share-card` | Design privacy-aware visual summaries ready to share. | Renders an empty state when no data is available — the page is not hidden. |
| Carbon Intelligence | `/analytics/carbon` | Track charging emissions and lower-carbon alternatives. | Renders an empty state when no data is available — the page is not hidden. |
| Drive Archetypes | `/drive-archetypes` | Discover recurring drive patterns and representative journeys. | Empty until telemetry (and for billing pages, Tesla charging history) has ingested sessions. |
| Private Benchmarks | `/benchmarks/privacy` | Compare with similar vehicles without uploading raw trips. | Renders an empty state when no data is available — the page is not hidden. |

[← All groups](./catalogue.md)

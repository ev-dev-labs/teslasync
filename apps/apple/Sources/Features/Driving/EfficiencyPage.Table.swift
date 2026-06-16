import SwiftUI

// The temperature-bucketed efficiency table for the Efficiency surface (web GlassPanel11 +
// `DataTable`). Built on the P3 adaptive `TSDataTable` (a columnar grid on macOS / regular width, a
// card list on compact iPhone). Each value formats from raw SI via `EfficiencyPageFormat` at this display
// boundary; renders the noTempData empty (web `tempBuckets.length > 0 ? DataTable : EmptyState`).

/// The efficiency-by-temperature-range panel (web GlassPanel11): the thermometer-led title and either
/// the six-column temperature table (range / drives / avg efficiency / distance-per-kWh / total
/// distance / avg speed) or the not-enough-data empty.
struct EfficiencyTempTableSection: View {
    let buckets: [EfficiencyTempBucket]
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                EfficiencySectionHeader(
                    systemImage: "thermometer.medium",
                    title: "efficiency.tempEfficiency",
                    tone: .warning
                )
                if buckets.isEmpty {
                    TSEmptyState(title: "efficiency.noTempData", systemImage: "thermometer.medium.slash")
                        .frame(maxWidth: .infinity)
                } else {
                    TSDataTable(rows: buckets, columns: columns, density: .compact)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var avgEffHeader: LocalizedStringKey {
        LocalizedStringKey("\(String(localized: "efficiency.avg")) \(EfficiencyPageFormat.efficiencyUnit(units))")
    }

    private var distancePerKwhHeader: LocalizedStringKey {
        LocalizedStringKey("\(EfficiencyPageFormat.distanceUnit(units))/kWh")
    }

    private var totalDistanceHeader: LocalizedStringKey {
        LocalizedStringKey("\(String(localized: "efficiency.total")) \(EfficiencyPageFormat.distanceUnit(units))")
    }

    private var columns: [TSColumn<EfficiencyTempBucket>] {
        [
            TSColumn(id: "range", title: "efficiency.tempRange") { bucket in
                Text(verbatim: EfficiencyPageFormat.temperatureBucketLabel(bucket, units))
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
            },
            TSColumn(id: "count", title: "efficiency.drives") { bucket in
                Text(verbatim: "\(bucket.count)")
                    .foregroundStyle(Color.TS.textSecondary)
            },
            TSColumn(id: "avgEff", title: avgEffHeader) { bucket in
                Text(verbatim: EfficiencyPageFormat.efficiencyInt(bucket.avgWhPerKm, units))
                    .foregroundStyle(EfficiencyTier.from(whPerKm: bucket.avgWhPerKm).color)
            },
            TSColumn(id: "distancePerKwh", title: distancePerKwhHeader) { bucket in
                Text(verbatim: EfficiencyPageFormat.distancePerKwh(bucket.avgWhPerKm, units))
                    .foregroundStyle(EfficiencyTier.good.color)
            },
            TSColumn(id: "totalDist", title: totalDistanceHeader) { bucket in
                Text(verbatim: EfficiencyPageFormat.integer(EfficiencyPageFormat.distanceValue(
                    bucket.totalDistanceM,
                    units
                )))
                .foregroundStyle(Color.TS.textSecondary)
            },
            TSColumn(id: "avgSpeed", title: "efficiency.avgSpeedCol") { bucket in
                Text(verbatim: EfficiencyPageFormat.speedInt(bucket.avgSpeedMps, units))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        ]
    }
}

import SwiftUI

// The list/table/banner panels for the Battery Degradation surface (web Recommendations
// `GlassPanel14`, Charging-Habits-Impact `GlassPanel15`, Degradation-History
// `GlassPanel20`, and the loading skeleton). Split from
// `BatteryDegradationPage.Sections.swift` to keep each file focused. Each panel renders
// its own empty state (never a blank region); distances/energy convert through the
// shared SI `Units` facade at this boundary.

// MARK: - Recommendations (web GlassPanel14)

/// The recommendations panel (web GlassPanel14): a bolt-led list of guidance strings,
/// or the no-recommendations empty state.
struct BatteryDegradationRecommendationsSection: View {
    let detail: BatteryDegradationDetail?

    private var recommendations: [String] {
        detail?.recommendations ?? []
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(Color.TS.statusWarning)
                        .accessibilityHidden(true)
                    TSSubhead("battery.degradation.recommendations")
                }
                if recommendations.isEmpty {
                    TSEmptyState(
                        title: "battery.degradation.noRecommendations",
                        systemImage: "exclamationmark.triangle"
                    )
                    .frame(maxWidth: .infinity)
                } else {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        ForEach(Array(recommendations.enumerated()), id: \.offset) { _, recommendation in
                            recommendationRow(recommendation)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func recommendationRow(_ text: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.statusWarning)
                .padding(.top, 2)
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.05),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.1), lineWidth: 1)
        )
    }
}

// MARK: - Charging habits impact (web GlassPanel15 — AlertBanner)

/// The charging-impact panel (web GlassPanel15): a stress-toned banner summarising the
/// fast-charge ratio + deep-discharge count with the matching guidance body.
struct BatteryDegradationChargingImpactSection: View {
    let detail: BatteryDegradationDetail?

    private var stress: BatteryStressLevel {
        detail?.stressLevel ?? .unknown
    }

    private var bannerTitle: String {
        let habits = detail?.chargingHabits
        let fast = habits?.fastChargePercent ?? 0
        let deep = habits?.deepDischargeCount ?? 0
        let fastWord = String(localized: "battery.degradation.fastCharges", defaultValue: "fast charges")
        let deepWord = String(localized: "battery.degradation.deepDischarges", defaultValue: "deep discharges")
        let stressWord = String(localized: "battery.degradation.stressLabel", defaultValue: "stress")
        let stressName = stress == .unknown ? "Unknown" : stress.displayLabel
        return "\(fast)% \(fastWord), \(deep) \(deepWord) — \(stressName) \(stressWord)"
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(Color.TS.statusSuccess)
                        .accessibilityHidden(true)
                    TSSubhead("battery.degradation.chargingImpact")
                }
                TSAlertBanner(
                    tone: stress.severity.tone,
                    systemImage: "thermometer.medium",
                    title: LocalizedStringKey(bannerTitle),
                    message: LocalizedStringKey(stress.guidanceKey)
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Degradation history table (web GlassPanel20 — DataTable)

/// The degradation-history panel (web GlassPanel20): a sortable five-column table
/// (Date / Odometer / SOH % / Capacity / Range) or the no-records empty state.
struct BatteryDegradationHistorySection: View {
    let health: BatteryHealthData
    let units: UnitPreferences

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSSubhead("Degradation History")
                if health.hasHistory {
                    TSDataTable(rows: health.history, columns: columns, density: .compact)
                        .accessibilityLabel(Text("Degradation History"))
                } else {
                    TSEmptyState(title: "No degradation records found.", systemImage: "chart.bar.xaxis")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var columns: [TSColumn<BatteryHealthSnapshot>] {
        [
            TSColumn(id: "date", title: "Date", comparator: { compareStrings($0.date, $1.date) }, cell: { row in
                Text(verbatim: BatteryDegradationFormat.dateLabel(row.date))
            }),
            TSColumn(
                id: "odometer",
                title: "Odometer",
                comparator: { compare($0.odometerKm, $1.odometerKm) },
                cell: { row in Text(verbatim: BatteryDegradationFormat.distanceFromKm(row.odometerKm, units)) }
            ),
            TSColumn(id: "soh", title: "SOH %", comparator: { compare($0.sohPct, $1.sohPct) }, cell: { row in
                sohBadge(row)
            }),
            TSColumn(
                id: "capacity",
                title: "Capacity",
                comparator: { compare($0.capacityWh, $1.capacityWh) },
                cell: { row in Text(verbatim: Units.formatEnergy(row.capacityWh, units)) }
            ),
            TSColumn(id: "range", title: "Range", comparator: { compare($0.rangeKm, $1.rangeKm) }, cell: { row in
                Text(verbatim: BatteryDegradationFormat.distanceFromKm(row.rangeKm, units))
            })
        ]
    }

    private func sohBadge(_ row: BatteryHealthSnapshot) -> some View {
        let value = BatteryDegradationFormat.number(
            row.sohPct,
            decimals: BatteryDegradationFormat
                .defaultDecimals(units)
        )
        return TSBadge(LocalizedStringKey("\(value)%"), tone: row.sohSeverity.tone)
    }

    private func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }

    private func compareStrings(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs.compare(rhs)
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the
/// summary grid, the gauge/prediction pair, the projection + range blocks, and the
/// section panels, all under SwiftUI redaction (the manifest's `loading → redacted`).
struct BatteryDegradationSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonGrid(count: 4, minimum: 160)
            HStack(spacing: TSSpacing.lg) {
                skeletonBlock(height: 240)
                skeletonBlock(height: 240)
            }
            skeletonBlock(height: 300)
            skeletonBlock(height: 260)
            skeletonBlock(height: 220)
        }
        .batteryDegradationRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("Battery Degradation"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 96)
            }
        }
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading
    /// state (the manifest's `loading → redacted(reason:)` requirement).
    func batteryDegradationRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}

import SwiftUI

// The summary metric cards, the monthly-summary table panel, and the loading skeleton for the
// Mileage surface (web summary `MetricCard`s + the Monthly-Summary `GlassPanel`/`DataTable`). Each
// value formats from raw SI via `MileageFormat` at this display boundary; the panel renders its own
// empty state (never a blank region). The odometer + daily-distance chart panels live in
// `MileagePage.Charts.swift`.

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled summary metric with a tinted SF Symbol (web `MetricCard` with its `color` prop).
/// Composes the shared `TSCard` + `TSIconBox` + typography so the per-card accent matches the web
/// hue. Page-local, mirroring the sibling analytics pages' own card structs.
struct MileageMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary cards (web 4 MetricCards: Total-Distance/Drives/Daily-Avg/Annual-Projection)

/// The four summary cards (web Total-Distance, Total-Drives, Daily-Avg-30d, Annual-Projection). SI
/// meters convert to the user's distance unit at the boundary; counts render as integers. Values
/// fall back to zero when stats is momentarily absent (web `stats?.x ?? 0`).
struct MileageSummarySection: View {
    let stats: MileageStats?
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    private var lifetimeM: Double {
        stats?.lifetimeDistanceM ?? 0
    }

    private var drives: Int {
        stats?.driveCountLifetime ?? 0
    }

    private var dailyAverageM: Double {
        stats?.dailyAverageM ?? 0
    }

    private var annualProjectionM: Double {
        stats?.annualProjectionM ?? 0
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            MileageMetricCard(
                title: "mileage.totalDistance",
                value: MileageFormat.distanceIntLabel(lifetimeM, units),
                systemImage: "gauge.with.dots.needle.bottom.50percent",
                tone: .accent
            )
            MileageMetricCard(
                title: "mileage.totalDrives",
                value: MileageFormat.integer(Double(drives)),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .success
            )
            MileageMetricCard(
                title: "mileage.dailyAvg",
                value: MileageFormat.distanceLabel(dailyAverageM, units),
                systemImage: "calendar",
                tone: .info
            )
            MileageMetricCard(
                title: "mileage.annualProjection",
                value: MileageFormat.distanceIntLabel(annualProjectionM, units),
                systemImage: "chart.bar.fill",
                tone: .accent
            )
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Monthly summary (web GlassPanel7 — Monthly-Summary DataTable, or empty)

/// The monthly-summary panel (web GlassPanel7): a sortable, adaptive `DataTable` of month, distance,
/// drives, and distance-per-drive — or a no-entries empty state. Distances convert from SI meters to
/// the user's distance unit at this boundary; the unit lives in the column header (web
/// `${t('Distance')} (${distanceUnit})`).
struct MileageMonthlySummarySection: View {
    let rows: [MileageMonthPoint]
    let units: UnitPreferences

    private var distanceHeader: LocalizedStringKey {
        "\(String(localized: "Distance")) (\(units.distance))"
    }

    private var perDriveHeader: LocalizedStringKey {
        "\(String(localized: "Distance per Drive")) (\(units.distance))"
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("Monthly Summary")
                if rows.isEmpty {
                    TSEmptyState(title: "No Entries", systemImage: "calendar")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    TSDataTable(rows: rows, columns: columns, density: .compact)
                        .accessibilityLabel(Text("Monthly Summary"))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var columns: [TSColumn<MileageMonthPoint>] {
        [
            TSColumn(
                id: "month",
                title: "Month",
                comparator: { Self.compare($0.yearMonth, $1.yearMonth) },
                cell: { row in Text(verbatim: row.yearMonth) }
            ),
            TSColumn(
                id: "distance",
                title: distanceHeader,
                comparator: { Self.compare($0.totalDistanceM, $1.totalDistanceM) },
                cell: { row in Text(verbatim: MileageFormat.distanceNumber(row.totalDistanceM, units)) }
            ),
            TSColumn(
                id: "drives",
                title: "Drives",
                comparator: { Self.compare(Double($0.driveCount), Double($1.driveCount)) },
                cell: { row in Text(verbatim: MileageFormat.integer(Double(row.driveCount))) }
            ),
            TSColumn(
                id: "perDrive",
                title: perDriveHeader,
                comparator: { Self.compare($0.distancePerDriveM, $1.distancePerDriveM) },
                cell: { row in Text(verbatim: MileageFormat.distanceNumber(row.distancePerDriveM, units)) }
            )
        ]
    }

    private static func compare(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs < rhs { return .orderedAscending }
        if lhs > rhs { return .orderedDescending }
        return .orderedSame
    }

    private static func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
        lhs.compare(rhs)
    }
}

// MARK: - Loading skeleton (web isLoading Skeletons)

/// Mirrors the page layout while the primary source loads (web `isLoading` skeleton cards + panels):
/// the four summary cards → the odometer panel → the daily-distance panel → the monthly table, all
/// under SwiftUI redaction (the manifest's `loading → redacted(reason:)`).
struct MileageSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)],
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 84)
                }
            }
            skeletonBlock(height: 280)
            skeletonBlock(height: 280)
            skeletonBlock(height: 220)
        }
        .mileageRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("mileage.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func mileageRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}

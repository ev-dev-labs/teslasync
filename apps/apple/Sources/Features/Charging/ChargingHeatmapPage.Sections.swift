import SwiftUI

// The Charging Patterns sections (web `ChargingHeatmapPage.tsx`): the four summary stat panels
// (GlassPanel1–4), the Favorite-Charging-Time panel (GlassPanel5), the weekly day×hour heatmap
// grid + legend (GlassPanel6), and the Top-Charging-Locations panel (GlassPanel7), plus the
// loading skeleton. Each panel renders its own empty state (never a blank region), exactly as
// the web page always shows the body. SI watt-hours / seconds convert to the page's fixed kWh /
// minute display units at this boundary via the shared `Units` facade (ADR-005).

// MARK: - Summary stats (web GlassPanel1–4 — the four stat cards)

/// The four summary panels (web's first `StaggerContainer` of `GlassPanel`s): Total Sessions,
/// Total Energy (kWh), Total Cost, and Avg Duration (min). They always render; a nil `stats`
/// (no sessions) shows zeros exactly like the web `stats?.count ?? 0`.
struct ChargingHeatmapStatsSection: View {
    let stats: ChargingHeatmapStats?
    let isCompact: Bool

    private var columns: [GridItem] {
        // Web `grid-cols-2 lg:grid-cols-4` — two columns on compact, four on regular width.
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: count)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ChargingHeatmapStatPanel(
                title: "charging.heatmap.totalSessions",
                valueText: ChargingHeatmapFormat.int(Double(stats?.count ?? 0)),
                tone: .accent
            )
            ChargingHeatmapStatPanel(
                title: "charging.heatmap.totalEnergy",
                valueText: ChargingHeatmapFormat.number(totalEnergyKwh, decimals: 1),
                unit: ChargingHeatmapFormat.energyUnit,
                tone: .success
            )
            ChargingHeatmapStatPanel(
                title: "charging.heatmap.totalCost",
                valueText: TSCurrency.format(stats?.totalCost ?? 0, code: "USD"),
                tone: .info
            )
            ChargingHeatmapStatPanel(
                title: "charging.heatmap.avgDuration",
                valueText: ChargingHeatmapFormat.int(avgDurationMinutes),
                unit: ChargingHeatmapFormat.durationUnit,
                tone: .neutral
            )
        }
    }

    /// Web `fmtNumber(totalEnergy, 1) kWh` — the SI watt-hour total converted to kWh at the
    /// render boundary (web forces kWh via `convertEnergyFromSI(_, 'kWh')`).
    private var totalEnergyKwh: Double {
        Units.convertEnergy(stats?.totalEnergyWh ?? 0, ChargingHeatmapFormat.kwhPreferences)
    }

    /// Web `fmtInt(avgDuration) min` — the SI seconds average converted to minutes at the
    /// render boundary (web forces minutes via `durationMinutes`).
    private var avgDurationMinutes: Double {
        Units.convertDuration(stats?.avgDurationSeconds ?? 0, ChargingHeatmapFormat.minutesPreferences)
    }
}

/// One summary panel (web `GlassPanel` stat card): a muted label over a large value with an
/// optional unit suffix. A subtle tone border stands in for the web `glow` accent.
struct ChargingHeatmapStatPanel: View {
    let title: LocalizedStringKey
    let valueText: String
    var unit: String?
    var tone: TSTone = .accent

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(title)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: valueText)
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let unit {
                        Text(verbatim: unit)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(tone.color.opacity(tone == .neutral ? 0 : 0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Favorite charging time (web GlassPanel5)

/// The Favorite-Charging-Time panel (web's cyan-bordered `GlassPanel`): the busiest
/// day-of-week × hour bucket with its session count, or — when no session has landed yet
/// (web `maxCount > 0` gate) — the no-data empty state, so the panel never renders blank.
struct ChargingHeatmapFavoriteSection: View {
    let grid: ChargingHeatGrid

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text("charging.heatmap.favorite")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                if grid.hasData {
                    favoriteValue
                } else {
                    TSEmptyState(title: "common.noData", systemImage: "calendar")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    /// Web `{DAYS[favDay]}s at {favHour}:00 ({maxCount} sessions)`.
    private var favoriteValue: some View {
        let dayName = ChargingHeatmapWeekday.shortLabel(grid.favDay)
        let hourLabel = ChargingHeatmapFormat.hourLabel(grid.favHour)
        let valueFormat = String(
            localized: "charging.heatmap.favoriteValue",
            defaultValue: "%1$@s at %2$@"
        )
        let sessionsFormat = String(
            localized: "charging.heatmap.favoriteSessions",
            defaultValue: "(%lld sessions)"
        )
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: String(format: valueFormat, dayName, hourLabel))
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: String(format: sessionsFormat, grid.maxCount))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Weekly heatmap grid (web GlassPanel6)

/// The Weekly-Charging-Heatmap panel (web `GlassPanel`): the title, a 7×24 day-of-week × hour
/// grid of intensity cells (web `heatColor`), and the Less→More legend. The grid scrolls
/// horizontally when it can't fit (web `overflow-x-auto`); empty cells still render so the
/// structure is always visible.
struct ChargingHeatmapGridSection: View {
    let grid: ChargingHeatGrid
    let isCompact: Bool

    private let cellWidth: CGFloat = 16
    private let cellHeight: CGFloat = 22
    private let dayLabelWidth: CGFloat = 40

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.heatmap.gridTitle")
                ScrollView(.horizontal, showsIndicators: !isCompact) {
                    gridBody
                }
                legend
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("charging.heatmap.gridTitle"))
    }

    private var gridBody: some View {
        Grid(horizontalSpacing: 2, verticalSpacing: 2) {
            GridRow {
                Color.clear.frame(width: dayLabelWidth, height: 1)
                ForEach(0 ..< 24, id: \.self) { hour in
                    Text(verbatim: "\(hour)")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(width: cellWidth)
                }
            }
            ForEach(0 ..< 7, id: \.self) { day in
                GridRow {
                    Text(verbatim: ChargingHeatmapWeekday.shortLabel(day))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .frame(width: dayLabelWidth, alignment: .leading)
                    ForEach(0 ..< 24, id: \.self) { hour in
                        cell(day: day, hour: hour)
                    }
                }
            }
        }
    }

    private func cell(day: Int, hour: Int) -> some View {
        let value = grid.cell(day: day, hour: hour)
        let tier = ChargingHeatTier.tier(count: value.count, max: grid.maxCount)
        let label = value.hasCharging
            ? Text(verbatim: description(day: day, hour: hour, cell: value))
            : Text(verbatim: "")
        return RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(tier.color)
            .frame(width: cellWidth, height: cellHeight)
            .overlay(
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .strokeBorder(Color.TS.border.opacity(0.5), lineWidth: 0.5)
            )
            .help(label)
            .accessibilityLabel(label)
            .accessibilityHidden(!value.hasCharging)
    }

    /// Web cell tooltip `{DAYS[day]} {hour}:00 / {count} sessions · {energy} kWh`.
    private func description(day: Int, hour: Int, cell: ChargingHeatCell) -> String {
        let kwh = Units.convertEnergy(cell.energyWh, ChargingHeatmapFormat.kwhPreferences)
        let format = String(
            localized: "charging.heatmap.cellAccessibility",
            defaultValue: "%1$@ at %2$@, %3$lld sessions, %4$@ kWh"
        )
        return String(
            format: format,
            ChargingHeatmapWeekday.shortLabel(day),
            ChargingHeatmapFormat.hourLabel(hour),
            cell.count,
            ChargingHeatmapFormat.number(kwh, decimals: 1)
        )
    }

    /// Web legend: "Less" then the five intensity swatches then "More".
    private var legend: some View {
        HStack(spacing: TSSpacing.xs) {
            Text("charging.heatmap.less")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            ForEach(ChargingHeatTier.allCases, id: \.rawValue) { tier in
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(tier.color)
                    .frame(width: 22, height: 12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 2, style: .continuous)
                            .strokeBorder(Color.TS.border.opacity(0.5), lineWidth: 0.5)
                    )
            }
            Text("charging.heatmap.more")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("charging.heatmap.less") + Text(verbatim: " — ") + Text("charging.heatmap.more"))
    }
}

// MARK: - Top charging locations (web GlassPanel7)

/// The Top-Charging-Locations panel (web `GlassPanel`): the title over the horizontal bar chart
/// of the busiest places, or the no-data empty state when fewer than two sessions share a place
/// (web `locationData.length > 0 ? <BarChart/> : <EmptyState/>`).
struct ChargingHeatmapLocationsSection: View {
    let locations: [ChargingLocation]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.heatmap.topLocations")
                if locations.isEmpty {
                    TSEmptyState(title: "common.noData", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    ChargingHeatmapLocationsChart(locations: locations)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading skeleton (web Skeleton loading state)

/// Mirrors the page layout while the source loads (web `loading` → `Skeleton`): the four-up stat
/// blocks plus the heatmap block under SwiftUI redaction (the manifest's
/// `loading → redacted(reason:)`).
struct ChargingHeatmapSkeleton: View {
    private let columns = Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: 2)

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    skeletonBlock(height: 80)
                }
            }
            skeletonBlock(height: 320)
        }
        .chargingHeatmapRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("charging.heatmap.title"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies skeleton redaction while `loading`, matching the web Skeleton loading state (the
    /// manifest's `loading → redacted(reason:)` requirement).
    func chargingHeatmapRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}

// MARK: - Heat tier colour + localized weekday labels

extension ChargingHeatTier {
    /// The five-step heat ramp colour (web `heatColor` rgba steps: faint-cyan → cyan → green →
    /// amber → red). A data-visualisation ramp, mapped from the brand status palette.
    var color: Color {
        switch self {
        case .none: Color.TS.accent.opacity(0.06)
        case .low: Color.TS.accent.opacity(0.20)
        case .medium: Color.TS.statusSuccess.opacity(0.45)
        case .high: Color.TS.statusWarning.opacity(0.60)
        case .peak: Color.TS.statusDanger.opacity(0.80)
        }
    }
}

/// Localized short weekday labels indexed 0 = Sunday … 6 = Saturday (web `DAYS`), sourced from
/// the calendar's locale symbols so no day name is hardcoded.
enum ChargingHeatmapWeekday {
    static func shortLabel(_ day: Int, calendar: Calendar = .current) -> String {
        let symbols = calendar.shortWeekdaySymbols
        guard symbols.indices.contains(day) else { return "" }
        return symbols[day]
    }
}

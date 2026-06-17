import SwiftUI

// The Estimated-Annual-Cost panel (web GlassPanel6) and the Service-Projections panel (web
// GlassPanel10), laid out as an adaptive two-up row. Each panel renders its own empty state (web
// per-panel `EmptyState`), never a blank region. Costs format with the currency symbol at the boundary.

// MARK: - Cost / projections row (web grid lg:grid-cols-2)

/// The two cost/projection panels side-by-side on regular width, stacked on compact width.
struct MaintenanceCostRow: View {
    let costStats: MaintenanceCostStats?
    let projections: [MaintenanceServiceProjection]
    let currencySymbol: String

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isCompact: Bool {
            horizontalSizeClass == .compact
        }
    #else
        private var isCompact: Bool {
            false
        }
    #endif

    var body: some View {
        Group {
            if isCompact {
                VStack(spacing: TSSpacing.lg) { panels }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) { panels }
            }
        }
    }

    @ViewBuilder
    private var panels: some View {
        MaintenanceCostPanel(costStats: costStats, currencySymbol: currencySymbol)
            .frame(maxWidth: .infinity, alignment: .leading)
        MaintenanceProjectionsPanel(projections: projections)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Estimated Annual Cost (web GlassPanel6)

/// The Estimated-Annual-Cost panel (web GlassPanel6): the three cost MetricCards (Total-Spent /
/// Annual-Est / Avg-Service) plus the EV-savings note, or a no-cost-data empty state.
struct MaintenanceCostPanel: View {
    let costStats: MaintenanceCostStats?
    let currencySymbol: String

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.sm)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Label("Estimated Annual Cost", systemImage: "dollarsign.circle.fill")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .labelStyle(.titleAndIcon)
                if let costStats {
                    cards(costStats)
                    TSInlineCallout(
                        tone: .success,
                        message: "EV maintenance is typically 40-60% cheaper than a comparable gas vehicle."
                    )
                } else {
                    TSEmptyState(
                        title: "No cost data available yet. Log service records to see cost estimates.",
                        systemImage: "dollarsign.circle"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func cards(_ stats: MaintenanceCostStats) -> some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
            MaintenanceCostCard(
                title: "Total Spent",
                value: MaintenanceFormat.currency(stats.totalCost, symbol: currencySymbol),
                tone: .success
            )
            MaintenanceCostCard(
                title: "Annual Est.",
                value: MaintenanceFormat.annualCurrency(stats.annualCost, symbol: currencySymbol),
                tone: .accent
            )
            MaintenanceCostCard(
                title: "Avg / Service",
                value: MaintenanceFormat.currency(stats.avgPerService, symbol: currencySymbol),
                tone: .info
            )
        }
    }
}

/// One tinted cost metric (web cost `MetricCard` with its `color` prop — value colored, no icon).
struct MaintenanceCostCard: View {
    let title: LocalizedStringKey
    let value: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSMetricLabel(title)
                Text(verbatim: value)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(tone.color)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Service Projections (web GlassPanel10)

/// The Service-Projections panel (web GlassPanel10): a list of upcoming services (name, miles-remaining,
/// due date, status badge), or a no-projections empty state.
struct MaintenanceProjectionsPanel: View {
    let projections: [MaintenanceServiceProjection]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Label("Service Projections", systemImage: "chart.line.uptrend.xyaxis")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .labelStyle(.titleAndIcon)
                if projections.isEmpty {
                    TSEmptyState(
                        title: "No upcoming service projections available.",
                        systemImage: "calendar.badge.clock"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    VStack(spacing: TSSpacing.sm) {
                        ForEach(projections) { projection in
                            MaintenanceProjectionRow(projection: projection)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One projection row (web projection line: wrench + name | miles-remaining + due date + status badge).
struct MaintenanceProjectionRow: View {
    let projection: MaintenanceServiceProjection

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "wrench.fill").font(.caption2).foregroundStyle(Color.TS.accent)
            Text(verbatim: projection.name)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            if let miles = projection.milesRemaining {
                Text(verbatim: MaintenanceFormat.mileageLabel(miles))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            if let dueDate = projection.dueDate {
                Text(verbatim: MaintenanceFormat.date(dueDate))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            TSBadge(projection.status.labelKey, tone: projection.status.tone)
        }
        .accessibilityElement(children: .combine)
    }
}

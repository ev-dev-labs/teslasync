import SwiftUI

// The summary metric cards (web Total-Items / Due-Soon / Overdue / Completed), the filter / sort /
// Schedule toolbar, and the loading skeleton for the Maintenance surface. Page-local card struct
// mirrors the sibling analytics pages; values render at the display boundary. Each section renders its
// own content (never a blank region).

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled summary metric with a tinted SF Symbol (web `MetricCard` with its `color` prop).
/// Composes the shared `TSCard` + `TSIconBox` + typography so the per-card accent matches the web hue.
struct MaintenanceMetricCard: View {
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

// MARK: - Summary cards (web GlassPanel1 — 4 MetricCards: Total-Items/Due-Soon/Overdue/Completed)

/// The four summary cards reduced from the items' statuses (web summary grid). Counts render as
/// integers; values fall back to zero when items is momentarily empty.
struct MaintenanceSummarySection: View {
    let summary: MaintenanceSummary

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            MaintenanceMetricCard(
                title: "Total Items",
                value: MaintenanceFormat.integer(Double(summary.total)),
                systemImage: "checklist",
                tone: .accent
            )
            MaintenanceMetricCard(
                title: "Due Soon",
                value: MaintenanceFormat.integer(Double(summary.soon)),
                systemImage: "clock",
                tone: .warning
            )
            MaintenanceMetricCard(
                title: "Overdue",
                value: MaintenanceFormat.integer(Double(summary.overdue)),
                systemImage: "exclamationmark.triangle",
                tone: .danger
            )
            MaintenanceMetricCard(
                title: "Completed",
                value: MaintenanceFormat.integer(Double(summary.completed)),
                systemImage: "checkmark.circle",
                tone: .success
            )
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Toolbar (web Filter / Sort selects + Schedule Maintenance button)

/// The category-filter + sort selects and the Schedule action (web filter/sort toolbar). The Schedule
/// affordance delegates to the host booking flow (the web handler is a no-op); parity is the labeled
/// control. Reflows to a column on compact width.
struct MaintenanceToolbar: View {
    @Binding var categoryFilter: String
    @Binding var sortKey: MaintenanceSortKey
    let categories: [String]
    let onSchedule: () -> Void

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

    private var categoryOptions: [TSSelectOption<String>] {
        [TSSelectOption(MaintenancePageModel.allCategories, "All Categories")]
            + categories.map { TSSelectOption($0, LocalizedStringKey(MaintenanceFormat.capitalized($0))) }
    }

    private var sortOptions: [TSSelectOption<MaintenanceSortKey>] {
        MaintenanceSortKey.allCases.map { TSSelectOption($0, $0.titleKey) }
    }

    var body: some View {
        Group {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) { controls }
            } else {
                HStack(alignment: .center, spacing: TSSpacing.md) { controls }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSSelect(selection: $categoryFilter, options: categoryOptions)
                .accessibilityLabel(Text("Category"))
        }
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "arrow.up.arrow.down")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSSelect(selection: $sortKey, options: sortOptions)
                .accessibilityLabel(Text("Sort"))
        }
        if !isCompact { Spacer(minLength: TSSpacing.sm) }
        TSButton(variant: .primary, size: .small, action: onSchedule) {
            Label("Schedule Maintenance", systemImage: "calendar.badge.plus")
        }
    }
}

// MARK: - Loading skeleton (web isLoading Skeletons)

/// Mirrors the page layout while the primary source loads (web `isLoading` skeleton cards + panels):
/// the four summary cards → the items grid → the cost/projections row → the records table, under
/// SwiftUI redaction (the manifest's `loading → redacted(reason:)`).
struct MaintenanceSkeleton: View {
    private let summaryColumns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]
    private let itemColumns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: summaryColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in skeletonBlock(height: 96) }
            }
            LazyVGrid(columns: itemColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 6, id: \.self) { _ in skeletonBlock(height: 168) }
            }
            skeletonBlock(height: 220)
        }
        .redacted(reason: .placeholder) // parity:allow SwiftUI redaction API (loading skeleton), not a stub
        .accessibilityElement()
        .accessibilityLabel(Text("Maintenance"))
        .accessibilityHint(Text("loading"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

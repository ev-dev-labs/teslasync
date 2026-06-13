import SwiftUI

// Section subviews for `AutomationsListPage` (web `AutomationsListPage.tsx` regions):
// the four stat tiles, the filters panel (GlassPanel5), the auto-disabled warning banner, the
// collapsible preset gallery panel (GlassPanel6), the automation card list (GlassPanel7), and
// the embedded activity feed. Token-driven; every string resolves from `Localizable.xcstrings`.

// MARK: - Stats tiles (web StatCards: Total / Active / Disabled / Auto-Disabled)

/// One header stat tile, composed from the shared card + icon-box + metric primitives so it
/// carries the web's per-status icon tint (and the auto-disabled danger emphasis).
struct AutomationStatTile: View {
    let labelKey: LocalizedStringKey
    let value: Int
    let systemImage: String
    let tone: TSTone
    var emphasized = false

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    TSMetricLabel(labelKey)
                    Spacer()
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSAnimatedNumber(formatted: "\(value)")
            }
        }
        .overlay {
            if emphasized {
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.4), lineWidth: 1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(labelKey))
        .accessibilityValue(Text(verbatim: "\(value)"))
    }
}

/// The four-up stat grid (web `grid grid-cols-2 sm:grid-cols-4`).
struct AutomationsListStatsSection: View {
    let stats: AutomationListStats
    let isCompact: Bool

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            AutomationStatTile(
                labelKey: "automations.stats.total",
                value: stats.total,
                systemImage: "line.3.horizontal.decrease",
                tone: .neutral
            )
            AutomationStatTile(
                labelKey: "automations.stats.active",
                value: stats.active,
                systemImage: "power",
                tone: .success
            )
            AutomationStatTile(
                labelKey: "automations.stats.disabled",
                value: stats.disabled,
                systemImage: "pause.fill",
                tone: .neutral
            )
            AutomationStatTile(
                labelKey: "automations.stats.autoDisabled",
                value: stats.autoDisabled,
                systemImage: "shield.slash.fill",
                tone: .danger,
                emphasized: stats.hasAutoDisabled
            )
        }
    }

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }
}

// MARK: - Filters panel (GlassPanel5)

/// The status filter select + search field + active-filter count badge (web filters panel).
struct AutomationsListFiltersPanel: View {
    @Binding var statusFilter: AutomationStatusFilter
    @Binding var search: String
    let showsCount: Bool
    let countText: String
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.sm) { controls }
            } else {
                HStack(spacing: TSSpacing.md) { controls }
            }
        }
    }

    @ViewBuilder private var controls: some View {
        TSSelect(
            selection: $statusFilter,
            options: AutomationStatusFilter.allCases.map {
                TSSelectOption($0, LocalizedStringKey($0.labelKey))
            }
        )
        .frame(maxWidth: isCompact ? .infinity : 200, alignment: .leading)
        .accessibilityLabel(Text("automations.filterStatus"))

        TSTextField("automations.search", text: $search)
            .frame(maxWidth: isCompact ? .infinity : 280)

        if showsCount {
            TSBadge(LocalizedStringKey(stringLiteral: countText), tone: .neutral)
        }
        if !isCompact { Spacer(minLength: 0) }
    }
}

// MARK: - Auto-disabled warning banner (web red banner)

/// The banner shown when one or more automations are auto-disabled (web warning row).
struct AutomationsListWarningBanner: View {
    let count: Int

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 16))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }

    private var message: String {
        String(format: String(localized: "automations.autoDisabledWarning"), count)
    }
}

// MARK: - Cards list (GlassPanel7)

/// The automation card list / empty / no-match region (web cards branch).
struct AutomationsListCardsSection: View {
    let model: AutomationsListPageModel

    var body: some View {
        switch model.cardsState {
        case .success:
            TSStaggerContainer(spacing: TSSpacing.md) {
                ForEach(Array(model.sortedItems.enumerated()), id: \.element.id) { index, item in
                    TSStaggerItem(index: index) {
                        card(for: item)
                    }
                }
            }
        case .empty:
            TSGlassPanel {
                TSEmptyState(
                    title: "automations.empty",
                    systemImage: "bolt.badge.automatic"
                ) {
                    TSButton("automations.empty.cta", size: .small) {}
                }
                .frame(maxWidth: .infinity)
            }
        case .noMatch:
            TSGlassPanel {
                TSEmptyState(
                    title: "automations.noMatch",
                    systemImage: "bolt.badge.automatic"
                ) {
                    TSButton("automations.noMatch.cta", variant: .secondary, size: .small) {
                        model.resetFilters()
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func card(for item: AutomationListItem) -> some View {
        AutomationCardView(
            item: item,
            vehicleName: model.vehicleName(for: item),
            isFiring: model.isFiring(item),
            isPinned: model.isPinned(item),
            onToggle: { newValue in Task { await model.toggle(item, to: newValue) } },
            onTestRun: { Task { await model.testRun(item) } },
            onReEnable: { Task { await model.reEnable(item) } },
            onDelete: { Task { await model.delete(item) } },
            onTogglePin: { model.togglePin(item) }
        )
    }
}

// MARK: - Embedded activity feed (web `<AutomationActivityFeed/>`)

/// The execution-activity feed the page renders below the cards (web `AutomationActivityFeed`),
/// reusing the sibling unit's row components + the bound feed state.
struct AutomationsListActivitySection: View {
    let model: AutomationsListPageModel
    let isCompact: Bool

    private static let skeletonRowCount = 5

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                liveEvents
                history
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("automations.recentActivity"))
    }

    @ViewBuilder private var header: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                titleGroup
                if let stats = model.activityStats { AutomationActivityStatsRow(stats: stats) }
            }
        } else {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                titleGroup
                Spacer(minLength: TSSpacing.sm)
                if let stats = model.activityStats { AutomationActivityStatsRow(stats: stats) }
            }
        }
    }

    private var titleGroup: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text("automations.recentActivity")
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            AutomationActivityConnectionChip(connection: model.activityConnection)
        }
    }

    @ViewBuilder private var liveEvents: some View {
        if !model.activityLiveEvents.isEmpty {
            VStack(spacing: TSSpacing.xs) {
                ForEach(model.activityLiveEvents) { event in
                    AutomationActivityLiveRow(event: event)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }

    @ViewBuilder private var history: some View {
        switch model.activityState {
        case .loading:
            VStack(spacing: TSSpacing.xs) {
                ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                    TSSkeleton(height: 36, cornerRadius: TSRadius.sm)
                }
            }
            .accessibilityLabel(Text("automations.activityFeed.loading"))
        case .success:
            VStack(spacing: 2) {
                ForEach(model.activityRuns) { run in
                    AutomationActivityRunRow(run: run)
                }
            }
        case .empty:
            TSEmptyState(title: "automations.noHistory", systemImage: "waveform.path.ecg")
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.md)
        }
    }
}

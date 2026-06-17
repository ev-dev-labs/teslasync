//
//  CommandHistoryPageViews.swift
//  TeslaSync — P4 feature view · P7 · system/CommandHistory (Apple) — Section Views
//
//  The populated-state sections of the command-history surface: the four stat cards
//  (web `StatCard` grid), the filters panel (web `GlassPanel` — status `TabNav` + search
//  `Input`), the command timeline (web `GlassPanel` — `Timeline` / `EmptyState`), and the
//  pagination control. Every visible string resolves from `Localizable.xcstrings` with the
//  web key names; all chrome uses the P2 design tokens (ADR-005/014). Adaptive across
//  macOS (regular) and iPhone (compact) via the injected column count.
//

import SwiftUI

// MARK: - Section 1: Stats grid (web `StatCard` grid — panels 1–4)

/// The four headline stat cards computed from the full history (web `stats` memo):
/// Commands-24h, Success-Rate, Most-Used, Last-Sent.
struct CommandHistoryStatsGrid: View {
    let stats: CommandHistoryStats
    let columns: Int

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: columns)
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "commandHistory.total24h",
                value: "\(stats.total24h)",
                systemImage: "terminal"
            )
            TSStatCard(
                title: "commandHistory.successRate",
                value: "\(stats.successRate)%",
                systemImage: "chart.line.uptrend.xyaxis"
            )
            TSStatCard(
                title: "commandHistory.mostUsed",
                value: stats.mostUsed.map(CommandHistoryFormat.commandName) ?? CommandHistoryFormat.emptyValue,
                systemImage: "rosette"
            )
            TSStatCard(
                title: "commandHistory.lastSent",
                value: stats.lastCommand.map { CommandHistoryFormat.relative($0.createdAt) }
                    ?? CommandHistoryFormat.emptyValue,
                systemImage: "clock"
            )
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Section 2: Filters panel (web `GlassPanel` — status tabs + search, panel 5)

/// The status `TabNav` + command search box (web filters `GlassPanel`).
struct CommandHistoryFiltersPanel: View {
    @Bindable var model: CommandHistoryPageModel
    let isCompact: Bool

    private var statusBinding: Binding<CommandHistoryStatusFilter> {
        Binding(get: { model.statusFilter }, set: { model.statusChanged(to: $0) })
    }

    private var statusTabs: [TSTab<CommandHistoryStatusFilter>] {
        CommandHistoryStatusFilter.allCases.map {
            TSTab($0, $0.titleKey, systemImage: $0.systemImage)
        }
    }

    var body: some View {
        TSGlassPanel {
            adaptiveStack {
                TSTabs(selection: statusBinding, tabs: statusTabs)
                if !isCompact { Spacer(minLength: TSSpacing.md) }
                CommandHistorySearchField(model: model)
                    .frame(maxWidth: isCompact ? .infinity : 240)
            }
        }
    }

    @ViewBuilder
    private func adaptiveStack(@ViewBuilder content: () -> some View) -> some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md, content: content)
        } else {
            HStack(alignment: .center, spacing: TSSpacing.md, content: content)
        }
    }
}

/// Search input with a leading glyph + a trailing pending spinner (web search `Input` with
/// the `useDeferredValue` `isSearchPending` indicator).
struct CommandHistorySearchField: View {
    @Bindable var model: CommandHistoryPageModel

    private var queryBinding: Binding<String> {
        Binding(get: { model.searchQuery }, set: { model.searchChanged(to: $0) })
    }

    private var prompt: String {
        String(
            localized: "commandHistory.searchPlaceholder", // parity:allow web i18n key name
            defaultValue: "Search commands…"
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            TextField(prompt, text: queryBinding)
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(
                    Text("commandHistory.searchCommands")
                )
            if model.isSearchPending {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(Text("filter.pending"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Section 3: Timeline panel (web `GlassPanel` — Timeline / EmptyState, panel 6)

/// The command timeline panel: a header (title + "{count} commands") over the paginated
/// `Timeline`, or the filter-aware `EmptyState` when nothing matches.
struct CommandHistoryTimelinePanel: View {
    let model: CommandHistoryPageModel

    private var timelineEntries: [TSTimelineEntry] {
        model.paginated.map { entry in
            TSTimelineEntry(
                id: "\(entry.id)",
                title: LocalizedStringKey(CommandHistoryFormat.commandName(entry.command)),
                detail: LocalizedStringKey(CommandHistoryFormat.subtitle(for: entry)),
                timestamp: CommandHistoryFormat.relative(entry.createdAt),
                tone: entry.isSuccess ? .success : .danger,
                systemImage: entry.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill"
            )
        }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "clock.arrow.circlepath")
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    TSPanelTitle("commandHistory.timelineTitle")
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: CommandHistoryFormat.showing(count: model.filtered.count))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }

                if model.filtered.isEmpty {
                    emptyState
                } else {
                    TSTimeline(entries: timelineEntries)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var emptyState: some View {
        TSEmptyState(
            title: model.hasActiveFilters
                ? "commandHistory.noFilterResults"
                : "commandHistory.noCommands",
            systemImage: "clock.arrow.circlepath"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Section 4: Pagination (web `Pagination`)

/// The page control shown when the filtered list exceeds one page (web
/// `filtered.length > PAGE_SIZE`). Bridges the model's 1-based page to the 0-based control.
struct CommandHistoryPaginationBar: View {
    @Bindable var model: CommandHistoryPageModel

    private var pageCount: Int {
        max(1, Int(ceil(Double(model.filtered.count) / Double(CommandHistoryPageModel.pageSize))))
    }

    private var pageBinding: Binding<Int> {
        Binding(get: { model.page - 1 }, set: { model.page = $0 + 1 })
    }

    var body: some View {
        HStack {
            Spacer()
            TSPagination(currentPage: pageBinding, pageCount: pageCount)
        }
    }
}

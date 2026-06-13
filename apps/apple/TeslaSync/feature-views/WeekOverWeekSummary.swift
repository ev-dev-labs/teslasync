//
//  WeekOverWeekSummary.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  The composed weekly-digest "Week-over-Week Comparison" surface — the SwiftUI parity
//  of features/analytics/components/weekly-digest/WeekOverWeekSummary.tsx. The web
//  source is a `FadeIn`-wrapped `GlassPanel` with a "Week-over-Week Comparison" title
//  over a responsive 1/2/3-column grid of six `StatCard`s (Distance, Drives, Energy,
//  Cost, Efficiency, CO₂ Saved). This view reproduces that composition, binds through
//  `WeekOverWeekSummaryModel` (P1/S8 — no networking here), renders every state
//  (loading / empty / error / stale / offline / loaded), and localizes through
//  `WeekOverWeekStrings` (P1/S10).
//

import SwiftUI

/// The weekly-digest "Week-over-Week Comparison" feature view. Holds the bound
/// `WeekOverWeekSummaryModel`, drives the responsive six-tile grid, and surfaces the
/// connectivity/freshness chrome.
public struct WeekOverWeekSummary: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WeekOverWeekSurface.slug

    @State private var model: WeekOverWeekSummaryModel

    /// Designated initializer — inject a model bound to a source (production app) or an
    /// `InMemoryWeekOverWeekSource` (previews/tests).
    public init(model: WeekOverWeekSummaryModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer over a bare `WeekOverWeekSource`.
    public init(
        source: any WeekOverWeekSource,
        telemetry: any WeekOverWeekTelemetry = OSLogWeekOverWeekTelemetry(),
        formatting: WeekOverWeekFormatting = .standard
    ) {
        _model = State(initialValue: WeekOverWeekSummaryModel(
            source: source,
            telemetry: telemetry,
            formatting: formatting
        ))
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .task(id: model.isStale) { await autoRefreshIfStale() }
            .accessibilityElement(children: .contain)
    }

    // MARK: Content states

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingPanel
        case .empty:
            emptyState
        case .failed:
            if model.hasCachedMetrics {
                comparisonPanel
            } else {
                errorState
            }
        case .loaded:
            comparisonPanel
        }
    }

    // MARK: Loaded panel (web `FadeIn` → `GlassPanel`)

    private var comparisonPanel: some View {
        TSFadeIn(delay: 0.3) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    header
                    degradedBanner
                    grid {
                        ForEach(model.items) { item in
                            WeekOverWeekStatTile(item: item).id(item.id)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: WeekOverWeekAccessibility.headerLabel())
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.isStale || model.isOffline {
                WeekOverWeekFreshnessChip(connection: model.connection)
                refreshButton
            }
        }
    }

    @ViewBuilder
    private var degradedBanner: some View {
        if model.phase == .failed {
            WeekOverWeekErrorBanner(onRetry: { model.refresh() })
        } else if model.isOffline {
            WeekOverWeekOfflineBanner()
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(WeekOverWeekStrings.key(WeekOverWeekKeys.refresh, "Refresh"))
        .accessibilityHint(WeekOverWeekStrings.key(WeekOverWeekKeys.refreshHint, "Re-pull the weekly digest"))
    }

    // MARK: Loading panel (initial-mount skeleton chrome)

    private var loadingPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSSkeleton(width: 200, height: 18)
                    .accessibilityHidden(true)
                grid {
                    ForEach(0 ..< 6, id: \.self) { index in
                        WeekOverWeekSkeletonTile().id(index)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityLabel(WeekOverWeekStrings.key(WeekOverWeekKeys.weekOverWeek, "Week-over-Week Comparison"))
    }

    // MARK: Empty + error states

    private var emptyState: some View {
        TSGlassPanel {
            TSEmptyState(
                title: WeekOverWeekStrings.key(WeekOverWeekKeys.noData, "No Data"),
                message: WeekOverWeekStrings.key(
                    WeekOverWeekKeys.noDataMessage,
                    "No driving or charging data found for this week."
                ),
                systemImage: "calendar"
            )
            .frame(maxWidth: .infinity)
        }
    }

    private var errorState: some View {
        TSGlassPanel {
            TSQueryError(onRetry: { model.refresh() })
                .frame(maxWidth: .infinity)
        }
    }

    // MARK: Responsive grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`)

    private func grid(@ViewBuilder content: @escaping () -> some View) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md, alignment: .top)],
            alignment: .leading,
            spacing: TSSpacing.md,
            content: content
        )
    }

    // MARK: Stale auto-refresh

    /// When the surface goes stale, nudge a single re-pull (the state matrix's
    /// "stale → auto-refresh"). Re-runs only on a fresh→stale transition via the
    /// `.task(id:)` identity, so it never loops.
    private func autoRefreshIfStale() async {
        guard model.isStale else { return }
        try? await Task.sleep(for: .seconds(0.5))
        if model.isStale {
            model.refresh()
        }
    }
}

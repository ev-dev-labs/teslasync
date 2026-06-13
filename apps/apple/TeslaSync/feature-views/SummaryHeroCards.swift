//
//  SummaryHeroCards.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  The composed weekly-digest "Week Summary" surface — the SwiftUI parity of
//  features/analytics/components/weekly-digest/SummaryHeroCards.tsx. The web source
//  is a `FadeIn`-wrapped `GlassPanel` with a "Week Summary" title over a responsive
//  1/2/3-column grid of `HighlightCard`s (Total Distance, Total Drives, Energy Used,
//  Charging Cost, CO₂ Saved, and an optional Fun Fact). This view reproduces that
//  composition, binds through `SummaryHeroCardsModel` (P1/S8 — no networking here),
//  renders every state (loading / empty / error / stale / offline / loaded), and
//  localizes through `SummaryHeroStrings` (P1/S10).
//

import SwiftUI

/// The weekly-digest "Week Summary" feature view. Holds the bound
/// `SummaryHeroCardsModel`, drives the responsive hero-card grid, and surfaces the
/// connectivity/freshness chrome.
public struct SummaryHeroCards: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SummaryHeroCards"

    @State private var model: SummaryHeroCardsModel

    /// Designated initializer — inject a model bound to a source (production app) or
    /// an `InMemorySummaryHeroSource` (previews/tests).
    public init(model: SummaryHeroCardsModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer over a bare `SummaryHeroSource`.
    public init(
        source: any SummaryHeroSource,
        telemetry: any SummaryHeroTelemetry = OSLogSummaryHeroTelemetry(),
        formatting: SummaryHeroFormatting = .standard
    ) {
        _model = State(initialValue: SummaryHeroCardsModel(
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
            if model.hasCachedSummary {
                summaryPanel
            } else {
                errorState
            }
        case .loaded:
            summaryPanel
        }
    }

    // MARK: Loaded panel (web `FadeIn` → `GlassPanel`)

    private var summaryPanel: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    header
                    degradedBanner
                    grid {
                        ForEach(model.items) { item in
                            SummaryHighlightCard(item: item).id(item.id)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: SummaryHeroAccessibility.summaryLabel())
                .font(Font.TS.section)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if model.isStale || model.isOffline {
                SummaryFreshnessChip(connection: model.connection)
                refreshButton
            }
        }
    }

    @ViewBuilder
    private var degradedBanner: some View {
        if model.phase == .failed {
            SummaryErrorBanner(onRetry: { model.refresh() })
        } else if model.isOffline {
            SummaryOfflineBanner()
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
        .accessibilityLabel(SummaryHeroStrings.key(SummaryHeroKeys.refresh, "Refresh"))
        .accessibilityHint(SummaryHeroStrings.key(SummaryHeroKeys.refreshHint, "Re-pull the weekly digest"))
    }

    // MARK: Loading panel (initial-mount skeleton chrome)

    private var loadingPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSSkeleton(width: 140, height: 18)
                    .accessibilityHidden(true)
                grid {
                    ForEach(0 ..< 6, id: \.self) { index in
                        SummaryHeroSkeletonCard().id(index)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityLabel(SummaryHeroStrings.key(SummaryHeroKeys.weekSummary, "Week Summary"))
    }

    // MARK: Empty + error states

    private var emptyState: some View {
        TSGlassPanel {
            TSEmptyState(
                title: SummaryHeroStrings.key(SummaryHeroKeys.noData, "No Data"),
                message: SummaryHeroStrings.key(
                    SummaryHeroKeys.noDataMessage,
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
            columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.lg, alignment: .top)],
            alignment: .leading,
            spacing: TSSpacing.lg,
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

//
//  RecentlyViewedWidget.swift
//  TeslaSync — P4 feature view · 0131 · RecentlyViewedWidget (Apple)
//
//  The dashboard "Recently Viewed" widget — the SwiftUI parity of
//  web/src/features/dashboard/components/RecentlyViewedWidget.tsx. A lightweight "back to
//  where I was" surface: a glass panel headed by a clock + "Recently Viewed", rendering
//  either the navigable list of recent pages or the non-actionable empty hint, all bound
//  through `RecentlyViewedModel` (P1/S8). The native build adds the P4 states-contract
//  chrome the web leaf does not carry (loading skeleton / error+retry / stale + offline
//  overlays over the offline-first cached recents). No store access lives here.
//

import SwiftUI

/// The dashboard "Recently Viewed" widget — the SwiftUI parity of
/// `features/dashboard/components/RecentlyViewedWidget.tsx`, binding through
/// `RecentlyViewedModel` (P1/S8). No store access lives here.
public struct RecentlyViewedWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RecentlyViewedDiagnostics.surface

    @State private var model: RecentlyViewedModel
    private let onSelect: (RecentlyViewedRow) -> Void

    /// - Parameters:
    ///   - model: the bound state holder (P1/S8). The production app constructs it over the
    ///     App-Group recents store; previews + tests use `InMemoryRecentlyViewedSource`.
    ///   - onSelect: navigation callback for a tapped row (the native analogue of the web
    ///     `<Link to={entry.path}>`). Navigation is the host's concern, not the widget's.
    public init(
        model: RecentlyViewedModel,
        onSelect: @escaping (RecentlyViewedRow) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onSelect = onSelect
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    header
                    if model.freshness != .fresh {
                        RecentlyViewedConnectivityBanner(freshness: model.freshness)
                    }
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web clock + "Recently Viewed" + freshness chip)

private extension RecentlyViewedWidget {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: RecentlyViewedStrings.string("recentPages.widgetTitle", "Recently Viewed"))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            RecentlyViewedFreshnessChip(freshness: model.freshness)
        }
    }
}

// MARK: - Body (web empty hint / list + native loading / error)

private extension RecentlyViewedWidget {
    @ViewBuilder
    func body(for phase: RecentlyViewedPhase) -> some View {
        switch phase {
        case .loading:
            RecentlyViewedLoadingView()
        case .data:
            list
        case .empty:
            RecentlyViewedEmptyView()
        case let .error(message):
            RecentlyViewedErrorView(message: message) { model.refresh() }
        }
    }

    /// The recent-pages list (web `<ul>`), each row navigable. A single `now` is captured per
    /// render so every row's relative label is computed against the same instant, exactly
    /// like the web reading `Date.now()` once per render pass.
    var list: some View {
        let now = Date()
        return VStack(spacing: 2) {
            ForEach(model.rows) { row in
                RecentlyViewedRowView(row: row, now: now, onSelect: onSelect)
            }
        }
    }
}

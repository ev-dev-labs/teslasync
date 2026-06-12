//
//  SignalQueryControls.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The Signal Query Controls panel — the SwiftUI parity of components/SignalQueryControls.tsx.
//  Reproduces the web source's composition (the signal multi-select, the From/To range + Quick-Range
//  presets, the rows-per-page select + "Query" action, and the paginated #/Timestamp/Signal/Value/Type
//  results table) plus the P4 leaf contract states (loading / empty / error / stale / offline). Binds
//  through `SignalQueryControlsModel` (P1/S8); no networking lives here. Every string resolves through
//  the P1/S10 facade and the chrome is token-driven (P1/S9) — no Tailwind ports, no raw hex.
//
//  States (every one renders — no hidden surface):
//    • loading — the available-signals fetch is in flight → skeleton chrome in the multi-select.
//    • empty   — the fetch resolved with no signals (or a query returned no rows) → friendly note.
//    • error   — a fetch failed → the `QueryError` peer with retry (inline for signals, in the table
//                for results).
//    • stale   — the available feed is stale → freshness chip + banner + a one-shot auto-refresh.
//    • offline — no connectivity → cached signals + offline chip/banner; the "Query" action disables.
//

import SwiftUI

// MARK: - SignalQueryControls (the surface)

/// The Signal Query Controls panel — the SwiftUI parity of `components/SignalQueryControls.tsx`,
/// rendering every state from the web source plus the P4 leaf states, binding through
/// `SignalQueryControlsModel`.
public struct SignalQueryControls: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalQueryControlsSurface.slug

    @State private var model: SignalQueryControlsModel
    private let timeZone: TimeZone

    public init(model: SignalQueryControlsModel, timeZone: TimeZone = .current) {
        _model = State(initialValue: model)
        self.timeZone = timeZone
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    SignalQueryConnectivityBanner(connection: model.connection)
                }
                SignalMultiSelectView(
                    availableState: model.availableState,
                    available: model.availableSignals,
                    selected: model.selected,
                    maxSignals: model.maxSignals,
                    onAdd: { model.addSignal($0) },
                    onRemove: { model.removeSignal($0) },
                    onRetry: { model.refresh() }
                )
                DateTimeRangeControlsView(
                    from: fromBinding,
                    to: toBinding,
                    activePresetHours: model.activePresetHours,
                    onPreset: { model.applyPreset(hours: $0) }
                )
                QueryControlsView(
                    perPage: perPageBinding,
                    disabled: model.queryDisabled,
                    loading: model.tableState == .loading,
                    onQuery: { model.runQuery() }
                )
                resultsSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    // MARK: Header (title + freshness chip + refresh)

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: SignalQueryControlsStrings.string("signalQuery.title", "Signal Query"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.md)
            SignalQueryFreshnessChip(connection: model.connection)
            refreshButton
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: SignalQueryControlsStrings.string(
            "signalQuery.refresh", "Refresh"
        )))
    }

    // MARK: Results (web `SignalDataTable`)

    private var resultsSection: some View {
        SignalDataTableView(
            state: model.tableState,
            rows: model.rows,
            pagination: model.pagination,
            timeZone: timeZone,
            onPageChange: { model.goToPage($0) },
            onRetry: { model.retryQuery() }
        )
    }

    // MARK: Bindings (manual so the surface keeps owning the model via `@State`)

    private var fromBinding: Binding<Date> {
        Binding(get: { model.from }, set: { model.from = $0 })
    }

    private var toBinding: Binding<Date> {
        Binding(get: { model.to }, set: { model.to = $0 })
    }

    private var perPageBinding: Binding<Int> {
        Binding(get: { model.perPage }, set: { model.perPage = $0 })
    }

    // MARK: Accessibility

    /// The VoiceOver summary — title, selected-signal count, freshness, and result status — built
    /// through the testable `SignalQueryAccessibility` seam so it is asserted without rendering.
    private var accessibilitySummary: String {
        SignalQueryAccessibility.summary(
            labels: SignalQueryAccessibility.Labels(
                title: SignalQueryControlsStrings.string("signalQuery.title", "Signal Query"),
                selectedSignals: SignalQueryControlsStrings.string("signalQuery.signals", "Signals"),
                live: SignalQueryControlsStrings.string("signalQuery.live", "Live"),
                stale: SignalQueryControlsStrings.string("signalQuery.stale", "Stale"),
                offline: SignalQueryControlsStrings.string("signalQuery.offline", "Offline"),
                loadingResults: SignalQueryControlsStrings.string(
                    "signalQuery.loadingResults", "Loading results"
                ),
                resultsError: SignalQueryControlsStrings.string("signalQuery.errorTitle", "Couldn't load"),
                records: SignalQueryControlsStrings.string("signalQuery.recordsWord", "records"),
                noResults: SignalQueryControlsStrings.string("signalQuery.noResults", "No results")
            ),
            selectedCount: model.selected.count,
            connection: model.connection,
            tableState: model.tableState,
            total: model.pagination.total
        )
    }
}

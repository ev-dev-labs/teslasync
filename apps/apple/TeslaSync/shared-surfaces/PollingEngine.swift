//
//  PollingEngine.swift
//  TeslaSync — P4 shared surface · 0098 · PollingEngine (Apple)
//
//  The adaptive-polling panel — the SwiftUI parity of
//  `web/src/components/data-display/PollingEngine.tsx` (the `PollingEnginePanel` default export). The
//  web component reads `getPollingStatus` (15 s) + `getPollingSavings` (30 s), renders `null` when
//  polling is disabled, and otherwise lays out a `GlassPanel`: a header (downtrend glyph + "Adaptive
//  Polling Engine" + an "Active" badge), the `SavingsCard` (four metrics + a stacked savings
//  breakdown bar + legend), and the per-vehicle activity list (expandable rows with interval /
//  consecutive-idle / battery / reasons / prediction), with a friendly message when no vehicle is
//  tracked yet. This surface reproduces that composition natively, bound through
//  `PollingEngineModel` (P1/S8); no networking lives here.
//
//  States (every non-withdrawn one renders — no hidden surface):
//    • disabled — polling off → renders nothing (web `!status.enabled → null`).
//    • loading  — the status read resolving → skeleton chrome.
//    • error    — the status read failed → a retryable error.
//    • ready    — the savings card + vehicle list (or the no-vehicles empty message), plus the
//                 orthogonal connectivity axis (live / stale / offline) driving the header freshness
//                 chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - PollingEngine (the shared surface)

/// The adaptive-polling panel — the SwiftUI parity of `PollingEngine.tsx`. Renders every state from
/// the web source plus the P4 leaf freshness states, binding through `PollingEngineModel`.
public struct PollingEngine: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PollingEngineMeta.surfaceSlug

    @State private var model: PollingEngineModel

    public init(model: PollingEngineModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production snapshot-backed source — the parity of mounting
    /// `<PollingEnginePanel />`. `input` is the host's current polling status + savings reads plus the
    /// connectivity axis.
    public init(input: PollingInput) {
        _model = State(initialValue: PollingEngineModel(source: LivePollingEngineSource(input: input)))
    }

    public var body: some View {
        Group {
            if model.isWithdrawn {
                // Web `!status.enabled → null`: the whole surface is withdrawn.
                EmptyView()
            } else {
                panel
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Panel chrome

private extension PollingEngine {
    var panel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                PollingHeaderView(
                    activeBadge: activeBadge,
                    connection: model.connection,
                    onRefresh: { model.refresh() }
                )
                if model.connection != .live {
                    PollingConnectivityBanner(connection: model.connection)
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: PollingEngineStrings.string("polling.title", "Adaptive Polling Engine"))
        )
    }

    /// The "Active" badge is shown only once the status read resolves to enabled (web header badge);
    /// it stays hidden during the loading + error chrome.
    var activeBadge: String? {
        if case .ready = model.phase { return model.ready?.activeBadge }
        return nil
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension PollingEngine {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .disabled:
            EmptyView()
        case .loading:
            PollingLoadingView()
        case let .error(message):
            PollingErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                PollingReadyView(ready: ready)
            }
        }
    }
}

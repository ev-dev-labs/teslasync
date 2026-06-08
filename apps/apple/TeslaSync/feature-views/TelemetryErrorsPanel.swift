//
//  TelemetryErrorsPanel.swift
//  TeslaSync — P4 feature view · 0009 · TelemetryErrorsPanel (Apple)
//
//  The composable Telemetry Errors feature view — the SwiftUI parity of
//  features/admin/components/devtools/TelemetryErrorsPanel.tsx. Binds through
//  `TelemetryErrorsModel` (no networking in the view) and renders every state the
//  web source has: idle (not requested) · loading · error · data · empty (with the
//  raw-response disclosure). The web leaf is fed by its parent's mutation state, so
//  upstream connectivity failures surface through the single `error` branch (the web
//  source has no separate stale/offline chrome at this level).
//

import SwiftUI

/// The composable Telemetry Errors panel — the SwiftUI parity of
/// `features/admin/components/devtools/TelemetryErrorsPanel.tsx`. Renders every
/// state from the web source, binding through `TelemetryErrorsModel` (P1/S8). No
/// networking lives here.
public struct TelemetryErrorsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TelemetryErrorsPanel"

    @State private var model: TelemetryErrorsModel

    public init(model: TelemetryErrorsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            TEIdleView(title: title, message: idleMessage)
        case .loading:
            TELoadingView(title: title)
        case let .error(message):
            TEErrorView(title: title, message: message) { model.refresh() }
        case .data:
            TEErrorsTable(rows: model.rows, export: model.export, downloadLabel: downloadLabel)
        case .empty:
            TEEmptyView(title: title, ok: model.ok, message: emptyMessage, rawJSONText: model.rawJSONText)
        }
    }

    /// Web `t(key, default)` props, resolved through the P1/S10 facade.
    private var title: String {
        TEStrings.string("Telemetry Errors", "Telemetry Errors")
    }

    private var idleMessage: String {
        TEStrings.string(
            "devtools.errorsIdle",
            "Click View Errors to fetch recent Fleet Telemetry errors for this vehicle."
        )
    }

    private var emptyMessage: String {
        TEStrings.string(
            "devtools.errorsEmpty",
            "No Fleet Telemetry errors reported for this vehicle."
        )
    }

    private var downloadLabel: String {
        TEStrings.string("Download Errors", "Download Errors")
    }
}

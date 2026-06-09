//
//  ResponseViewer.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The native, Apple-idiomatic parity of the web `ResponseViewer`
//  (features/admin/components/ResponseViewer.tsx). A presentational surface: it
//  receives a materialised `ApiResponse?` plus a `loading` flag and the recent
//  request history from its parent (the API Playground page) and never fetches —
//  so the leaf freshness axis (fetch-error / stale / offline) is owned by that
//  parent, exactly as in the web source. This surface reproduces the source's
//  own branches and composition.
//
//  States (every one renders — no hidden surface):
//    • loading — the `loading` input → skeleton chrome (web `Skeleton`).
//    • empty   — resolved, no response → friendly empty state, never a blank box
//                (web `EmptyState` "Send a request to see the response").
//    • loaded  — the status bar (success < 300 / redirect < 400 / error ≥ 400
//                styling), the body (pretty-printed JSON when the content type is
//                JSON, else raw text), and the collapsible response headers.
//    • history — the recent-requests strip, hidden when empty (web `return null`).
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with the
//  ``ResponseViewerSurface/slug``.
//

import SwiftUI

// MARK: - ResponseViewer (the feature surface)

/// The native parity of the web `ResponseViewer`. Renders every branch from the
/// web source — loading, empty, the loaded response, and the recent-requests
/// strip — bound entirely to its inputs (P1/S8 state holders live in the parent).
public struct ResponseViewer: View {
    private let response: ApiResponse?
    private let loading: Bool
    private let history: [HistoryEntry]
    private let onReplay: (HistoryEntry) -> Void
    private let telemetry: any ResponseViewerTelemetry

    /// Designated initialiser.
    /// - Parameters:
    ///   - response: the captured response, or `nil` before any request runs.
    ///   - loading: whether a request is in flight (web `loading`).
    ///   - history: the recent requests, newest-first (web `history`).
    ///   - onReplay: invoked with an entry when its chip is tapped (web `onReplay`).
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        response: ApiResponse?,
        loading: Bool,
        history: [HistoryEntry],
        onReplay: @escaping (HistoryEntry) -> Void,
        telemetry: any ResponseViewerTelemetry = OSLogResponseViewerTelemetry()
    ) {
        self.response = response
        self.loading = loading
        self.history = history
        self.onReplay = onReplay
        self.telemetry = telemetry
    }

    private var state: ResponseViewerState {
        ResponseViewerState(response: response, loading: loading)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            responsePanel
            RequestHistorySection(history: history, onReplay: onReplay)
        }
        .task { ResponseViewerSurface.reportOpen(to: telemetry) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ResponseViewerStrings.string(
            "responseViewer.panelA11y", "API response viewer"
        )))
    }

    // MARK: Response panel (web outer `GlassPanel`)

    private var responsePanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: ResponseViewerStrings.string("playground.response", "Response"))
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityAddTraits(.isHeader)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ResponseLoadingView()
        case .empty:
            ResponseEmptyView()
        case let .loaded(projection):
            TSFadeIn {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    ResponseStatusBar(projection: projection)
                    ResponseBody(text: projection.displayBody)
                    ResponseHeadersSection(headers: projection.headers)
                }
            }
        }
    }
}

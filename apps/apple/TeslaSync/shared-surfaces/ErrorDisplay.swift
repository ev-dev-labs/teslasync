//
//  ErrorDisplay.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  The ErrorDisplay shared surface — the SwiftUI parity of `components/feedback/ErrorDisplay.tsx`. A
//  status-aware error banner for NON-query failures (mutation failures, imperative fetches) that
//  branches by failure mode so the user gets actionable recovery copy per failure rather than a
//  generic "something went wrong": 404 (with an optional Back-to-list CTA), 401·403 (Sign in), 5xx
//  (Retry), and the network / offline branch (Retry, disabled until the connection returns). A
//  `compact` density tightens the tile for inline contexts (e.g. an error inside a panel). Driven by
//  the documented data sources — `useTranslation`, `useNavigate`, `useOnlineStatus` — bound through
//  `ErrorDisplayModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the parent is resolving whether the operation failed → skeleton failure chrome.
//    • empty   — there is no error (web returns `null`) → calm "all clear" card, never a blank box.
//    • failure — the classified failure tile: the four web branches with per-mode copy + CTA.
//    • stale / offline — the orthogonal connectivity axis (web `useOnlineStatus`) → a freshness chip
//                with a one-shot auto-refresh on the stale transition; offline also selects the
//                "You're offline" failure copy, exactly as the web branch does.
//

import SwiftUI

// MARK: - ErrorDisplay (the shared surface)

/// The ErrorDisplay shared surface — renders every state plus the P4 leaf freshness states, binding
/// through `ErrorDisplayModel`.
public struct ErrorDisplay: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ErrorDisplay"

    @State private var model: ErrorDisplayModel

    public init(model: ErrorDisplayModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-host usage — the parity of a web call site mounting
    /// `<ErrorDisplay error=… compact=… resourceName=… listHref=… onRetry=… />` with the current
    /// `useOnlineStatus`. A `nil` `failure` with no `isLoading` renders the calm empty state; a missing
    /// `onRetry` hides the Retry CTAs, exactly as the optional web `onRetry` prop does.
    public init(
        failure: ErrorFailure?,
        navigator: any ErrorDisplayNavigator,
        resourceName: String? = nil,
        listHref: String? = nil,
        compact: Bool = false,
        online: Bool = true,
        isStale: Bool = false,
        isLoading: Bool = false,
        onRetry: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticErrorDisplaySource(
            failure: failure,
            resourceName: resourceName,
            listHref: listHref,
            compact: compact,
            online: online,
            isStale: isStale,
            isLoading: isLoading
        )
        _model = State(initialValue: ErrorDisplayModel(source: source, navigator: navigator, onRetry: onRetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                ErrorDisplayFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ErrorDisplayLoadingView(density: model.density)
        case .empty:
            ErrorDisplayEmptyView()
        case .failure:
            if let content = model.resolved.content {
                ErrorDisplayCard(content: content, density: model.density) { action in
                    model.perform(action)
                }
            }
        }
    }
}

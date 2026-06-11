//
//  QueryError.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  The QueryError shared surface — the SwiftUI parity of `components/feedback/QueryError.tsx`. An
//  inline error tile for a failed API query that branches by failure mode so the user gets actionable
//  recovery copy per failure rather than a generic "something went wrong": transient-waiting (the
//  calm rate-limit / breaker state), 404 (with an optional Back-to-list CTA), 401·403 (Sign in), 5xx
//  (Retry), and the network / offline branch (Retry, plus a one-shot auto-retry when the browser
//  reconnects). Driven by the documented data sources — `useTranslation`, `useNavigate`,
//  `useOnlineStatus` — bound through `QueryErrorModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the parent is resolving whether the query failed → skeleton failure chrome.
//    • empty   — the query succeeded (web returns `null`) → calm "all clear" card, never a blank box.
//    • failure — the classified failure tile: the five web branches with per-mode copy + CTA.
//    • stale / offline — the orthogonal connectivity axis (web `useOnlineStatus`) → a freshness chip
//                with a one-shot auto-refresh on the stale transition; offline also selects the
//                "You're offline" failure copy, exactly as the web branch does.
//

import SwiftUI

// MARK: - QueryError (the shared surface)

/// The QueryError shared surface — renders every state plus the P4 leaf freshness states, binding
/// through `QueryErrorModel`.
public struct QueryError: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "QueryError"

    @State private var model: QueryErrorModel

    public init(model: QueryErrorModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-host usage — the parity of a web page mounting
    /// `<QueryError error=… resourceName=… listHref=… onRetry=… />` with the current `useOnlineStatus`.
    /// A `nil` `failure` with no `isLoading` renders the calm empty state; a missing `onRetry` hides
    /// the Retry CTAs, exactly as the optional web `onRetry` prop does.
    public init(
        failure: QueryFailure?,
        navigator: any QueryErrorNavigator,
        resourceName: String? = nil,
        listHref: String? = nil,
        online: Bool = true,
        isStale: Bool = false,
        isLoading: Bool = false,
        onRetry: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticQueryErrorSource(
            failure: failure,
            resourceName: resourceName,
            listHref: listHref,
            online: online,
            isStale: isStale,
            isLoading: isLoading
        )
        _model = State(initialValue: QueryErrorModel(source: source, navigator: navigator, onRetry: onRetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                QueryErrorFreshnessChip(connection: model.connection) {
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
            QueryErrorLoadingView()
        case .empty:
            QueryErrorEmptyView()
        case .failure:
            if let content = model.resolved.content {
                QueryErrorCard(content: content) { action in
                    model.perform(action)
                }
            }
        }
    }
}

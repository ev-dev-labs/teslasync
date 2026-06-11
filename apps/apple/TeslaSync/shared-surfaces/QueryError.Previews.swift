//
//  QueryError.Previews.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  Xcode previews for each surface state (the five failure branches / loading / empty / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Builds an optional no-op handler, sidestepping the `cond ? {} : nil` inference limitation for
    /// `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewRetry(_ enabled: Bool) -> (@MainActor () -> Void)? {
        guard enabled else { return nil }
        return {}
    }

    @MainActor
    private func previewModel(_ input: QueryErrorInput, retry: Bool = true) -> QueryErrorModel {
        let source = InMemoryQueryErrorSource(initial: input)
        let model = QueryErrorModel(
            source: source,
            navigator: RecordingQueryErrorNavigator(),
            onRetry: previewRetry(retry)
        )
        model.start()
        return model
    }

    #Preview("Waiting") {
        QueryError(model: previewModel(QueryErrorInput(failure: .rateLimited)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Not found — with list") {
        QueryError(model: previewModel(QueryErrorInput(
            failure: .http(404),
            resourceName: "Drive",
            listHref: "/drives"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Not found — no list") {
        QueryError(model: previewModel(QueryErrorInput(failure: .http(404))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Unauthorized") {
        QueryError(model: previewModel(QueryErrorInput(failure: .http(401))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Server error") {
        QueryError(model: previewModel(QueryErrorInput(failure: .http(503))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Unreachable") {
        QueryError(model: previewModel(QueryErrorInput(failure: .network)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        QueryError(model: previewModel(QueryErrorInput(failure: .network, online: false)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        QueryError(model: previewModel(QueryErrorInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        QueryError(model: previewModel(QueryErrorInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        QueryError(model: previewModel(QueryErrorInput(failure: .http(500), isStale: true)))
            .padding()
            .background(Color.TS.bg)
    }
#endif

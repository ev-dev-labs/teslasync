//
//  ErrorDisplay.Previews.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  Xcode previews for each surface state (the four failure branches / loading / empty / stale /
//  offline) plus the `compact` density variant. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
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
    private func previewModel(_ input: ErrorDisplayInput, retry: Bool = true) -> ErrorDisplayModel {
        let source = InMemoryErrorDisplaySource(initial: input)
        let model = ErrorDisplayModel(
            source: source,
            navigator: RecordingErrorDisplayNavigator(),
            onRetry: previewRetry(retry)
        )
        model.start()
        return model
    }

    #Preview("Not found — with list") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(
            failure: .http(404),
            resourceName: "Drive",
            listHref: "/drives"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Not found — no list") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .http(404))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Unauthorized") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .http(401))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Server error") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .http(503))))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Unreachable") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .network)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .network, online: false)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Server error — compact") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .http(500), compact: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Not found — compact") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(
            failure: .http(404),
            resourceName: "Charging session",
            listHref: "/charging",
            compact: true
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ErrorDisplay(model: previewModel(ErrorDisplayInput(failure: .http(500), isStale: true)))
            .padding()
            .background(Color.TS.bg)
    }
#endif

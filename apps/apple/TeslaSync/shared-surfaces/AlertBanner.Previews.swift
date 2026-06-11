//
//  AlertBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  Xcode previews for each surface state (the four variants / mutation banners / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AlertBannerPreviewData {
        static func notice(
            _ variant: AlertBannerVariant,
            title: String?,
            message: String,
            dismissable: Bool = false
        ) -> AlertBannerNotice {
            AlertBannerNotice(
                variant: variant,
                title: title.map(AlertBannerText.verbatim),
                message: .verbatim(message),
                dismissable: dismissable
            )
        }
    }

    /// Builds an optional no-op handler, sidestepping the `cond ? {} : nil` inference limitation for
    /// `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewHandler(_ enabled: Bool) -> (@MainActor () -> Void)? {
        guard enabled else { return nil }
        return {}
    }

    @MainActor
    private func previewModel(_ input: AlertBannerInput, dismiss: Bool = true) -> AlertBannerModel {
        let source = InMemoryAlertBannerSource(initial: input)
        let model = AlertBannerModel(source: source, onDismiss: previewHandler(dismiss))
        model.start()
        return model
    }

    #Preview("Alert — info") {
        AlertBanner(model: previewModel(AlertBannerInput(
            notice: AlertBannerPreviewData.notice(
                .info,
                title: "Scheduled maintenance",
                message: "TeslaSync will be briefly unavailable tonight from 02:00–02:30 UTC."
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Alert — success (mutation)") {
        AlertBanner(model: previewModel(AlertBannerInput(
            notice: .from(mutation: AlertBannerMutation(kind: .success, title: "Settings saved"))
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Alert — warning") {
        AlertBanner(model: previewModel(AlertBannerInput(
            notice: AlertBannerPreviewData.notice(
                .warning,
                title: "Beta feature",
                message: "Route efficiency is experimental and may change.",
                dismissable: true
            )
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Alert — danger (mutation)") {
        AlertBanner(model: previewModel(AlertBannerInput(
            notice: .from(mutation: AlertBannerMutation(
                kind: .error,
                title: "Failed to save settings",
                detail: "HTTP 500: internal server error"
            ))
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AlertBanner(model: previewModel(AlertBannerInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AlertBanner(model: previewModel(AlertBannerInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AlertBanner(model: previewModel(AlertBannerInput(
            errorMessage: "The notifications request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AlertBanner(model: previewModel(AlertBannerInput(connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AlertBanner(model: previewModel(AlertBannerInput(connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }
#endif

//
//  AiLimitBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  Xcode previews for each surface state (data severities / countdown / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope. The previews use the manual ticker so the countdown is deterministic.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AiLimitBannerPreviewData {
        static func info(
            _ reason: String,
            bannerLevel: String,
            retryAfterS: Int,
            baselineAvailable: Bool = true
        ) -> AiLimitInfo {
            AiLimitInfo(
                reason: reason,
                retryAfterS: retryAfterS,
                bannerLevel: bannerLevel,
                baselineAvailable: baselineAvailable,
                message: "synthetic preview limit"
            )
        }
    }

    /// Builds an optional no-op handler, sidestepping the `cond ? {} : nil` inference limitation
    /// for `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewHandler(_ enabled: Bool) -> (@MainActor () -> Void)? {
        guard enabled else { return nil }
        return {}
    }

    @MainActor
    private func previewModel(
        _ input: AiLimitBannerInput,
        retry: Bool = true,
        baseline: Bool = true,
        dismiss: Bool = true
    ) -> AiLimitBannerModel {
        let source = InMemoryAiLimitBannerSource(initial: input)
        let model = AiLimitBannerModel(
            source: source,
            ticker: ManualAiLimitTicker(),
            onRetry: previewHandler(retry),
            onUseBaseline: previewHandler(baseline),
            onDismiss: previewHandler(dismiss)
        )
        model.start()
        return model
    }

    #Preview("Data — info (ready)") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(
            info: AiLimitBannerPreviewData.info("provider_unavailable", bannerLevel: "", retryAfterS: 0)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — warning (counting down)") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(
            info: AiLimitBannerPreviewData.info("per_minute", bannerLevel: "warn", retryAfterS: 45)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — critical (cost cap)") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(
            info: AiLimitBannerPreviewData.info("cost_cap", bannerLevel: "critical", retryAfterS: 0)
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — tokens (no baseline)") {
        AiLimitBanner(model: previewModel(
            AiLimitBannerInput(
                info: AiLimitBannerPreviewData.info(
                    "input_tokens", bannerLevel: "warn", retryAfterS: 20, baselineAvailable: false
                )
            ),
            baseline: false
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(
            errorMessage: "The Helix settings request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(
            info: AiLimitBannerPreviewData.info("per_day", bannerLevel: "warn", retryAfterS: 0),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AiLimitBanner(model: previewModel(AiLimitBannerInput(
            info: AiLimitBannerPreviewData.info("cost_cap", bannerLevel: "critical", retryAfterS: 0),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif

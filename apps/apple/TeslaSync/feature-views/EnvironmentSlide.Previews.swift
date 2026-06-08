//
//  EnvironmentSlide.Previews.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / content-small /
//  content-overflow / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: EnvironmentSlideUpdate) -> EnvironmentSlideModel {
        let source = InMemoryEnvironmentSlideSource(initial: update)
        let model = EnvironmentSlideModel(source: source)
        model.start()
        return model
    }

    /// A modest recap: 84 kg → round(84 / 21) = 4 trees, no overflow.
    private let smallRecap = EnvironmentReviewDTO(co2OffsetKg: 84)
    /// A big recap: 1,840 kg → round(1840 / 21) = 88 trees → 30 glyphs + "+58 more".
    private let bigRecap = EnvironmentReviewDTO(co2OffsetKg: 1840)

    #Preview("Loading") {
        EnvironmentSlide(model: previewModel(EnvironmentSlideUpdate(status: .loading, stats: nil)))
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EnvironmentSlide(model: previewModel(EnvironmentSlideUpdate(status: .loaded, stats: nil)))
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnvironmentSlide(model: previewModel(
            EnvironmentSlideUpdate(status: .failed("The analytics service is unavailable (503)."), stats: nil)
        ))
        .background(Color.TS.bg)
    }

    #Preview("Content — small") {
        EnvironmentSlide(model: previewModel(
            EnvironmentSlideUpdate(status: .loaded, stats: smallRecap)
        ))
        .background(Color.TS.bg)
    }

    #Preview("Content — overflow") {
        EnvironmentSlide(model: previewModel(
            EnvironmentSlideUpdate(status: .loaded, stats: bigRecap)
        ))
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        EnvironmentSlide(model: previewModel(
            EnvironmentSlideUpdate(status: .loaded, connection: .stale, isFetching: true, stats: bigRecap)
        ))
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        EnvironmentSlide(model: previewModel(
            EnvironmentSlideUpdate(status: .loaded, connection: .offline, stats: bigRecap)
        ))
        .background(Color.TS.bg)
    }
#endif

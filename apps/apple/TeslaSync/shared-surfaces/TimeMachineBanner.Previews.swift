//
//  TimeMachineBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  Xcode previews for each surface state (historical / historical + picker / live picker / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TimeMachinePreviewData {
        /// A fixed historical anchor (2024-11-12T14:30:00Z) so the preview title is stable.
        static let anchor = Date(timeIntervalSince1970: 1_731_421_800)
    }

    @MainActor
    private func previewModel(
        _ input: TimeMachineInput,
        pickerOpen: Bool = false
    ) -> TimeMachineBannerModel {
        let source = InMemoryTimeMachineBannerSource(initial: input)
        let model = TimeMachineBannerModel(source: source, pickerOpen: pickerOpen)
        model.start()
        return model
    }

    #Preview("Historical — read-only") {
        TimeMachineBanner(model: previewModel(TimeMachineInput(asOf: TimeMachinePreviewData.anchor)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Historical — picker open") {
        TimeMachineBanner(model: previewModel(
            TimeMachineInput(asOf: TimeMachinePreviewData.anchor),
            pickerOpen: true
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Live — picker open") {
        TimeMachineBanner(model: previewModel(TimeMachineInput(), pickerOpen: true))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — live") {
        TimeMachineBanner(model: previewModel(TimeMachineInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TimeMachineBanner(model: previewModel(TimeMachineInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TimeMachineBanner(model: previewModel(TimeMachineInput(
            errorMessage: "The historical snapshot feed failed to respond"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TimeMachineBanner(model: previewModel(TimeMachineInput(
            asOf: TimeMachinePreviewData.anchor,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TimeMachineBanner(model: previewModel(TimeMachineInput(
            asOf: TimeMachinePreviewData.anchor,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif

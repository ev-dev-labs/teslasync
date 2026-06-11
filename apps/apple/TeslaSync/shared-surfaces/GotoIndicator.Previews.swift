//
//  GotoIndicator.Previews.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  Xcode previews for each surface state (data, empty, loading, error, stale, offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: GotoIndicatorInput) -> GotoIndicatorModel {
        let source = InMemoryGotoIndicatorSource(initial: input)
        let model = GotoIndicatorModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — visible") {
        GotoIndicator(model: previewModel(GotoIndicatorInput(visibility: true)))
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .background(Color.TS.bg)
    }

    #Preview("Empty — not visible") {
        GotoIndicator(model: previewModel(GotoIndicatorInput(visibility: false)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        GotoIndicator(model: previewModel(GotoIndicatorInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        GotoIndicator(model: previewModel(GotoIndicatorInput(
            errorMessage: "The shortcut controller is unavailable"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        GotoIndicator(model: previewModel(GotoIndicatorInput(visibility: true, connection: .stale)))
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        GotoIndicator(model: previewModel(GotoIndicatorInput(visibility: true, connection: .offline)))
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            .background(Color.TS.bg)
    }
#endif

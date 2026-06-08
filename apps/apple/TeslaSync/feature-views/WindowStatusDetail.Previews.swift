//
//  WindowStatusDetail.Previews.swift
//  TeslaSync — P4 feature view · 0049 · WindowStatusDetail (Apple)
//
//  Xcode previews for each surface state (loading / error / empty / data-all-closed /
//  data-mixed / stale / offline). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: WindowStatusInput) -> WindowStatusModel {
        let source = InMemoryWindowStatusSource(initial: input)
        let model = WindowStatusModel(source: source)
        model.start()
        return model
    }

    private let previewClosed = WindowStatusEvent(
        frontDriver: .string("Closed"),
        frontPassenger: .string("Closed"),
        rearDriver: .string("0"),
        rearPassenger: .string("closed"),
        recordedAt: Date(timeIntervalSince1970: 1_736_089_445)
    )

    private let previewMixed = WindowStatusEvent(
        frontDriver: .string("Closed"),
        frontPassenger: .string("Vented"),
        rearDriver: .string("Open"),
        rearPassenger: .bool(false),
        recordedAt: Date(timeIntervalSince1970: 1_736_089_445)
    )

    #Preview("Loading") {
        WindowStatusDetail(model: previewModel(WindowStatusInput(status: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        WindowStatusDetail(model: previewModel(
            WindowStatusInput(status: .failed("Tesla API returned 503 Service Unavailable"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WindowStatusDetail(model: previewModel(WindowStatusInput(status: .loaded, event: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data — all closed") {
        WindowStatusDetail(model: previewModel(
            WindowStatusInput(status: .loaded, event: previewClosed, connection: .live, updatedAt: Date())
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — mixed") {
        WindowStatusDetail(model: previewModel(
            WindowStatusInput(status: .loaded, event: previewMixed, connection: .live, updatedAt: Date())
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        WindowStatusDetail(model: previewModel(
            WindowStatusInput(status: .loaded, event: previewMixed, connection: .stale, updatedAt: Date())
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        WindowStatusDetail(model: previewModel(
            WindowStatusInput(status: .loaded, event: previewClosed, connection: .offline, updatedAt: Date())
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }
#endif

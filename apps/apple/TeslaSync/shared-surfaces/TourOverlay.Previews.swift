//
//  TourOverlay.Previews.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  Xcode previews for each surface state (active first / middle / last / single step, all four
//  placements, loading, empty, error, stale, offline). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TourOverlayPreviewData {
        static let rect = TourOverlayTargetRect(x: 48, y: 240, width: 220, height: 52)

        static func step(_ placement: TourOverlayPlacement) -> TourOverlayStep {
            TourOverlayStep(
                id: "[data-tour='vehicles']",
                title: "Your fleet at a glance",
                detail: "Open any vehicle to see its live battery, range, and climate — streamed in real time.",
                placement: placement
            )
        }

        static func update(
            status: TourOverlayLoadStatus = .loaded,
            connection: TourOverlayConnection = .live,
            placement: TourOverlayPlacement = .bottom,
            currentStep: Int = 0,
            totalSteps: Int = 4,
            hasAnchor: Bool = true
        ) -> TourOverlayUpdate {
            TourOverlayUpdate(
                status: status,
                connection: connection,
                step: hasAnchor ? step(placement) : nil,
                targetRect: hasAnchor ? rect : nil,
                currentStep: currentStep,
                totalSteps: totalSteps
            )
        }
    }

    @MainActor
    private func previewModel(_ update: TourOverlayUpdate) -> TourOverlayModel {
        let source = InMemoryTourOverlaySource(initial: update)
        let model = TourOverlayModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — first step (bottom)") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(currentStep: 0)))
            .background(Color.TS.bg)
    }

    #Preview("Data — middle step (right)") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(placement: .right, currentStep: 1)))
            .background(Color.TS.bg)
    }

    #Preview("Data — last step (top)") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(placement: .top, currentStep: 3)))
            .background(Color.TS.bg)
    }

    #Preview("Data — single step (left)") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(
            placement: .left, currentStep: 0, totalSteps: 1
        )))
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(status: .loading, hasAnchor: false)))
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(status: .loaded, hasAnchor: false)))
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(
            status: .failed("The highlighted element could not be found"), hasAnchor: false
        )))
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(connection: .stale, currentStep: 1)))
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TourOverlay(model: previewModel(TourOverlayPreviewData.update(connection: .offline, currentStep: 2)))
            .background(Color.TS.bg)
    }
#endif

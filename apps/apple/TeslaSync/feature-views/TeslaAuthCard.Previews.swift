//
//  TeslaAuthCard.Previews.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  Xcode previews for each surface state (connected / expiring / expired / disconnected / unknown /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TeslaAuthPreviewData {
        static let now = Date(timeIntervalSince1970: 1_750_000_000)

        static func iso(daysFromNow days: Double) -> String {
            let date = now.addingTimeInterval(days * 24 * 60 * 60)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: date)
        }
    }

    @MainActor
    private func previewModel(_ input: TeslaAuthInput) -> TeslaAuthModel {
        let source = InMemoryTeslaAuthSource(initial: input)
        let model = TeslaAuthModel(source: source)
        model.start()
        return model
    }

    #Preview("Connected") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: TeslaAuthPreviewData.iso(daysFromNow: 42),
            now: TeslaAuthPreviewData.now
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Expiring soon") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: TeslaAuthPreviewData.iso(daysFromNow: 3),
            now: TeslaAuthPreviewData.now
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Expired") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: TeslaAuthPreviewData.iso(daysFromNow: -5),
            now: TeslaAuthPreviewData.now
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Disconnected") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: false,
            now: TeslaAuthPreviewData.now
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty · unknown") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: true,
            now: TeslaAuthPreviewData.now
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(errorMessage: "Network request timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: TeslaAuthPreviewData.iso(daysFromNow: 42),
            now: TeslaAuthPreviewData.now,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TeslaAuthCard(model: previewModel(TeslaAuthInput(
            authenticated: true,
            expiresAtRaw: TeslaAuthPreviewData.iso(daysFromNow: 42),
            now: TeslaAuthPreviewData.now,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif

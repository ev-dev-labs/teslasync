//
//  TeslaAccountSection.Previews.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  Xcode previews for each surface state (connected · expiring soon · disconnected · not connected ·
//  empty/unknown · loading · error · stale · offline · disconnect confirm · Dynamic Type). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TeslaAccountPreviewData {
        static let now = Date(timeIntervalSince1970: 1_750_000_000)

        static func iso(daysFromNow days: Double) -> String {
            let date = now.addingTimeInterval(days * 24 * 60 * 60)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: date)
        }
    }

    /// No-op telemetry sink so previews don't emit diagnostics.
    private struct NoopTeslaAccountTelemetry: TeslaAccountTelemetry {
        func viewOpened(surface _: String) {}
    }

    @MainActor
    private func previewModel(_ input: TeslaAccountStatusInput) -> TeslaAccountModel {
        let source = InMemoryTeslaAccountStatusSource(initial: input)
        let model = TeslaAccountModel(
            source: source,
            actions: InMemoryTeslaAccountActions(),
            telemetry: NoopTeslaAccountTelemetry(),
            locale: Locale(identifier: "en_US"),
            timeZone: TimeZone(identifier: "America/Los_Angeles") ?? .current
        )
        model.start()
        return model
    }

    @MainActor
    private func previewShell(_ section: TeslaAccountSection) -> some View {
        ScrollView {
            section.padding(TSSpacing.lg)
        }
        .frame(maxWidth: 640)
        .background(Color.TS.bg)
    }

    #Preview("Connected") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 42),
            now: TeslaAccountPreviewData.now
        ))))
    }

    #Preview("Expiring soon") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 3),
            now: TeslaAccountPreviewData.now
        ))))
    }

    #Preview("Disconnected (token expired)") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 42),
            pillDisconnected: true,
            now: TeslaAccountPreviewData.now
        ))))
    }

    #Preview("Not connected") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: false,
            now: TeslaAccountPreviewData.now
        ))))
    }

    #Preview("Empty · unknown") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: nil,
            now: TeslaAccountPreviewData.now
        ))))
    }

    #Preview("Loading") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(isLoading: true))))
    }

    #Preview("Error") {
        previewShell(TeslaAccountSection(model: previewModel(
            TeslaAccountStatusInput(errorMessage: "Network request timed out")
        )))
    }

    #Preview("Stale") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 42),
            now: TeslaAccountPreviewData.now,
            connection: .stale
        ))))
    }

    #Preview("Offline") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 42),
            now: TeslaAccountPreviewData.now,
            connection: .offline
        ))))
    }

    #Preview("Disconnect confirm") {
        let model = previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 42),
            now: TeslaAccountPreviewData.now
        ))
        model.requestDisconnect()
        return TeslaAccountDisconnectConfirmSheet(model: model)
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }

    #Preview("Dynamic Type") {
        previewShell(TeslaAccountSection(model: previewModel(TeslaAccountStatusInput(
            authenticated: true,
            expiresAtRaw: TeslaAccountPreviewData.iso(daysFromNow: 3),
            now: TeslaAccountPreviewData.now
        ))))
        .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif

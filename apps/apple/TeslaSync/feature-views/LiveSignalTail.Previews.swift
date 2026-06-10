//
//  LiveSignalTail.Previews.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  Xcode previews for each surface state (content / loading / waiting / error /
//  stale / offline / paused). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LiveSignalTailUpdate) -> LiveSignalTailModel {
        let source = InMemoryLiveSignalTailSource(initial: update)
        let model = LiveSignalTailModel(source: source)
        model.start()
        return model
    }

    private func previewEntry(
        _ id: Int,
        _ name: String,
        _ value: String,
        _ kind: LiveSignalTailValueKind,
        secondsAgo: TimeInterval
    ) -> SignalTailEntry {
        let date = Date().addingTimeInterval(-secondsAgo)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let raw = formatter.string(from: date)
        return SignalTailEntry(id: id, name: name, value: value, kind: kind, timestampRaw: raw, timestamp: date)
    }

    private func previewEntries() -> [SignalTailEntry] {
        [
            previewEntry(106, "vehicle_speed", "42", .number, secondsAgo: 2),
            previewEntry(105, "charging_state", "Charging", .string, secondsAgo: 6),
            previewEntry(104, "locked", "true", .boolean, secondsAgo: 18),
            previewEntry(103, "battery_level", "78.5", .number, secondsAgo: 45),
            previewEntry(102, "shift_state", "D", .string, secondsAgo: 140),
            previewEntry(101, "sentry_mode", "false", .boolean, secondsAgo: 720)
        ]
    }

    @MainActor
    private func previewContainer(_ model: LiveSignalTailModel) -> some View {
        LiveSignalTail(model: model, title: "Live Signal Tail")
            .padding(TSSpacing.lg)
            .frame(width: 640, height: 560, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewContainer(previewModel(
            LiveSignalTailUpdate(
                status: .loaded,
                entries: previewEntries(),
                rate: 12,
                bufferMax: 500,
                updatedAt: Date()
            )
        ))
    }

    #Preview("Loading") {
        previewContainer(previewModel(LiveSignalTailUpdate(status: .loading)))
    }

    #Preview("Waiting (empty)") {
        previewContainer(previewModel(LiveSignalTailUpdate(status: .loaded)))
    }

    #Preview("Error") {
        previewContainer(previewModel(LiveSignalTailUpdate(status: .failed("Stream unavailable"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(
            LiveSignalTailUpdate(
                status: .loaded,
                connection: .stale,
                entries: previewEntries(),
                rate: 0,
                bufferMax: 500,
                updatedAt: Date().addingTimeInterval(-150)
            )
        ))
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(
            LiveSignalTailUpdate(
                status: .loaded,
                connection: .offline,
                entries: previewEntries(),
                rate: 0,
                bufferMax: 500,
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }

    #Preview("Paused") {
        previewContainer(previewModel(
            LiveSignalTailUpdate(
                status: .loaded,
                entries: previewEntries(),
                rate: 0,
                bufferMax: 500,
                paused: true,
                updatedAt: Date()
            )
        ))
    }
#endif

//
//  TimeStamp.Previews.swift
//  TeslaSync — P4 shared surface · 0108 · TimeStamp (Apple)
//
//  Xcode previews for each surface state (relative / absolute / auto-preference / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TimeStampPreviewData {
        /// A value ~2 hours in the past, for the relative body ("2h ago").
        static let recent: TimeStampValue = .date(Date().addingTimeInterval(-2 * 3600))
        /// A representative backend ISO-8601 UTC timestamp (the shape the API emits).
        static let fixed: TimeStampValue = .iso("2026-04-04T09:30:00Z")

        static func input(
            value: TimeStampValue = recent,
            format: TimeStampFormat = .auto,
            preference: TimeStampPreference = .relative,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: TimeStampConnection = .live
        ) -> TimeStampInput {
            TimeStampInput(
                value: value,
                format: format,
                mode: .vehicle,
                preference: preference,
                locale: "en-US",
                vehicleTimeZone: "America/Los_Angeles",
                defaultMode: .vehicle,
                deviceTimeZone: "America/New_York",
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }
    }

    @MainActor
    private func previewModel(_ input: TimeStampInput) -> TimeStampModel {
        let source = InMemoryTimeStampSource(initial: input)
        let model = TimeStampModel(source: source)
        model.start()
        return model
    }

    #Preview("Relative (explicit)") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(format: .relative)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Absolute (explicit)") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(value: TimeStampPreviewData.fixed, format: .absolute)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Auto · relative preference") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(format: .auto, preference: .relative)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Auto · absolute preference") {
        TimeStamp(model: previewModel(
            TimeStampPreviewData.input(value: TimeStampPreviewData.fixed, format: .auto, preference: .absolute)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(value: .absent)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(errorMessage: "The settings feed timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TimeStamp(model: previewModel(TimeStampPreviewData.input(connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }
#endif

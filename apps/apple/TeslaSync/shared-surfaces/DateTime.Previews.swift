//
//  DateTime.Previews.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  Xcode previews for each surface state (content variants / empty / loading / error / stale /
//  offline / showTz) plus the hook-free `PureDateTimeView`. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DateTimePreviewData {
        /// A representative backend ISO-8601 UTC timestamp (the shape the API emits).
        static let value: DateTimeValue = .iso("2026-04-04T09:30:00Z")
        /// A value ~2 hours in the past, for the relative variant ("2h ago").
        static let recent: DateTimeValue = .date(Date().addingTimeInterval(-2 * 3600))

        static func input(
            value: DateTimeValue = value,
            variant: DateTimeVariant = .full,
            showTimeZone: Bool = false,
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: DateTimeConnection = .live
        ) -> DateTimeInput {
            DateTimeInput(
                value: value,
                variant: variant,
                mode: .vehicle,
                showTimeZone: showTimeZone,
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
    private func previewModel(_ input: DateTimeInput) -> DateTimeModel {
        let source = InMemoryDateTimeSource(initial: input)
        let model = DateTimeModel(source: source)
        model.start()
        return model
    }

    #Preview("Full") {
        DateTime(model: previewModel(DateTimePreviewData.input(variant: .full)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Date / Time / Short") {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            DateTime(model: previewModel(DateTimePreviewData.input(variant: .date)))
            DateTime(model: previewModel(DateTimePreviewData.input(variant: .time)))
            DateTime(model: previewModel(DateTimePreviewData.input(variant: .short)))
        }
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Relative") {
        DateTime(model: previewModel(DateTimePreviewData.input(value: DateTimePreviewData.recent, variant: .relative)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Show timezone") {
        DateTime(model: previewModel(DateTimePreviewData.input(variant: .full, showTimeZone: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DateTime(model: previewModel(DateTimePreviewData.input(value: .absent)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DateTime(model: previewModel(DateTimePreviewData.input(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        DateTime(model: previewModel(DateTimePreviewData.input(errorMessage: "The settings feed timed out")))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale") {
        DateTime(model: previewModel(DateTimePreviewData.input(showTimeZone: true, connection: .stale)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        DateTime(model: previewModel(DateTimePreviewData.input(showTimeZone: true, connection: .offline)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Pure (hook-free)") {
        PureDateTimeView(value: DateTimePreviewData.value, variant: .full)
            .padding()
            .background(Color.TS.bg)
    }
#endif

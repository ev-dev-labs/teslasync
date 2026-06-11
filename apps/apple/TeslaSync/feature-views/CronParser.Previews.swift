//
//  CronParser.Previews.swift
//  TeslaSync — P4 feature view · 0014 · CronParser (Apple)
//
//  Xcode previews — one per state the web source produces (empty / partial → empty,
//  every-minute, daily-at-time, weekly). A fixed reference instant + UTC calendar +
//  POSIX formatter keep the previewed "Next Runs" stable. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentCronParserTelemetry: CronParserTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Builds a deterministic model: 2026-01-01 12:00:00 UTC reference, UTC calendar, and
    /// a POSIX/UTC run formatter so the previewed runs never drift.
    @MainActor
    private func cronPreviewModel(_ input: String) -> CronParserModel {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return CronParserModel(
            input: input,
            calendar: calendar,
            referenceDate: Date(timeIntervalSince1970: 1_767_268_800),
            formatter: CronRunFormatter(
                locale: Locale(identifier: "en_US_POSIX"),
                timeZone: TimeZone(identifier: "UTC") ?? .current
            ),
            telemetry: SilentCronParserTelemetry()
        )
    }

    #Preview("Empty") {
        CronParser(model: cronPreviewModel(""))
            .padding()
            .frame(maxWidth: 460)
    }

    #Preview("Every minute") {
        CronParser(model: cronPreviewModel("* * * * *"))
            .padding()
            .frame(maxWidth: 460)
    }

    #Preview("Daily at time") {
        CronParser(model: cronPreviewModel("30 9 * * *"))
            .padding()
            .frame(maxWidth: 460)
    }

    #Preview("Weekly") {
        CronParser(model: cronPreviewModel("0 0 * * 1"))
            .padding()
            .frame(maxWidth: 460)
    }

    #Preview("Partial · empty state") {
        CronParser(model: cronPreviewModel("* *"))
            .padding()
            .frame(maxWidth: 460)
    }
#endif

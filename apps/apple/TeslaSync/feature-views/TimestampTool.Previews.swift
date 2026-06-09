//
//  TimestampTool.Previews.swift
//  TeslaSync — P4 feature view · 0021 · TimestampTool (Apple)
//
//  Xcode previews for each surface branch (empty / valid-unix / valid-iso / both /
//  invalid). DEBUG-only; skipped by the host compile + format gates. A fixed `now`
//  + locale + timezone keep the live clock and "Local" row deterministic.
//

import SwiftUI

#if DEBUG
    private enum TimestampPreviewFixture {
        /// 2024-01-01T00:00:00Z — a stable instant for the live clock + relatives.
        static let now = Date(timeIntervalSince1970: 1_704_067_200)
        static let locale = Locale(identifier: "en_US")
        static let timeZone = TimeZone(identifier: "America/Los_Angeles") ?? .current

        static func model(unix: String = "", iso: String = "") -> TimestampToolModel {
            TimestampToolModel(
                now: now,
                unixInput: unix,
                isoInput: iso,
                locale: locale,
                timeZone: timeZone
            )
        }
    }

    #Preview("Empty (both hints)") {
        TimestampTool(model: TimestampPreviewFixture.model())
            .padding()
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }

    #Preview("Unix → content") {
        TimestampTool(model: TimestampPreviewFixture.model(unix: "1700000000"))
            .padding()
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }

    #Preview("Iso → content") {
        TimestampTool(model: TimestampPreviewFixture.model(iso: "2024-01-01T00:00:00Z"))
            .padding()
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }

    #Preview("Both filled") {
        TimestampTool(
            model: TimestampPreviewFixture.model(unix: "1700000000", iso: "2023-06-15T12:30:00Z")
        )
        .padding()
        .frame(maxWidth: 520)
        .background(Color.TS.bg)
    }

    #Preview("Invalid (both hints)") {
        TimestampTool(model: TimestampPreviewFixture.model(unix: "not-a-number", iso: "nonsense"))
            .padding()
            .frame(maxWidth: 520)
            .background(Color.TS.bg)
    }
#endif

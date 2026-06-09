//
//  RegexTester.Previews.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  Xcode previews — one per state the web source produces (idle, matches across
//  global / case-insensitive / multiline flags, no-match, and an invalid pattern
//  that the web `catch` collapses to zero hits). Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentRegexTelemetry: RegexTesterTelemetry {
        func viewOpened(surface _: String) {}
    }

    @MainActor
    private func previewModel(
        pattern: String,
        flags: RegexFlags,
        test: String
    ) -> RegexTesterModel {
        RegexTesterModel(pattern: pattern, flags: flags, testString: test, telemetry: SilentRegexTelemetry())
    }

    #Preview("Idle · no input") {
        RegexTester(model: previewModel(pattern: "", flags: .global, test: ""))
            .padding()
            .frame(maxWidth: 440)
    }

    #Preview("Matches · global") {
        RegexTester(
            model: previewModel(pattern: "\\d+", flags: .global, test: "Order 42 shipped on 2026-06-09")
        )
        .padding()
        .frame(maxWidth: 440)
    }

    #Preview("Matches · case-insensitive") {
        RegexTester(
            model: previewModel(pattern: "tesla", flags: .globalCaseInsensitive, test: "Tesla TESLA tesla")
        )
        .padding()
        .frame(maxWidth: 440)
    }

    #Preview("Matches · multiline") {
        RegexTester(
            model: previewModel(pattern: "^line", flags: .globalMultiline, test: "line one\nline two\nlast")
        )
        .padding()
        .frame(maxWidth: 440)
    }

    #Preview("No match") {
        RegexTester(
            model: previewModel(pattern: "zzz", flags: .global, test: "nothing to find here")
        )
        .padding()
        .frame(maxWidth: 440)
    }

    #Preview("Invalid pattern") {
        RegexTester(
            model: previewModel(pattern: "(unclosed", flags: .global, test: "anything")
        )
        .padding()
        .frame(maxWidth: 440)
    }
#endif

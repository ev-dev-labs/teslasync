//
//  RegexTester.Model.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the regex tester. The view binds through `RegexTesterModel`; the tool is a pure
//  local transform, so there is no network and no `Source` — the model owns the
//  pattern + flags + test string and derives the outcome, mirroring the web
//  `useMemo`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol RegexTesterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogRegexTesterTelemetry: RegexTesterTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "RegexTester" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum RegexStrings {
    public static let table = "RegexTester"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// A `LocalizedStringKey` carrying the already-resolved string, for the shared
    /// components (`TSTextField`, `TSSelect`, `TSBadge`) whose labels take a key.
    public static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - State holder (P1/S8 layer)

/// The tool's observable view-model. Owns the pattern, flags, and test string and
/// derives the `RegexOutcome` on demand (the web `useMemo`); emits the
/// `view.opened` diagnostics event once on first appearance. No networking here.
@MainActor
@Observable
public final class RegexTesterModel {
    /// The regex pattern (web `pattern`).
    public var pattern: String

    /// The selected flag preset (web `flags`).
    public var flags: RegexFlags

    /// The text the pattern is tested against (web `testStr`).
    public var testString: String

    @ObservationIgnored private let telemetry: any RegexTesterTelemetry
    @ObservationIgnored private var started = false

    public init(
        pattern: String = "",
        flags: RegexFlags = .global,
        testString: String = "",
        telemetry: any RegexTesterTelemetry = OSLogRegexTesterTelemetry()
    ) {
        self.pattern = pattern
        self.flags = flags
        self.testString = testString
        self.telemetry = telemetry
    }

    /// The derived match outcome. Recomputed from `pattern` + `flags` +
    /// `testString` on every access; `@Observable` tracks the reads so SwiftUI
    /// re-renders on change (the @Observable analogue of the web `useMemo`).
    public var outcome: RegexOutcome {
        RegexEvaluator.evaluate(pattern: pattern, flags: flags, test: testString)
    }

    /// The match count for the badge (web `matches.length`).
    public var matchCount: Int {
        outcome.count
    }

    /// The combined VoiceOver summary for the current outcome.
    public var accessibilitySummary: String {
        RegexAccessibility.summary(outcome: outcome, localize: RegexStrings.string)
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RegexSurface.slug)
    }

    /// Selects a flag preset (web `setFlags`).
    public func select(_ flags: RegexFlags) {
        self.flags = flags
    }
}

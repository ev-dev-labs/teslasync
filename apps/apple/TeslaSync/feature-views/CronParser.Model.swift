//
//  CronParser.Model.swift
//  TeslaSync — P4 feature view · 0014 · CronParser (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) + the i18n facade (P1/S10)
//  for the Cron Parser surface — the non-view half of
//  features/admin/components/devtools/tools/CronParser.tsx. The view binds through
//  `CronParserModel`; the tool is a pure local transform (web `useMemo`), so the model
//  owns the input and derives the result with no network and no `Source`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and
/// redacted there. The user's expression is never part of the event.
public protocol CronParserTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. Only the
/// static surface slug is logged — never the user's cron expression.
public struct OSLogCronParserTelemetry: CronParserTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "CronParser" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; they are kept in a per-surface
/// table so each parallel surface prompt owns its own strings.
public enum CronParserStrings {
    public static let table = "CronParser"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - State holder (P1/S8 layer)

/// The surface's observable view-model. Owns the input expression and derives the
/// `CronResult` whenever the input changes (the web `useMemo`); emits the `view.opened`
/// diagnostics event once on first appearance. The calendar + reference instant are
/// injectable so the derived "next runs" are deterministic in tests/previews.
@MainActor
@Observable
public final class CronParserModel {
    /// The raw cron expression text (web `expr`), two-way bound to the field.
    public var input: String {
        didSet { recompute() }
    }

    /// The derived projection (web `description` + `nextRuns`). Recomputed on every input
    /// change so SwiftUI re-renders, mirroring the web memo.
    public private(set) var result: CronResult

    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let referenceDate: Date?
    @ObservationIgnored private let runCount: Int
    @ObservationIgnored private let formatter: CronRunFormatter
    @ObservationIgnored private let telemetry: any CronParserTelemetry
    @ObservationIgnored private var didOpen = false

    public init(
        input: String = "",
        calendar: Calendar = .current,
        referenceDate: Date? = nil,
        runCount: Int = 5,
        formatter: CronRunFormatter = .display,
        telemetry: any CronParserTelemetry = OSLogCronParserTelemetry()
    ) {
        self.input = input
        self.calendar = calendar
        self.referenceDate = referenceDate
        self.runCount = runCount
        self.formatter = formatter
        self.telemetry = telemetry
        result = CronEvaluator.evaluate(
            expression: input,
            count: runCount,
            now: referenceDate ?? Date(),
            calendar: calendar,
            localize: CronParserStrings.string
        )
    }

    /// The preset chips (web `presets`).
    public var presets: [CronPreset] {
        CronPreset.all
    }

    /// The combined VoiceOver summary for the current result.
    public var accessibilitySummary: String {
        CronParserAccessibility.summary(result: result, localize: CronParserStrings.string, formatter: formatter)
    }

    /// The display rows for the "Next Runs" section (web `nextRuns.map`): a 1-based index
    /// + the formatted instant.
    public func runRows() -> [CronRunRow] {
        result.runs.enumerated().map { offset, date in
            CronRunRow(index: offset + 1, label: formatter.string(from: date))
        }
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent, so it is safe
    /// to call from `onAppear`.
    public func start() {
        guard !didOpen else { return }
        didOpen = true
        telemetry.viewOpened(surface: CronParserSurface.slug)
    }

    /// Fills the field from a preset (web `onClick={() => setExpr(p.value)}`).
    public func apply(preset value: String) {
        input = value
    }

    private func recompute() {
        result = CronEvaluator.evaluate(
            expression: input,
            count: runCount,
            now: referenceDate ?? Date(),
            calendar: calendar,
            localize: CronParserStrings.string
        )
    }
}

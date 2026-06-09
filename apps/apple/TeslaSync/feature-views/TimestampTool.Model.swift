//
//  TimestampTool.Model.swift
//  TeslaSync — P4 feature view · 0021 · TimestampTool (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the TimestampTool devtools surface. Vendor-agnostic and SwiftUI-free so the
//  model + adapter logic compile and run on a plain host; the SwiftUI chrome lives
//  in TimestampTool.swift.
//
//  Parity target: features/admin/components/devtools/tools/TimestampTool.tsx — its
//  only data hook is `useTranslation`, so there is no network here. The model owns
//  the live `now` (web `useState(new Date())` ticked by `setInterval`), the two
//  text inputs, and derives the projections on demand (web `useMemo` + the
//  per-render `getRelativeTime`, which re-runs every second as `now` ticks).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core `Telemetry.track(.screenView(screen:…))`, which is
/// consent-gated and redacted there.
public protocol TimestampToolTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTimestampToolTelemetry: TimestampToolTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Surface identity

/// Diagnostics slug for this surface (P1/S11 `view.opened`). Kept out of the
/// SwiftUI view so the model compiles and tests without SwiftUI.
public enum TimestampToolSurface {
    public static let slug = "TimestampTool"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "TimestampTool" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time;
/// keeping them per-surface lets each parallel surface prompt own its own strings
/// without editing the shared catalog (parallel-unsafe across the concurrent slots).
public enum TimestampToolStrings {
    public static let table = "TimestampTool"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The localized "ago" string for a bucketed relative duration, formatted via
    /// the per-unit catalog key. The default values reproduce the web
    /// `getRelativeTime` output verbatim ("5s ago", "2m ago", …).
    public static func relative(_ relative: RelativeTime) -> String {
        let number = String(relative.value)
        switch relative.unit {
        case .seconds:
            return String(format: string("Timestamp Rel Seconds", "%@s ago"), number)
        case .minutes:
            return String(format: string("Timestamp Rel Minutes", "%@m ago"), number)
        case .hours:
            return String(format: string("Timestamp Rel Hours", "%@h ago"), number)
        case .days:
            return String(format: string("Timestamp Rel Days", "%@d ago"), number)
        }
    }
}

// MARK: - Per-field render state

/// The mutually-exclusive render branches for one converter field. The web hides
/// the interpretation block when the input is falsy/invalid (`{fromUnix && …}`);
/// native renders a friendly hint in those cases so a state always shows.
public enum TimestampFieldPhase: Equatable {
    /// Input parsed → the interpretation rows render.
    case content
    /// No input yet → a guidance hint renders.
    case empty
    /// Non-empty input that does not parse → a "couldn't read that" hint renders.
    case invalid
}

// MARK: - State holder (P1/S8)

/// The observable view-model for the tool. This surface has no remote data — it is
/// a synchronous client-side computation (web parity: the only hook is
/// `useTranslation`), so the state holder owns the live `now`, the two text inputs,
/// and re-derives the projections on every access. `@Observable` tracks the reads
/// so SwiftUI re-renders both when an input changes and once per `tick` (keeping
/// the live clock + the relative-time rows current, exactly like the web's 1 Hz
/// re-render). No networking lives here.
@MainActor
@Observable
public final class TimestampToolModel {
    /// The live "now" instant (web `now` state). Advanced by ``tick(_:)`` from the
    /// view's 1 Hz timer; drives the header and the relative-time rows.
    public private(set) var now: Date

    /// The Unix-field text (web `unix`).
    public var unixInput: String

    /// The ISO-field text (web `iso`).
    public var isoInput: String

    /// Display locale for the "Local" row (web `toLocaleString` browser locale).
    @ObservationIgnored public let locale: Locale

    /// Display timezone for the "Local" row + timezone-less ISO parsing (web
    /// browser timezone).
    @ObservationIgnored public let timeZone: TimeZone

    @ObservationIgnored private let telemetry: any TimestampToolTelemetry
    @ObservationIgnored private var started = false

    public init(
        now: Date = Date(),
        unixInput: String = "",
        isoInput: String = "",
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        telemetry: any TimestampToolTelemetry = OSLogTimestampToolTelemetry()
    ) {
        self.now = now
        self.unixInput = unixInput
        self.isoInput = isoInput
        self.locale = locale
        self.timeZone = timeZone
        self.telemetry = telemetry
    }

    // MARK: Derived projections

    /// The live header values (web `Math.floor(now/1000)` + `now.toISOString()`).
    public var nowSnapshot: TimestampNow {
        TimestampProjector.now(now)
    }

    /// The Unix-field interpretation, or `nil` when empty/invalid.
    public var fromUnix: UnixInterpretation? {
        TimestampProjector.fromUnix(unixInput, now: now, locale: locale, timeZone: timeZone)
    }

    /// The ISO-field interpretation, or `nil` when empty/invalid.
    public var fromISO: IsoInterpretation? {
        TimestampProjector.fromISO(isoInput, now: now, locale: locale, timeZone: timeZone)
    }

    /// Render branch for the Unix field.
    public var unixPhase: TimestampFieldPhase {
        Self.phase(input: unixInput, isParsed: fromUnix != nil)
    }

    /// Render branch for the ISO field.
    public var isoPhase: TimestampFieldPhase {
        Self.phase(input: isoInput, isParsed: fromISO != nil)
    }

    private static func phase(input: String, isParsed: Bool) -> TimestampFieldPhase {
        if input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .empty }
        return isParsed ? .content : .invalid
    }

    // MARK: Intents

    /// Advances the live clock (web `setInterval(() => setNow(new Date()), 1000)`).
    public func tick(_ instant: Date = Date()) {
        now = instant
    }

    /// The web "Now" button: fills both fields from the current instant —
    /// `unix = String(Math.floor(Date.now()/1000))`, `iso = new Date().toISOString()`.
    public func useNow() {
        let snapshot = TimestampProjector.now(now)
        unixInput = String(snapshot.unixSeconds)
        isoInput = snapshot.iso
    }

    /// Emits the `view.opened` diagnostics event once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TimestampToolSurface.slug)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Spoken VoiceOver summaries for the live header and each field interpretation,
/// assembled through the surface i18n facade so the labels localize with the rest
/// of the surface.
public enum TimestampAccessibility {
    public static func nowSummary(_ snapshot: TimestampNow) -> String {
        let unix = TimestampToolStrings.string("Unix", "Unix")
        let iso = TimestampToolStrings.string("Iso", "Iso")
        return "\(unix) \(snapshot.unixSeconds). \(iso) \(snapshot.iso)"
    }

    public static func unixSummary(_ interpretation: UnixInterpretation) -> String {
        let iso = TimestampToolStrings.string("Iso", "Iso")
        let local = TimestampToolStrings.string("Local", "Local")
        let relative = TimestampToolStrings.string("Relative", "Relative")
        return "\(iso) \(interpretation.iso). \(local) \(interpretation.local). "
            + "\(relative) \(TimestampToolStrings.relative(interpretation.relative))"
    }

    public static func isoSummary(_ interpretation: IsoInterpretation) -> String {
        let unix = TimestampToolStrings.string("Unix", "Unix")
        let local = TimestampToolStrings.string("Local", "Local")
        let relative = TimestampToolStrings.string("Relative", "Relative")
        return "\(unix) \(interpretation.unixSeconds). \(local) \(interpretation.local). "
            + "\(relative) \(TimestampToolStrings.relative(interpretation.relative))"
    }
}

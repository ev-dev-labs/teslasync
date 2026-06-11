//
//  SecuritySection.Adapter.swift
//  TeslaSync — P4 feature view · 0298 · SecuritySection (Apple)
//
//  The testable projection core for the Security section — the SwiftUI parity of
//  features/vehicles/components/vehicle-detail/SecuritySection.tsx, including the web
//  helper it ships inline (`windowOpenCount`) and its defensive value coercion. Everything
//  here is pure + dependency-free (no store, no bundle, no rendered view), so the reading
//  model, the JS `Number()` / `String()` coercion ports, the window-open count, the door
//  resolution, the four card projections (value + accent + icon), and the VoiceOver
//  summaries are all unit tested alone.
//
//  Parity notes (presentational leaf — reproduces the web expressions VERBATIM):
//    • Locked  — `state.is_locked ? Yes : No`, lock / unlock glyph, green when locked.
//    • Sentry  — `state.sentry_mode ? Active : Off`, eye glyph, green when active.
//    • Doors   — `door_state` shown verbatim when present + non-empty (`String(door_state)`),
//                else localized "Closed"; cyan when a door state is present, else green.
//    • Windows — `{{count}} open` when `windowOpenCount > 0` else "Closed"; cyan when open,
//                else green. The count coerces each `*_window` field exactly as the web:
//                `typeof v === 'number' ? v : Number(v)`, counting finite readings `> 0`.
//  The icon-box accent mirrors the web `MetricCard` `color` (green → success, cyan → info).
//

import Foundation
import SwiftUI

// MARK: - JS coercion ports (`Number(v)` / `String(v)`)

/// Pure ports of the two JavaScript coercions the web component relies on, isolated so
/// the exact `Number()` / `String()` semantics (the heart of `windowOpenCount` and the
/// `String(door_state)` display) are unit tested without a view.
public enum SecuritySectionNumber {
    /// Port of JS `Number(string)`: leading/trailing whitespace is ignored, an
    /// empty/whitespace-only string is `0`, a fully-numeric string is its value, and any
    /// other string is `NaN` (the whole string must parse — partial matches are `NaN`).
    public static func jsNumber(_ string: String) -> Double {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return 0 }
        return Double(trimmed) ?? .nan
    }

    /// Port of JS `String(number)`: a whole value drops its fractional part ("0", "25"),
    /// a fractional value keeps its minimal decimal form ("25.5").
    public static func jsString(_ value: Double) -> String {
        guard value.isFinite else {
            return value.isNaN ? "NaN" : (value < 0 ? "-Infinity" : "Infinity")
        }
        if value == value.rounded(.towardZero), abs(value) < 1e15 {
            return String(Int(value))
        }
        return String(value)
    }
}

// MARK: - Signal value (web `string | boolean | null` door/window union)

/// One door/window signal reading — the native mirror of the web union the backend
/// serializes for `door_state` / `*_window` (`string | boolean | null`, a raw
/// `signal.SignalValue`). A `number` case is carried too so a numeric JSON percentage is
/// represented losslessly. Absence is modelled by the field being `nil` (the web
/// `v == null` guard).
public enum SecuritySectionSignalValue: Equatable, Sendable {
    case number(Double)
    case bool(Bool)
    case string(String)

    /// The web `typeof v === 'number' ? v : Number(v)` coercion used by
    /// `windowOpenCount`. A boolean coerces as JS does (`true → 1`, `false → 0`); a
    /// string runs `Number()`; a number is itself.
    public var numericReading: Double {
        switch self {
        case let .number(value): value
        case let .bool(flag): flag ? 1 : 0
        case let .string(text): SecuritySectionNumber.jsNumber(text)
        }
    }

    /// The web `String(v)` coercion used to render `door_state`. A boolean renders
    /// "true" / "false"; a number uses JS number-to-string; a string is itself.
    public var stringValue: String {
        switch self {
        case let .number(value): SecuritySectionNumber.jsString(value)
        case let .bool(flag): flag ? "true" : "false"
        case let .string(text): text
        }
    }

    /// Whether the raw value is the empty string — the web `door_state !== ''` guard,
    /// which excludes only an empty string (a boolean / number always passes).
    var isEmptyString: Bool {
        if case let .string(text) = self { return text.isEmpty }
        return false
    }
}

// MARK: - Reading (web `securityData` fields + `state` flags the section consumes)

/// The fields the section renders — the native mirror of the web `securityData`
/// (`SecurityEvent`) members the component reads, plus the two `state` (`VehicleState`)
/// flags. The door/window signals are optional (the web `?? ` / `== null` guards); the
/// lock / sentry flags come from the always-present `state` prop but are only surfaced
/// when a security reading exists (the web `securityData ? grid : empty` gate).
public struct SecuritySectionReading: Equatable, Sendable {
    // From `state` (VehicleState).
    public var isLocked: Bool
    public var sentryMode: Bool

    // From `securityData` (SecurityEvent). Each is optional per the web guards.
    public var doorState: SecuritySectionSignalValue?
    public var frontDriverWindow: SecuritySectionSignalValue?
    public var frontPassengerWindow: SecuritySectionSignalValue?
    public var rearDriverWindow: SecuritySectionSignalValue?
    public var rearPassengerWindow: SecuritySectionSignalValue?

    public init(
        isLocked: Bool = false,
        sentryMode: Bool = false,
        doorState: SecuritySectionSignalValue? = nil,
        frontDriverWindow: SecuritySectionSignalValue? = nil,
        frontPassengerWindow: SecuritySectionSignalValue? = nil,
        rearDriverWindow: SecuritySectionSignalValue? = nil,
        rearPassengerWindow: SecuritySectionSignalValue? = nil
    ) {
        self.isLocked = isLocked
        self.sentryMode = sentryMode
        self.doorState = doorState
        self.frontDriverWindow = frontDriverWindow
        self.frontPassengerWindow = frontPassengerWindow
        self.rearDriverWindow = rearDriverWindow
        self.rearPassengerWindow = rearPassengerWindow
    }

    /// The displayed door state — the web
    /// `door_state != null && door_state !== '' ? String(door_state) : null`: a present,
    /// non-empty-string value rendered through the `String(v)` coercion, else `nil`
    /// (which the view renders as localized "Closed").
    var resolvedDoorState: String? {
        guard let doorState, !doorState.isEmptyString else { return nil }
        return doorState.stringValue
    }

    /// The number of windows reading open — the web `windowOpenCount`: over the four
    /// `*_window` fields, coerce each with `numericReading` and count the finite values
    /// strictly greater than zero (a `nil` field is skipped, a `NaN` coercion is not
    /// finite so is not counted).
    var windowOpenCount: Int {
        let fields = [frontDriverWindow, frontPassengerWindow, rearDriverWindow, rearPassengerWindow]
        var open = 0
        for field in fields {
            guard let field else { continue }
            let value = field.numericReading
            if value.isFinite, value > 0 { open += 1 }
        }
        return open
    }
}

// MARK: - Accent (web `MetricCard` `color` → semantic token)

/// The icon-box accent for a tile — the native mirror of the web `MetricCard` `color`
/// prop (the only thing `color` tints is the icon chip's bg / ring / glyph). The web
/// palette used by this section is green / cyan; mapped to the shared semantic tokens so
/// the hex map lives once, in tokens.
public enum SecuritySectionAccent: String, Sendable, Equatable, CaseIterable {
    /// Web `color="green"` → success token (the "safe / secured" tint).
    case success
    /// Web `color="cyan"` → info token (the cyan brand accent, the "attention" tint).
    case info

    /// The resolved colour for the icon glyph + its tinted chip.
    public var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        }
    }
}

// MARK: - Metric kind (the four web `MetricCard`s)

/// The four security metrics the section renders, in web composition order. The kind
/// drives the i18n label; the value, accent, and icon are computed by the projection
/// (the lock tile's glyph flips with state, so the icon is per-card, not per-kind).
public enum SecuritySectionMetricKind: String, Sendable, Equatable, CaseIterable {
    case locked
    case sentry
    case doors
    case windows

    /// The i18n key for the tile label (web `t(key, default)`).
    public var labelKey: String {
        switch self {
        case .locked: "common.locked"
        case .sentry: "common.sentry"
        case .doors: "vehicles.detail.doors"
        case .windows: "vehicles.detail.windows"
        }
    }

    /// The web English fallback for the tile label.
    public var labelFallback: String {
        switch self {
        case .locked: "Locked"
        case .sentry: "Sentry"
        case .doors: "Doors"
        case .windows: "Windows"
        }
    }
}

// MARK: - Value (the resolved per-tile content, before i18n)

/// The semantic value of one tile — kept abstract so the i18n-dependent variants
/// (`Yes`/`No`, `Active`/`Off`, `Closed`, `{{count}} open`) resolve through the facade in
/// the view, while the locale-independent door string carries its final text. Unit tested
/// directly (no rendering needed).
public enum SecuritySectionValue: Equatable, Sendable {
    /// The Locked tile — the view renders the localized "Yes" / "No".
    case yesNo(Bool)
    /// The Sentry tile — the view renders the localized "Active" / "Off".
    case activeOff(Bool)
    /// The Doors tile with a present state — the raw door string shown verbatim.
    case text(String)
    /// A "secured" tile (Doors with no state, or Windows with none open) — the view
    /// renders the localized "Closed".
    case closed
    /// The Windows tile with `count` windows open — the view renders "{{count}} open".
    case windowsOpen(Int)
}

// MARK: - Card (one projected tile: kind + value + accent + icon)

/// The view-ready projection of one tile — its kind (label), its semantic value, its
/// icon-box accent, and the SF Symbol mirroring the web lucide glyph. `Identifiable` over
/// the kind so the grid is stable.
public struct SecuritySectionCard: Identifiable, Equatable, Sendable {
    public var id: SecuritySectionMetricKind {
        kind
    }

    public let kind: SecuritySectionMetricKind
    public let value: SecuritySectionValue
    public let accent: SecuritySectionAccent
    public let systemImage: String

    public init(
        kind: SecuritySectionMetricKind,
        value: SecuritySectionValue,
        accent: SecuritySectionAccent,
        systemImage: String
    ) {
        self.kind = kind
        self.value = value
        self.accent = accent
        self.systemImage = systemImage
    }
}

// MARK: - Projection (web render values for the four `MetricCard`s)

/// The resolved, view-ready set of the four tiles — a pure function of one reading,
/// reproducing each web `MetricCard`'s value expression, `color` prop, and icon. The view
/// switches over `cards` so it holds no formatting logic.
public struct SecuritySectionProjection: Equatable, Sendable {
    public let cards: [SecuritySectionCard]

    public init(cards: [SecuritySectionCard]) {
        self.cards = cards
    }

    /// Builds the four tiles from a reading — the native port of the web component's
    /// per-card expressions (Locked / Sentry from `state`, Doors / Windows from
    /// `securityData`), including the green↔cyan accent flips and the lock / unlock glyph
    /// swap each tile does by state.
    public static func make(reading: SecuritySectionReading) -> SecuritySectionProjection {
        let locked = SecuritySectionCard(
            kind: .locked,
            value: .yesNo(reading.isLocked),
            accent: reading.isLocked ? .success : .info,
            systemImage: reading.isLocked ? "lock.fill" : "lock.open.fill"
        )
        let sentry = SecuritySectionCard(
            kind: .sentry,
            value: .activeOff(reading.sentryMode),
            accent: reading.sentryMode ? .success : .info,
            systemImage: "eye.fill"
        )
        let doorState = reading.resolvedDoorState
        let doors = SecuritySectionCard(
            kind: .doors,
            value: doorState.map(SecuritySectionValue.text) ?? .closed,
            accent: doorState != nil ? .info : .success,
            systemImage: "door.left.hand.closed"
        )
        let openWindows = reading.windowOpenCount
        let windows = SecuritySectionCard(
            kind: .windows,
            value: openWindows > 0 ? .windowsOpen(openWindows) : .closed,
            accent: openWindows > 0 ? .info : .success,
            systemImage: "car.fill"
        )
        return SecuritySectionProjection(cards: [locked, sentry, doors, windows])
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a labelled tile from its already-resolved
/// display strings. Pure + public so the spoken content is asserted without rendering the
/// view; empty fragments are dropped so the phrase never reads a stray comma.
public enum SecuritySectionAccessibility {
    public static func tileSummary(label: String, value: String) -> String {
        [label, value].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}

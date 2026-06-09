//
//  DoorWindowStatusWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  The testable parsing core: the cached door/window signal values → the four
//  per-corner `DoorWindowState`s and the open-count rollups. A faithful port of
//  the web `parseDoorStates` / `parseWindowState` helpers + the `doors`/`windows`
//  `useMemo` blocks. Pure + dependency-free so it can be unit-tested without a
//  store, a bundle, or a rendered view. The cached → cell projection lives in
//  DoorWindowStatusWidget.Projection.swift.
//

import Foundation
import SwiftUI

// MARK: - Position (web `'fl' | 'fr' | 'rl' | 'rr'`)

/// One of the four corners shared by the doors grid and the windows grid. The
/// `CaseIterable` order is the exact web `positions` order (`fl, fr, rl, rr`).
public enum DoorWindowPosition: String, Sendable, Equatable, CaseIterable {
    case fl
    case fr
    case rl
    case rr

    /// The P1/S10 label key (web `t('widget.doorWindow.<pos>', …)`).
    public var labelKey: String {
        switch self {
        case .fl: "widget.doorWindow.fl"
        case .fr: "widget.doorWindow.fr"
        case .rl: "widget.doorWindow.rl"
        case .rr: "widget.doorWindow.rr"
        }
    }

    /// The web English fallback for the label.
    public var labelFallback: String {
        switch self {
        case .fl: "Front Left"
        case .fr: "Front Right"
        case .rl: "Rear Left"
        case .rr: "Rear Right"
        }
    }
}

// MARK: - Per-corner state (web `DoorWindowState`)

/// The open/closed state of one door or window — the native port of the web
/// union `'closed' | 'open' | 'partial' | 'unknown'`.
public enum DoorWindowState: String, Sendable, Equatable, CaseIterable {
    case closed
    case open
    case partial
    case unknown

    /// Web `toGridStatus`: `closed → ok`, `open | partial → warning`,
    /// `unknown → unknown`.
    public var gridStatus: DoorWindowCellStatus {
        switch self {
        case .closed: .ok
        case .open, .partial: .warning
        case .unknown: .unknown
        }
    }

    /// Web `toValueLabel`: the localized cell value. `unknown` is the literal
    /// em-dash (the web returns `'—'` directly, not through `t`).
    public func valueLabel(localize: (String, String) -> String) -> String {
        switch self {
        case .closed: localize("widget.doorWindow.closed", "Closed")
        case .open: localize("widget.doorWindow.open", "Open")
        case .partial: localize("widget.doorWindow.partial", "Partial")
        case .unknown: "—"
        }
    }

    /// A spoken value for VoiceOver: identical to `valueLabel` except `unknown`
    /// reads as a word rather than the em-dash glyph.
    public func accessibilityValue(localize: (String, String) -> String) -> String {
        switch self {
        case .unknown: localize("widget.doorWindow.unknown", "Unknown")
        default: valueLabel(localize: localize)
        }
    }
}

// MARK: - Cell status (web `StatusCell['status']`)

/// The status carried by one grid cell, mirroring the web union
/// `'ok' | 'warning' | 'error' | 'inactive' | 'unknown'`. Each maps to a shared
/// `TSTone` + a tinting decision so the dot + chrome read like the web
/// `statusStyles` table. `error`/`inactive` are unused by this surface (the
/// door/window mapping only yields `ok`/`warning`/`unknown`) but are kept so the
/// type stays a faithful port of the shared `StatusCell` union.
public enum DoorWindowCellStatus: String, Sendable, Equatable, CaseIterable {
    case ok
    case warning
    case error
    case inactive
    case unknown

    /// The semantic tone for the status dot + tinted background.
    public var tone: TSTone {
        switch self {
        case .ok: .success
        case .warning: .warning
        case .error: .danger
        case .inactive, .unknown: .neutral
        }
    }

    /// Web `statusStyles` tints `ok/warning/error` and leaves `inactive/unknown`
    /// on the neutral surface fill.
    public var isTinted: Bool {
        switch self {
        case .ok, .warning, .error: true
        case .inactive, .unknown: false
        }
    }
}

// MARK: - The four-corner state set (web `doors` / `windows` records)

/// The parsed state of all four corners — the native port of the web
/// `Record<'fl'|'fr'|'rl'|'rr', DoorWindowState>`. `Equatable` so parsing can be
/// asserted in one shot; `subscript`/`values` keep the `fl, fr, rl, rr` order
/// stable for cell projection + open-count rollups.
public struct DoorWindowStates: Sendable, Equatable {
    public var fl: DoorWindowState
    public var fr: DoorWindowState
    public var rl: DoorWindowState
    public var rr: DoorWindowState

    public init(
        fl: DoorWindowState = .unknown,
        fr: DoorWindowState = .unknown,
        rl: DoorWindowState = .unknown,
        rr: DoorWindowState = .unknown
    ) {
        self.fl = fl
        self.fr = fr
        self.rl = rl
        self.rr = rr
    }

    public subscript(position: DoorWindowPosition) -> DoorWindowState {
        get {
            switch position {
            case .fl: fl
            case .fr: fr
            case .rl: rl
            case .rr: rr
            }
        }
        set {
            switch position {
            case .fl: fl = newValue
            case .fr: fr = newValue
            case .rl: rl = newValue
            case .rr: rr = newValue
            }
        }
    }

    /// The four states in `fl, fr, rl, rr` order.
    public var values: [DoorWindowState] {
        [fl, fr, rl, rr]
    }

    /// Every corner the same state (web `{ all 'closed' }` / `{ all 'open' }`).
    public static func uniform(_ state: DoorWindowState) -> DoorWindowStates {
        DoorWindowStates(fl: state, fr: state, rl: state, rr: state)
    }
}

// MARK: - Signal parsing (port of `parseDoorStates` / `parseWindowState`)

/// The pure door/window parsing the web computes in module helpers + the
/// `doors`/`windows` `useMemo`, lifted out so it can be unit-tested independently
/// of the cell projection.
public enum DoorWindowSignalParser {
    /// The ordered corner matchers for a door token (web `else if` ladder, first
    /// match wins). A token must also contain `open` to count — see `apply`.
    private static let doorMatchers: [(needles: [String], position: DoorWindowPosition)] = [
        (["driver", "front"], .fl),
        (["passenger", "front"], .fr),
        (["driver", "rear"], .rl),
        (["passenger", "rear"], .rr),
        (["front", "left"], .fl),
        (["front", "right"], .fr),
        (["rear", "left"], .rl),
        (["rear", "right"], .rr)
    ]

    /// Faithful port of the web `parseDoorStates`:
    /// - a native boolean is taken as-is (`true → all open`, `false → all
    ///   closed`);
    /// - an absent / empty string leaves every corner `unknown`;
    /// - an `all_closed` / `allclosed` token closes every corner;
    /// - otherwise every corner defaults to `closed` and each comma token opens
    ///   the corner it names (both `driver/passenger × front/rear` and
    ///   `front/rear × left/right` spellings, plus a bare `open` → all open).
    public static func parseDoorStates(_ value: DoorWindowSignalValue) -> DoorWindowStates {
        switch value {
        case let .boolean(open):
            .uniform(open ? .open : .closed)
        case .absent:
            .uniform(.unknown)
        case let .text(raw):
            parseDoorStates(raw)
        }
    }

    private static func parseDoorStates(_ raw: String) -> DoorWindowStates {
        let parts = raw
            .split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }

        guard !parts.isEmpty else { return .uniform(.unknown) }
        if parts.contains(where: { $0 == "all_closed" || $0 == "allclosed" }) {
            return .uniform(.closed)
        }

        var states = DoorWindowStates.uniform(.closed)
        for part in parts {
            apply(doorToken: part, to: &states)
        }
        return states
    }

    /// Opens the corner(s) named by one lowercased door token, mirroring the web
    /// ladder: a token must contain `open`; a bare `open` opens all four;
    /// otherwise the first matching corner is opened.
    private static func apply(doorToken part: String, to states: inout DoorWindowStates) {
        guard part.contains("open") else { return }
        if part == "open" {
            states = .uniform(.open)
            return
        }
        for matcher in doorMatchers where matcher.needles.allSatisfy({ part.contains($0) }) {
            states[matcher.position] = .open
            return
        }
    }

    /// Faithful port of the web `parseWindowState`: a native boolean maps to
    /// `open`/`closed`; an absent / empty string is `unknown`; a string of
    /// exactly `closed` is `closed`; one containing `vent` or `partial` is
    /// `partial`; anything else is `open`.
    public static func parseWindowState(_ value: DoorWindowSignalValue) -> DoorWindowState {
        switch value {
        case let .boolean(open):
            return open ? .open : .closed
        case .absent:
            return .unknown
        case let .text(raw):
            let lower = raw.lowercased()
            if lower.isEmpty { return .unknown }
            if lower == "closed" { return .closed }
            if lower.contains("vent") || lower.contains("partial") { return .partial }
            return .open
        }
    }

    /// The window states across the four fields, in `fl, fr, rl, rr` order — the
    /// web `windows` `useMemo` (`fl ← fd`, `fr ← fp`, `rl ← rd`, `rr ← rp`).
    public static func windowStates(from latest: DoorWindowLatestInput) -> DoorWindowStates {
        DoorWindowStates(
            fl: parseWindowState(latest.frontDriverWindow),
            fr: parseWindowState(latest.frontPassengerWindow),
            rl: parseWindowState(latest.rearDriverWindow),
            rr: parseWindowState(latest.rearPassengerWindow)
        )
    }

    /// Open-door count — web `Object.values(doors).filter(s => s === 'open')`.
    public static func openCount(doors: DoorWindowStates) -> Int {
        doors.values.count(where: { $0 == .open })
    }

    /// Open-window count — web `filter(s => s !== 'closed' && s !== 'unknown')`,
    /// i.e. `open` and `partial` both count.
    public static func openCount(windows: DoorWindowStates) -> Int {
        windows.values.count(where: { $0 != .closed && $0 != .unknown })
    }
}

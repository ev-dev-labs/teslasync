//
//  WindowStatusDetail.Adapter.swift
//  TeslaSync — P4 feature view · 0049 · WindowStatusDetail (Apple)
//
//  The testable projection core for the Window Status Detail surface — the SwiftUI
//  parity of features/admin/components/security-access/WindowStatusDetail.tsx plus the
//  `parseWindowState` defensive normaliser it is fed by (helpers.ts). Everything here
//  is pure + dependency-free (no store, no bundle, no rendered view) so the wire-shape
//  handling, the per-window state derivation, the closed/open summary, and the
//  VoiceOver summaries are all unit tested in isolation.
//

import Foundation

// MARK: - Window state (web `WindowStatusDetailState`)

/// The four derived window states (web `WindowStatusDetailState` union). The raw value is the
/// lower-cased `slug` used to build the `admin.security.windowState.{slug}` i18n key,
/// and `fallback` is the web English default passed to `t(key, default)`.
public enum WindowStatusDetailState: String, Sendable, Equatable, CaseIterable {
    case closed
    case venting
    case open
    case unknown

    /// The i18n key suffix (web `state.toLowerCase()`).
    public var slug: String {
        rawValue
    }

    /// The English fallback (web `t('…' + slug, state)` where `state` is the cased word).
    public var fallback: String {
        switch self {
        case .closed: "Closed"
        case .venting: "Venting"
        case .open: "Open"
        case .unknown: "Unknown"
        }
    }
}

// MARK: - Window signal (web `string | boolean | null`)

/// One window's raw signal value as the backend serialises it (web SecurityEvent
/// `fdWindow: string | boolean | null`). Modeled as a closed enum so the parser's
/// string-only coercion (web `asNonEmptyString`) is reproduced exactly: a boolean or
/// an absent value can never coerce to a window state and resolves to `.unknown`.
public enum WindowSignal: Sendable, Equatable {
    case string(String)
    case bool(Bool)
    case absent

    /// Non-empty-string coercion (web `asNonEmptyString`): a non-empty string, else nil.
    public var nonEmptyString: String? {
        if case let .string(value) = self, !value.isEmpty { return value }
        return nil
    }
}

// MARK: - Window position (web WINDOW_KEYS)

/// The four cabin windows the surface reports, in the web source's render order. The
/// raw value is the web SecurityEvent field stem, used to build the
/// `admin.security.window.{fd|fp|rd|rp}` label key.
public enum WindowPosition: String, Sendable, Equatable, CaseIterable, Identifiable {
    case fd
    case fp
    case rd
    case rp

    public var id: String {
        rawValue
    }

    /// The label i18n key (web `win.i18nKey`).
    public var labelKey: String {
        "admin.security.window.\(rawValue)"
    }

    /// The English fallback (web `win.fallback`).
    public var labelFallback: String {
        switch self {
        case .fd: "Front Driver"
        case .fp: "Front Passenger"
        case .rd: "Rear Driver"
        case .rp: "Rear Passenger"
        }
    }
}

// MARK: - Event snapshot (web `SecurityEvent` window subset)

/// The window subset of the `/security/latest` row the surface reads (web
/// `SecurityEvent`). Only the four window signals (plus the record time, used for the
/// freshness summary) are modeled — the production source projects these from the
/// shared security state holder; tests construct values directly.
public struct WindowStatusEvent: Sendable, Equatable {
    public let frontDriver: WindowSignal
    public let frontPassenger: WindowSignal
    public let rearDriver: WindowSignal
    public let rearPassenger: WindowSignal
    public let recordedAt: Date?

    public init(
        frontDriver: WindowSignal = .absent,
        frontPassenger: WindowSignal = .absent,
        rearDriver: WindowSignal = .absent,
        rearPassenger: WindowSignal = .absent,
        recordedAt: Date? = nil
    ) {
        self.frontDriver = frontDriver
        self.frontPassenger = frontPassenger
        self.rearDriver = rearDriver
        self.rearPassenger = rearPassenger
        self.recordedAt = recordedAt
    }

    /// The signal for a position (web `latest?.[win.key]`).
    public func signal(for position: WindowPosition) -> WindowSignal {
        switch position {
        case .fd: frontDriver
        case .fp: frontPassenger
        case .rd: rearDriver
        case .rp: rearPassenger
        }
    }
}

// MARK: - Resolved cell (web grid item)

/// One resolved window card — a position paired with its derived state. `id` is the
/// position stem so the grid's list identity is collision-free.
public struct WindowCell: Identifiable, Equatable, Sendable {
    public let position: WindowPosition
    public let state: WindowStatusDetailState

    public var id: String {
        position.rawValue
    }

    public init(position: WindowPosition, state: WindowStatusDetailState) {
        self.position = position
        self.state = state
    }
}

// MARK: - Render phase (native states contract)

/// The mutually-exclusive render branches the surface switches over. The web leaf
/// always renders the grid; the native surface adds the loading / error / empty chrome
/// the Apple HIG states contract requires, while `empty` still renders the four cards
/// (all `.unknown`) so a missing snapshot is never a blank box.
public enum WindowStatusPhase: Sendable, Equatable {
    case loading
    case error(String)
    case empty
    case data
}

// MARK: - Projection (port of web `parseWindowState` + render ladder)

/// Pure projection from the input snapshot to view-ready state — the native port of
/// the web component's grid derivation and the `parseWindowState` helper. Unit tested
/// across every branch.
public enum WindowStatusProjection {
    /// Derives a window state from its raw signal — a faithful port of web
    /// `parseWindowState`: only a non-empty string coerces (web `asNonEmptyString`);
    /// `"closed"`/`"0"` → Closed; any value containing `"vent"` → Venting; any other
    /// non-empty value → Open; an empty/boolean/absent value → Unknown. The web ladder's
    /// final `lower !== '0'` branch means every recognised non-empty value resolves, so
    /// the trailing Unknown is reachable only for the empty/boolean/absent inputs above.
    public static func parseWindowState(_ signal: WindowSignal) -> WindowStatusDetailState {
        guard let raw = signal.nonEmptyString else { return .unknown }
        let lower = raw.lowercased()
        if lower == "closed" || lower == "0" { return .closed }
        if lower.contains("vent") { return .venting }
        if lower.contains("open") || lower != "0" { return .open }
        return .unknown
    }

    /// The four resolved cells in web render order. A nil snapshot yields four
    /// `.unknown` cells (web renders the grid with `latest?.[key]` undefined).
    public static func cells(from event: WindowStatusEvent?) -> [WindowCell] {
        WindowPosition.allCases.map { position in
            WindowCell(position: position, state: parseWindowState(event?.signal(for: position) ?? .absent))
        }
    }

    /// Resolves the render phase from the source load status (web `isLoading` / failure
    /// / resolved) and whether a snapshot is present.
    public static func resolvePhase(_ status: WindowStatusLoadStatus, hasEvent: Bool) -> WindowStatusPhase {
        switch status {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .empty: .empty
        case .loaded: hasEvent ? .data : .empty
        }
    }

    /// True when every window is Closed (web `allWindowsClosed`).
    public static func allClosed(_ cells: [WindowCell]) -> Bool {
        !cells.isEmpty && cells.allSatisfy { $0.state == .closed }
    }

    /// The count of windows that are not Closed (web `windowSummary` open/venting count,
    /// `states.filter((s) => s !== 'Closed').length`).
    public static func notClosedCount(_ cells: [WindowCell]) -> Int {
        cells.count(where: { $0.state != .closed })
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the window cards. Pure + public so the spoken
/// content is asserted without rendering the view.
public enum WindowStatusAccessibility {
    /// A single card's spoken label, e.g. "Front Driver, Closed".
    public static func cellSummary(positionLabel: String, stateLabel: String) -> String {
        "\(positionLabel), \(stateLabel)"
    }
}

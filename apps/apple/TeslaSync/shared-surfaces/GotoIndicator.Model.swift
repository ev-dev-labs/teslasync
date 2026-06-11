//
//  GotoIndicator.Model.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the goto indicator. The view binds through `GotoIndicatorModel`; no networking lives
//  in the view. The web `GotoIndicator` is a controlled presentational component — the parent (a
//  keyboard-navigation controller) supplies a single `visible` flag and the banner shows the "Go to…"
//  chord when visible / nothing otherwise. The native model keeps the same contract: a source emits the
//  controlled visibility plus the controller's load / connectivity state, the model derives the resolved
//  indicator over it, exposes a render `phase`, and auto-refreshes once when the feed transitions to
//  stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum GotoIndicatorSurface {
    public static let slug = "GotoIndicator"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol GotoIndicatorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogGotoIndicatorTelemetry: GotoIndicatorTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound shortcut controller — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum GotoConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (controlled visibility + controller lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled visibility (the web `visible` prop;
/// `nil` until the controller has resolved a value, which drives the loading chrome) plus the
/// controller's lifecycle (`isLoading`, an error message, and connectivity).
public struct GotoIndicatorInput: Sendable, Equatable {
    /// Web `visible` — `true` shows the chord, `false` hides it, `nil` means the controller has not yet
    /// reported (the initial loading window).
    public var visibility: Bool?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: GotoConnection

    public init(
        visibility: Bool? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: GotoConnection = .live
    ) {
        self.visibility = visibility
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived hint: the resolved prompt, the ordered key
/// caps, the visual separator, and the pre-composed spoken accessibility hint. A pure value so the view
/// is a function of it and snapshot tests assert it directly.
public struct GotoIndicatorHint: Sendable, Equatable {
    public let prompt: String
    public let keys: [String]
    public let separator: String
    public let accessibilityHint: String

    public init(prompt: String, keys: [String], separator: String, accessibilityHint: String) {
        self.prompt = prompt
        self.keys = keys
        self.separator = separator
        self.accessibilityHint = accessibilityHint
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived `hint`
/// payload is pre-computed so the view is a pure function of this value.
public struct GotoIndicatorResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let hint: GotoIndicatorHint?

    public init(phase: Phase, hint: GotoIndicatorHint?) {
        self.phase = phase
        self.hint = hint
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// indicator's control flow plus the P4 leaf contract:
///   • a controller read failure surfaces as `error`, unless a visibility is already known (which stays
///     rendered behind a transient failure — the P4 leaf contract).
///   • the initial read with no resolved visibility is `loading`.
///   • `visible == false` (web `if (!visible) return null`) is the friendly `empty` (the native
///     improvement over the web component rendering nothing — never a blank box).
///   • `visible == true` renders the `data` hint with its pre-composed chord + spoken copy.
/// Unit tested across every branch.
public enum GotoIndicatorProjection {
    public static func resolve(
        input: GotoIndicatorInput,
        strings: GotoResolve = GotoStrings.string
    ) -> GotoIndicatorResolved {
        if let message = input.errorMessage, !message.isEmpty {
            if let visible = input.visibility {
                return resolved(forVisible: visible, strings: strings)
            }
            return GotoIndicatorResolved(phase: .error(message), hint: nil)
        }
        if input.isLoading {
            if let visible = input.visibility {
                return resolved(forVisible: visible, strings: strings)
            }
            return GotoIndicatorResolved(phase: .loading, hint: nil)
        }
        guard let visible = input.visibility else {
            return GotoIndicatorResolved(phase: .loading, hint: nil)
        }
        return resolved(forVisible: visible, strings: strings)
    }

    private static func resolved(forVisible visible: Bool, strings: GotoResolve) -> GotoIndicatorResolved {
        guard visible else {
            return GotoIndicatorResolved(phase: .empty, hint: nil)
        }
        return GotoIndicatorResolved(phase: .data, hint: hint(strings: strings))
    }

    /// Builds the data payload — the resolved prompt, the ordered key caps, the visual separator, and
    /// the spoken accessibility hint.
    public static func hint(strings: GotoResolve = GotoStrings.string) -> GotoIndicatorHint {
        let prompt = strings("shortcuts.goto", "Go to...")
        let keys = GotoChord.keys(strings: strings)
        let separator = GotoChord.separator(strings: strings)
        let spoken = GotoChord.spoken(keys: keys, strings: strings)
        return GotoIndicatorHint(
            prompt: prompt,
            keys: keys,
            separator: separator,
            accessibilityHint: GotoAccessibility.hint(spokenChord: spoken, strings: strings)
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `GotoIndicatorSource`, recomputes the resolved
/// projection, exposes a render `phase` + the resolved view-state and the `connection` axis, emits the
/// one-shot `view.opened` diagnostics event, and auto-refreshes once when the controller transitions to
/// stale.
@MainActor
@Observable
public final class GotoIndicatorModel {
    public private(set) var resolved = GotoIndicatorResolved(phase: .loading, hint: nil)
    public private(set) var connection: GotoConnection = .live

    public var phase: GotoIndicatorResolved.Phase {
        resolved.phase
    }

    public var hint: GotoIndicatorHint? {
        resolved.hint
    }

    @ObservationIgnored private let source: any GotoIndicatorSource
    @ObservationIgnored private let telemetry: any GotoIndicatorTelemetry
    @ObservationIgnored private let strings: GotoResolve
    @ObservationIgnored private var started = false

    public init(
        source: any GotoIndicatorSource,
        telemetry: any GotoIndicatorTelemetry = OSLogGotoIndicatorTelemetry(),
        strings: @escaping GotoResolve = GotoStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GotoIndicatorSurface.slug)
        source.start()
    }

    /// Stops observing the upstream controller.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: GotoIndicatorInput) {
        resolved = GotoIndicatorProjection.resolve(input: input, strings: strings)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "GotoIndicator" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum GotoStrings {
    public static let table = "GotoIndicator"

    public static let string: GotoResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

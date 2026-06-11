//
//  GuardedLink.Model.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the navigation-guard link. The view binds through `GuardedLinkModel`; no router and
//  no networking live in the view. The web `GuardedLink` consumes two hooks — `useNavigate` (to perform
//  the navigation) and `useNavigationGuardContext` (to `confirmIfDirty()` before leaving). The native
//  model keeps the same split: a `NavigationGuardSource` emits the controlled link inputs (destination
//  + forwarded options) plus the live guard state (dirty + the guard's optional message) and the
//  store's load / connectivity state; a `GuardedNavigator` performs the navigation. The model derives
//  the resolved view-state, runs the guard-or-navigate flow, owns the confirm request the view renders
//  as a confirmation dialog, and auto-refreshes once when the guard feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum GuardedLinkSurface {
    public static let slug = "GuardedLink"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol GuardedLinkTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogGuardedLinkTelemetry: GuardedLinkTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound guard feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it (the guard's dirty state may be out of
/// date when the feed is not live).
public enum GuardedLinkConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (controlled link props + live guard state)

/// One coalesced snapshot of the surface's inputs — the controlled link props (the web `to` + the
/// forwarded `replace` / `relative` / `state`) plus the live guard state (`isDirty` and the guard's
/// optional confirm message, the web `useNavigationGuardContext`) and the store's lifecycle
/// (`isLoading`, an error message, and connectivity).
public struct GuardedLinkInput: Sendable, Equatable {
    public var destination: GuardedDestination?
    public var options: GuardedNavigationOptions
    public var isDirty: Bool
    public var guardMessage: String?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: GuardedLinkConnection

    public init(
        destination: GuardedDestination? = nil,
        options: GuardedNavigationOptions = GuardedNavigationOptions(),
        isDirty: Bool = false,
        guardMessage: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: GuardedLinkConnection = .live
    ) {
        self.destination = destination
        self.options = options
        self.isDirty = isDirty
        self.guardMessage = guardMessage
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived, tappable link: the destination, the
/// forwarded navigation options, the live dirty flag, and the guard's optional confirm message. A pure
/// value so the view is a function of it and snapshot tests assert it directly.
public struct GuardedLinkData: Sendable, Equatable {
    public let destination: GuardedDestination
    public let options: GuardedNavigationOptions
    public let isDirty: Bool
    public let guardMessage: String?

    public init(
        destination: GuardedDestination,
        options: GuardedNavigationOptions,
        isDirty: Bool,
        guardMessage: String?
    ) {
        self.destination = destination
        self.options = options
        self.isDirty = isDirty
        self.guardMessage = guardMessage
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived `data`
/// payload is pre-computed so the view is a pure function of this value.
public struct GuardedLinkResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: GuardedLinkData?

    public init(phase: Phase, data: GuardedLinkData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Confirm request (web `<ConfirmDialog>` shown by `confirmIfDirty`)

/// The pending unsaved-changes confirmation — the native parity of the dialog the web
/// `NavigationGuardProvider` renders when `confirmIfDirty()` finds a dirty guard. It captures the copy
/// plus the navigation it will perform on "Discard changes" (the web closure captures `to` at click
/// time), so the answer drives exactly the navigation the activation requested. `Identifiable` by
/// destination so the value is deterministic under test (no random id).
public struct GuardedConfirmRequest: Identifiable, Sendable, Equatable {
    public let message: String
    public let destination: GuardedDestination
    public let options: GuardedNavigationOptions

    public var id: String {
        destination.path
    }

    public init(message: String, destination: GuardedDestination, options: GuardedNavigationOptions) {
        self.message = message
        self.destination = destination
        self.options = options
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the link's
/// readiness plus the P4 leaf contract:
///   • a store read failure surfaces as `error`, unless a usable destination is still present (the
///     link stays tappable behind a transient guard-feed failure — the P4 leaf contract).
///   • the initial read with no destination yet is `loading`.
///   • a missing / blank destination (web `to` empty) is the friendly `empty`.
///   • a usable destination renders the tappable `data` link with its live dirty state.
/// Unit tested across every branch.
public enum GuardedLinkProjection {
    public static func resolve(input: GuardedLinkInput) -> GuardedLinkResolved {
        if let message = input.errorMessage, !message.isEmpty {
            if let data = payload(input) {
                return GuardedLinkResolved(phase: .data, data: data)
            }
            return GuardedLinkResolved(phase: .error(message), data: nil)
        }
        if input.isLoading {
            if let data = payload(input) {
                return GuardedLinkResolved(phase: .data, data: data)
            }
            return GuardedLinkResolved(phase: .loading, data: nil)
        }
        guard let data = payload(input) else {
            return GuardedLinkResolved(phase: .empty, data: nil)
        }
        return GuardedLinkResolved(phase: .data, data: data)
    }

    /// Builds the data payload when a usable (non-empty) destination is present; `nil` otherwise.
    private static func payload(_ input: GuardedLinkInput) -> GuardedLinkData? {
        guard let destination = input.destination, !destination.isEmpty else {
            return nil
        }
        return GuardedLinkData(
            destination: destination,
            options: input.options,
            isDirty: input.isDirty,
            guardMessage: input.guardMessage
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `NavigationGuardSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// runs the guard-or-navigate flow against an injected `GuardedNavigator`, owns the `confirmRequest`
/// the view renders as a confirmation dialog, and auto-refreshes once when the guard feed transitions
/// to stale.
@MainActor
@Observable
public final class GuardedLinkModel {
    public private(set) var resolved = GuardedLinkResolved(phase: .loading, data: nil)
    public private(set) var connection: GuardedLinkConnection = .live
    /// The pending unsaved-changes confirmation, or `nil` when no dialog is up (web `pending`).
    public private(set) var confirmRequest: GuardedConfirmRequest?

    public var phase: GuardedLinkResolved.Phase {
        resolved.phase
    }

    public var data: GuardedLinkData? {
        resolved.data
    }

    @ObservationIgnored private let source: any NavigationGuardSource
    @ObservationIgnored private let navigator: any GuardedNavigator
    @ObservationIgnored private let telemetry: any GuardedLinkTelemetry
    @ObservationIgnored private let strings: GuardedResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastConnection: GuardedLinkConnection = .live

    public init(
        source: any NavigationGuardSource,
        navigator: any GuardedNavigator,
        telemetry: any GuardedLinkTelemetry = OSLogGuardedLinkTelemetry(),
        strings: @escaping GuardedResolve = GuardedLinkStrings.string
    ) {
        self.source = source
        self.navigator = navigator
        self.telemetry = telemetry
        self.strings = strings
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GuardedLinkSurface.slug)
        source.start()
    }

    /// Stops observing the upstream guard feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// The web `onClick` handler: run the guard-or-navigate flow for an activation.
    ///   • a caller-consumed activation (web `e.defaultPrevented`) does nothing.
    ///   • a guard-bypassing activation (web `shouldSkipGuard`: modifier / non-primary / new context)
    ///     opens in a new context, leaving the current editor's unsaved work mounted.
    ///   • a clean guard navigates immediately (web `confirmIfDirty()` resolves `true`).
    ///   • a dirty guard raises the confirm request (web `<ConfirmDialog>`); navigation waits for it.
    public func activate(_ activation: GuardedActivation = .primary) {
        guard let data = resolved.data else { return }
        guard !activation.isPreempted else { return }
        if GuardDecision.shouldSkipGuard(activation) {
            navigator.openInNewContext(data.destination)
            return
        }
        if !data.isDirty {
            navigator.navigate(to: data.destination, options: data.options)
            return
        }
        confirmRequest = GuardedConfirmRequest(
            message: data.guardMessage ?? strings("forms.unsavedWarning", "You have unsaved changes. Discard them?"),
            destination: data.destination,
            options: data.options
        )
    }

    /// Web confirm "Discard changes": clear the dialog and perform the captured navigation.
    public func confirmDiscard() {
        guard let request = confirmRequest else { return }
        confirmRequest = nil
        navigator.navigate(to: request.destination, options: request.options)
    }

    /// Web confirm "Keep editing" (the `resolve(false)` path): clear the dialog, do not navigate.
    public func cancelConfirm() {
        confirmRequest = nil
    }

    private func apply(_ input: GuardedLinkInput) {
        resolved = GuardedLinkProjection.resolve(input: input)
        let previous = lastConnection
        connection = input.connection
        lastConnection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "GuardedLink" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum GuardedLinkStrings {
    public static let table = "GuardedLink"

    public static let string: GuardedResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

//
//  EditConflictBanner.Model.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the edit-conflict banner. The view binds through `EditConflictBannerModel`; no
//  networking lives in the view. The web `EditConflictBanner` wraps `useEditLease(resourceKey)` and
//  renders only when `!isOwner && otherTab !== null`; its single action — "Take over editing" — calls
//  `claim()`, which the lease hook implements by promoting this tab to owner (web `performClaim` sets
//  `isOwner = true`, `otherTab = null` and broadcasts). The native model keeps the same contract: a
//  source emits the coalesced lease snapshot (owner flag + peer + the store's load / connectivity
//  state), the model derives the resolved banner over it, forwards the take-over to the lease source
//  (optimistically promoting locally so the banner hides in lockstep, exactly as the web does), and
//  auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum EditConflictBannerSurface {
    public static let slug = "EditConflictBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol EditConflictBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogEditConflictBannerTelemetry: EditConflictBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound lease feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum EditConflictConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (lease state + resource identity + feed lifecycle)

/// One coalesced snapshot of the surface's inputs — the web `useEditLease` result (`isOwner` +
/// `otherTab`) for the controlled `resourceKey` / `resourceLabel`, plus the feed's lifecycle
/// (`isLoading`, an error message, and connectivity). The presence of a non-owning peer is the native
/// parity of the web banner's render guard.
public struct EditConflictInput: Sendable, Equatable {
    /// Web `isOwner` — this tab currently holds the edit lease.
    public var isOwner: Bool
    /// Web `otherTab` — the peer holding the lease, or `nil` when none has announced ownership.
    public var otherTab: EditConflictPeer?
    /// Web `resourceKey` prop — the stable identifier of the resource being edited.
    public var resourceKey: String
    /// Web `resourceLabel` prop — the optional human-readable noun folded into the body copy.
    public var resourceLabel: String?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: EditConflictConnection

    public init(
        isOwner: Bool = false,
        otherTab: EditConflictPeer? = nil,
        resourceKey: String = "",
        resourceLabel: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: EditConflictConnection = .live
    ) {
        self.isOwner = isOwner
        self.otherTab = otherTab
        self.resourceKey = resourceKey
        self.resourceLabel = resourceLabel
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// Web `!isOwner && otherTab !== null` — a real cross-tab edit conflict exists.
    public var hasConflict: Bool {
        !isOwner && otherTab != nil
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived banner: the headline, the (possibly
/// label-qualified) body copy, the two affordance labels, and the resource / peer identity carried
/// through for the web `data-resource-key` / `data-other-tab-id` parity. A pure value so the view is a
/// function of it and snapshot tests assert it directly.
public struct EditConflictBannerData: Sendable, Equatable {
    public let title: String
    public let body: String
    public let takeOverLabel: String
    public let switchHint: String
    public let resourceKey: String
    public let otherTabID: String

    public init(
        title: String,
        body: String,
        takeOverLabel: String,
        switchHint: String,
        resourceKey: String,
        otherTabID: String
    ) {
        self.title = title
        self.body = body
        self.takeOverLabel = takeOverLabel
        self.switchHint = switchHint
        self.resourceKey = resourceKey
        self.otherTabID = otherTabID
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived `data`
/// payload is pre-computed so the view is a pure function of this value.
public struct EditConflictResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: EditConflictBannerData?

    public init(phase: Phase, data: EditConflictBannerData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// banner's control flow plus the P4 leaf contract:
///   • a feed read failure surfaces as `error`, unless a conflict is still observed (which stays visible
///     behind a transient failure, the P4 leaf contract).
///   • the initial lease election with no observed conflict is `loading` (web's pre-election window).
///   • no conflict (web `if (isOwner || otherTab === null) return null`) is the friendly `empty` — the
///     native improvement over the web component rendering nothing, never a blank box.
///   • an observed conflict renders the `data` banner with its pre-composed copy.
/// Unit tested across every branch.
public enum EditConflictProjection {
    public static func resolve(
        input: EditConflictInput,
        strings: EditConflictResolve = EditConflictStrings.string
    ) -> EditConflictResolved {
        if let message = input.errorMessage, !message.isEmpty {
            if input.hasConflict {
                return EditConflictResolved(phase: .data, data: payload(input, strings))
            }
            return EditConflictResolved(phase: .error(message), data: nil)
        }
        if input.isLoading {
            if input.hasConflict {
                return EditConflictResolved(phase: .data, data: payload(input, strings))
            }
            return EditConflictResolved(phase: .loading, data: nil)
        }
        guard input.hasConflict else {
            return EditConflictResolved(phase: .empty, data: nil)
        }
        return EditConflictResolved(phase: .data, data: payload(input, strings))
    }

    private static func payload(
        _ input: EditConflictInput,
        _ strings: EditConflictResolve
    ) -> EditConflictBannerData {
        EditConflictBannerData(
            title: EditConflictMessage.title(strings: strings),
            body: EditConflictMessage.body(resourceLabel: input.resourceLabel, strings: strings),
            takeOverLabel: EditConflictMessage.takeOver(strings: strings),
            switchHint: EditConflictMessage.switchHint(strings: strings),
            resourceKey: input.resourceKey,
            otherTabID: input.otherTab?.tabID ?? ""
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `EditConflictSource`, recomputes the resolved
/// projection, exposes a render `phase` + the resolved view-state and the `connection` axis, forwards
/// the take-over to the lease source (optimistically promoting locally so the banner hides in lockstep
/// with the web `performClaim`), and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class EditConflictBannerModel {
    public private(set) var resolved = EditConflictResolved(phase: .loading, data: nil)
    public private(set) var connection: EditConflictConnection = .live

    public var phase: EditConflictResolved.Phase {
        resolved.phase
    }

    public var data: EditConflictBannerData? {
        resolved.data
    }

    @ObservationIgnored private let source: any EditConflictSource
    @ObservationIgnored private let telemetry: any EditConflictBannerTelemetry
    @ObservationIgnored private let strings: EditConflictResolve
    @ObservationIgnored private let onTakeOver: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastInput = EditConflictInput()

    public init(
        source: any EditConflictSource,
        telemetry: any EditConflictBannerTelemetry = OSLogEditConflictBannerTelemetry(),
        strings: @escaping EditConflictResolve = EditConflictStrings.string,
        onTakeOver: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        self.onTakeOver = onTakeOver
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EditConflictBannerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream lease feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Web "Take over editing" → `claim()`. Optimistically promotes this tab to owner so the banner
    /// hides immediately (web `performClaim` sets `isOwner = true`, `otherTab = null` locally), asks the
    /// lease source to perform the actual take-over (web broadcast of a fresh `lease.granted`), then
    /// notifies the parent. A later snapshot still governs, so the banner reappears if a new peer wins
    /// the lease back — the web tiebreaker behaviour.
    public func takeOver() {
        var promoted = lastInput
        promoted.isOwner = true
        promoted.otherTab = nil
        lastInput = promoted
        recompute(promoted)
        source.claim()
        onTakeOver?()
    }

    private func apply(_ input: EditConflictInput) {
        lastInput = input
        recompute(input)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute(_ input: EditConflictInput) {
        resolved = EditConflictProjection.resolve(input: input, strings: strings)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "EditConflictBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum EditConflictStrings {
    public static let table = "EditConflictBanner"

    public static let string: EditConflictResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

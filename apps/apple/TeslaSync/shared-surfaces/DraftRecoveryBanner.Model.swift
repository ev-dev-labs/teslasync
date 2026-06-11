//
//  DraftRecoveryBanner.Model.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the draft-recovery banner. The view binds through `DraftRecoveryBannerModel`; no
//  networking lives in the view. The web `DraftRecoveryBanner` is a controlled component — the parent
//  (an editor wired to `useFormDraft`) supplies `hasDraft` / `draftSavedAt` / `itemNoun` plus the
//  `onRestore` / `onDiscard` handlers, and the only internal state is a `dismissed` flag that hides
//  the banner once either action is taken. The native model keeps the same contract: a source emits
//  the controlled draft snapshot plus the store's load / connectivity state, the model derives the
//  resolved banner over it, tracks the `dismissed` flag, forwards the parent handlers, and
//  auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need
/// not reference the SwiftUI surface view to emit `view.opened`.
public enum DraftRecoveryBannerSurface {
    public static let slug = "DraftRecoveryBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol DraftRecoveryBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDraftRecoveryBannerTelemetry: DraftRecoveryBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound draft store — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum DraftRecoveryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (controlled draft + store lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled recovered draft (the web
/// `useFormDraft` `hasDraft` / `draftSavedAt` / `itemNoun`; `nil` when no draft was recovered) plus
/// the store's lifecycle (`isLoading`, an error message, and connectivity).
public struct DraftRecoveryInput: Sendable, Equatable {
    public var draft: DraftRecoveryDraft?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: DraftRecoveryConnection

    public init(
        draft: DraftRecoveryDraft? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: DraftRecoveryConnection = .live
    ) {
        self.draft = draft
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.data` phase — the fully-derived banner: the save instant, the optional
/// noun, and the pre-composed reassurance copy (web `message`). A pure value so the view is a
/// function of it and snapshot tests assert it directly.
public struct DraftRecoveryBannerData: Sendable, Equatable {
    public let savedAt: Date?
    public let itemNoun: String?
    public let message: String

    public init(savedAt: Date?, itemNoun: String?, message: String) {
        self.savedAt = savedAt
        self.itemNoun = itemNoun
        self.message = message
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the data phase the derived `data`
/// payload is pre-computed so the view is a pure function of this value.
public struct DraftRecoveryResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let data: DraftRecoveryBannerData?

    public init(phase: Phase, data: DraftRecoveryBannerData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot (+ the internal `dismissed` flag) to the resolved
/// view-state — the native port of the web banner's control flow plus the P4 leaf contract:
///   • dismissed (web `setDismissed(true)`) → the friendly empty state (web returns `null`).
///   • a store read failure surfaces as `error`, unless a cached draft is still present (which stays
///     visible behind a transient failure, the P4 leaf contract).
///   • the initial store read with no cached draft is `loading`.
///   • no recovered draft (web `if (!hasDraft) return null`) is the friendly `empty`.
///   • a recovered draft renders the `data` banner with its pre-composed copy.
/// Unit tested across every branch.
public enum DraftRecoveryProjection {
    public static func resolve(
        input: DraftRecoveryInput,
        now: Date = Date(),
        locale: Locale = .autoupdatingCurrent,
        dismissed: Bool = false,
        strings: DraftRecoveryResolve = DraftRecoveryStrings.string
    ) -> DraftRecoveryResolved {
        if dismissed {
            return DraftRecoveryResolved(phase: .empty, data: nil)
        }
        if let message = input.errorMessage, !message.isEmpty {
            if let draft = input.draft {
                return DraftRecoveryResolved(phase: .data, data: payload(draft, now, locale, strings))
            }
            return DraftRecoveryResolved(phase: .error(message), data: nil)
        }
        if input.isLoading {
            if let draft = input.draft {
                return DraftRecoveryResolved(phase: .data, data: payload(draft, now, locale, strings))
            }
            return DraftRecoveryResolved(phase: .loading, data: nil)
        }
        guard let draft = input.draft else {
            return DraftRecoveryResolved(phase: .empty, data: nil)
        }
        return DraftRecoveryResolved(phase: .data, data: payload(draft, now, locale, strings))
    }

    private static func payload(
        _ draft: DraftRecoveryDraft,
        _ now: Date,
        _ locale: Locale,
        _ strings: DraftRecoveryResolve
    ) -> DraftRecoveryBannerData {
        DraftRecoveryBannerData(
            savedAt: draft.savedAt,
            itemNoun: draft.itemNoun,
            message: DraftRecoveryMessage.render(draft: draft, now: now, locale: locale, strings: strings)
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `DraftRecoverySource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// tracks the `dismissed` flag, forwards the parent handlers (`restore` / `discard`), and
/// auto-refreshes once when the store transitions to stale.
@MainActor
@Observable
public final class DraftRecoveryBannerModel {
    public private(set) var resolved = DraftRecoveryResolved(phase: .loading, data: nil)
    public private(set) var connection: DraftRecoveryConnection = .live

    public var phase: DraftRecoveryResolved.Phase {
        resolved.phase
    }

    public var data: DraftRecoveryBannerData? {
        resolved.data
    }

    @ObservationIgnored private let source: any DraftRecoverySource
    @ObservationIgnored private let telemetry: any DraftRecoveryBannerTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private let onRestore: (@MainActor () -> Void)?
    @ObservationIgnored private let onDiscard: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var dismissed = false
    @ObservationIgnored private var lastInput = DraftRecoveryInput()

    public init(
        source: any DraftRecoverySource,
        telemetry: any DraftRecoveryBannerTelemetry = OSLogDraftRecoveryBannerTelemetry(),
        locale: Locale = .autoupdatingCurrent,
        clock: @escaping @Sendable () -> Date = { Date() },
        onRestore: (@MainActor () -> Void)? = nil,
        onDiscard: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.clock = clock
        self.onRestore = onRestore
        self.onDiscard = onDiscard
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DraftRecoveryBannerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream store.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Web `handleRestore`: dismiss + `onRestore?.()`. The draft is already applied to the editor on
    /// hydration, so this only acknowledges and hides the banner — it does NOT clear the stored draft.
    public func restore() {
        hide()
        onRestore?()
    }

    /// Web `handleDiscard`: dismiss + `onDiscard()`. Also clears the stored draft upstream so a
    /// re-emit cannot resurrect an acknowledged draft, then notifies the parent to reset its editor.
    public func discard() {
        hide()
        source.discardDraft()
        onDiscard?()
    }

    /// Sets the `dismissed` flag (web component state) and recomputes to the hidden/empty leaf.
    private func hide() {
        dismissed = true
        recompute(lastInput)
    }

    private func apply(_ input: DraftRecoveryInput) {
        lastInput = input
        recompute(input)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute(_ input: DraftRecoveryInput) {
        resolved = DraftRecoveryProjection.resolve(
            input: input,
            now: clock(),
            locale: locale,
            dismissed: dismissed
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "DraftRecoveryBanner" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum DraftRecoveryStrings {
    public static let table = "DraftRecoveryBanner"

    public static let string: DraftRecoveryResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

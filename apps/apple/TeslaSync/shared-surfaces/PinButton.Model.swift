//
//  PinButton.Model.swift
//  TeslaSync — P4 shared surface · 0222 · PinButton (Apple)
//
//  The telemetry seam (P1/S11), the i18n facade (P1/S10), and the observable state-holder (P1/S8) for the
//  shared pin affordance. The view binds through ``PinButtonModel``; no networking lives in the view. The
//  web component reads the unified pin query (`usePinned(itemType, context)`) and writes the toggle
//  mutation (`useTogglePin(itemType)`), disabling itself while the mutation is pending. The native model
//  keeps the same contract: a ``PinnedStore`` (bucket-scoped) feeds it, it recomputes the pure
//  ``PinButtonProjection``, forwards the toggle through the store (guarding the in-flight beat exactly as
//  the web `if (toggle.isPending) return`), auto-refreshes once when the set turns stale, and emits
//  `view.opened` exactly once per instance.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PinButtonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPinButtonTelemetry: PinButtonTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "PinButton" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum PinButtonStrings {
    public static let table = "PinButton"

    public static let string: PinButtonResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The tooltip + accessibility label for the current presentation (web `pin.pin` / `pin.unpin`).
    public static func tooltip(_ presentation: PinPresentation) -> String {
        string(presentation.tooltipKey, presentation.tooltipFallback)
    }

    /// The inline label for the current presentation when `showLabel` is set (web `pin.pin` /
    /// `pin.pinned`).
    public static func label(_ presentation: PinPresentation) -> String {
        string(presentation.labelKey, presentation.labelFallback)
    }

    /// The cold-load accessibility value (web has no visible copy — the button just renders unpinned).
    public static var loading: String {
        string("pin.loading", "Loading pins…")
    }

    /// The in-flight accessibility value (web `toggle.isPending`).
    public static var busy: String {
        string("pin.busy", "Updating…")
    }

    /// The VoiceOver "Retry" action title for the failed / stale badge.
    public static var retry: String {
        string("pin.status.retry", "Retry")
    }

    /// Composes the button's accessibility value: the busy / loading beat, then the degraded-set message,
    /// so VoiceOver announces the state the web folds into the toast + disabled flag. Empty when the
    /// button is idle + fresh (the value adds nothing over the pin/unpin label).
    public static func accessibilityValue(
        for projection: PinButtonProjection,
        localize: PinButtonResolve = string
    ) -> String {
        var parts: [String] = []
        if projection.isAwaitingFirstLoad {
            parts.append(localize("pin.loading", "Loading pins…"))
        } else if projection.isBusy {
            parts.append(localize("pin.busy", "Updating…"))
        }
        if let badge = projection.statusBadge {
            parts.append(badge.message(localize))
        }
        return parts.joined(separator: ". ")
    }
}

// MARK: - PinButtonModel (P1/S8) — binding + derivation + routing

/// The surface's observable state-holder. It owns the current ``PinButtonInput`` (the web props), binds
/// the bucket-scoped ``PinnedStore`` (web `usePinned` + `useTogglePin`), recomputes the pure
/// ``PinButtonProjection`` on every snapshot, routes the toggle through the store (guarding the in-flight
/// beat like the web `if (toggle.isPending) return`), auto-refreshes once when the set turns stale, and
/// emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class PinButtonModel {
    /// The current props (web `props`). Reassigned only on a real change so an unrelated re-render does
    /// not invalidate observers spuriously.
    public private(set) var input: PinButtonInput

    /// The resolved, view-ready button — recomputed from the props + the latest snapshot.
    public private(set) var projection: PinButtonProjection

    @ObservationIgnored private let store: any PinnedStore
    @ObservationIgnored private let telemetry: any PinButtonTelemetry
    @ObservationIgnored private var snapshot: PinnedSnapshot
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        input: PinButtonInput,
        store: any PinnedStore,
        telemetry: any PinButtonTelemetry = OSLogPinButtonTelemetry()
    ) {
        self.input = input
        self.store = store
        self.telemetry = telemetry
        let initial = PinnedSnapshot()
        snapshot = initial
        projection = PinButtonProjector.resolve(input, snapshot: initial)
        store.onChange = { [weak self] snapshot in self?.apply(snapshot) }
    }

    /// Begins observing the store and emits `view.opened` once. Idempotent across SwiftUI appear /
    /// disappear churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: PinButtonSurface.slug)
        }
        store.start()
    }

    /// Stops observing the store. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
        store.stop()
    }

    /// Re-requests the pin set (the failed / stale badge's retry affordance, web query refetch).
    public func refresh() {
        store.refresh()
    }

    /// Toggles the pin — the web `handleClick`: it stops the row's navigation (the SwiftUI button does
    /// not propagate by default, so no explicit stop is needed), bails while a mutation is in flight
    /// (`if (toggle.isPending) return`) or before the first load resolves, then writes the OPPOSITE of the
    /// current pinned-ness through the store (`toggle.mutate({ itemId, context, pin: !isPinned })`).
    public func toggle() {
        guard projection.isInteractive else { return }
        store.toggle(itemID: input.itemID, context: input.context, pinned: !projection.isPinned)
    }

    /// Replaces the props — the native peer of React re-rendering with new props (a reused button rebinds
    /// to a different row / size / label). Reassigns only on a real change, then re-resolves.
    public func update(_ input: PinButtonInput) {
        guard input != self.input else { return }
        self.input = input
        recompute()
    }

    private func apply(_ snapshot: PinnedSnapshot) {
        self.snapshot = snapshot
        recompute()
        handleAutoRefresh(for: snapshot.freshness)
    }

    private func recompute() {
        projection = PinButtonProjector.resolve(input, snapshot: snapshot)
    }

    /// Stale → one guarded auto-refresh; reset once fresh again so a later stale episode re-triggers
    /// exactly once. Offline keeps the cached set and does not auto-refresh (mirrors CookieConsentBanner).
    private func handleAutoRefresh(for freshness: PinFreshness) {
        switch freshness {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            store.refresh()
        case .fresh:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

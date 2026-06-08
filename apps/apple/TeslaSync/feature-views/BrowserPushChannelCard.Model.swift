//
//  BrowserPushChannelCard.Model.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  The state-holder seams the view binds through: the surface identity + the P1/S11
//  `view.opened` telemetry contract, the P1/S8 source that coalesces the web data
//  hooks into one snapshot, the `@Observable` view-model that resolves the render
//  phase, and the P1/S10 i18n facade (web `useTranslation`). Previews/tests drive
//  the model with the in-memory source; production wires a source over the shared
//  push state holders. No networking lives in the view.
//
//  Web source: features/notifications/components/BrowserPushChannelCard.tsx.
//  Its six data hooks map onto the single coalesced `BrowserPushChannelCardUpdate`:
//    - useWebPush()          → capability (notif/push support, permission, isSubscribed,
//                              currentEndpoint) + the enable()/disable() effects
//    - usePushPublicKey()    → capability.serverConfigured + capability.keyLoading
//                              (web `publicKey === null` ⇒ VAPID unconfigured)
//    - usePushSubscriptions()→ devices (the registered-device rows) + load status
//    - useUnsubscribePush()  → the per-row remove(endpoint) effect
//  Keys arrive snake_case from `GET /push/subscribe` (`PushSubscriptionRow`); the
//  value types below carry only the fields this card reads.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `BrowserPushChannelCard` feature view.
/// The slug is emitted with the P1/S11 `view.opened` contract and is referenced by
/// both the view and its tests so the two never drift. Kept Foundation-side so the
/// model + tests build without a rendering host.
public enum BrowserPushChannelCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "BrowserPushChannelCard"

    /// Reports the surface becoming visible — the exact path the view runs on
    /// appear, factored out so it is unit-testable without a host.
    public static func reportOpen(to telemetry: any BrowserPushChannelCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. `Sendable` (members non-isolated) so the model can
/// emit from the main actor without a hop.
public protocol BrowserPushChannelCardTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no endpoint, user-agent, or
/// payload is ever recorded.
public struct OSLogBrowserPushChannelCardTelemetry: BrowserPushChannelCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default[, { when }])`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "BrowserPushChannelCard" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; kept
/// per-surface so each parallel prompt owns its own strings without editing the
/// shared catalog. The web source keys (`webpush.*`) are preserved verbatim so a
/// shared catalog resolves identically across web and native.
public enum BrowserPushChannelCardStrings {
    public static let table = "BrowserPushChannelCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{when}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Permission (web `permission`)

/// The OS notification-permission state (web `Notification.permission`:
/// `granted` / `denied` / `default`). Only `denied` changes the card's branch, but
/// the full set is carried so the projection ports the web check exactly.
public enum BrowserPushPermission: String, Equatable, Sendable {
    case granted
    case denied
    /// Web `'default'` — not yet decided (renamed to avoid the Swift keyword).
    case notDetermined
}

// MARK: - Capability (web useWebPush + usePushPublicKey)

/// The per-device push capability snapshot — the projection of the web `useWebPush`
/// flags plus the `usePushPublicKey` result. Drives the unsupported-reason branch,
/// the status badge, and the enable/disable affordance. A pure, `Equatable` value;
/// the model never reads platform state directly.
public struct BrowserPushCapability: Equatable, Sendable {
    /// Web `notifSupported` — the Notification API is available.
    public let notificationsSupported: Bool
    /// Web `isPushSupported` — the Push API / PushManager is available.
    public let pushSupported: Bool
    /// Web `publicKey !== null` — the server has VAPID keys configured.
    public let serverConfigured: Bool
    /// Web `keyLoading` — the VAPID public-key query is still in flight.
    public let keyLoading: Bool
    /// Web `permission`.
    public let permission: BrowserPushPermission
    /// Web `isSubscribed` — THIS device is registered for push.
    public let isSubscribed: Bool
    /// Web `currentEndpoint` — THIS device's push endpoint (used to flag its row).
    public let currentEndpoint: String?

    public init(
        notificationsSupported: Bool = true,
        pushSupported: Bool = true,
        serverConfigured: Bool = true,
        keyLoading: Bool = false,
        permission: BrowserPushPermission = .notDetermined,
        isSubscribed: Bool = false,
        currentEndpoint: String? = nil
    ) {
        self.notificationsSupported = notificationsSupported
        self.pushSupported = pushSupported
        self.serverConfigured = serverConfigured
        self.keyLoading = keyLoading
        self.permission = permission
        self.isSubscribed = isSubscribed
        self.currentEndpoint = currentEndpoint
    }
}

// MARK: - Device row (web `PushSubscriptionRow`)

/// One registered device — the subset of the web `PushSubscriptionRow` the card
/// renders (`id`, `endpoint`, `user_agent`, `last_used_at`). Stable identity for
/// the rendered list row.
public struct BrowserPushDeviceRow: Equatable, Sendable, Identifiable {
    public let id: Int64
    public let endpoint: String
    /// Web `user_agent` — `nil` renders the "Unknown browser" fallback.
    public let userAgent: String?
    /// Web `last_used_at` (ISO-8601) — `nil` renders "Not yet used".
    public let lastUsedAt: String?

    public init(id: Int64, endpoint: String, userAgent: String? = nil, lastUsedAt: String? = nil) {
        self.id = id
        self.endpoint = endpoint
        self.userAgent = userAgent
        self.lastUsedAt = lastUsedAt
    }
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a source, holds the latest
/// capability + device list + freshness, exposes a render `Phase`, and forwards the
/// enable / disable / remove / refresh effects. Emits the `view.opened` event once.
@MainActor
@Observable
public final class BrowserPushChannelCardModel {
    /// The mutually-exclusive render branches. `loaded` renders the card with the
    /// device list; `empty` renders the same card with a friendly no-device
    /// empty state (never a blank box); `loading` is the initial fetch; `error` is a
    /// hard failure with nothing cached to fall back to.
    public enum Phase: Equatable {
        case loading
        case error(String)
        case empty
        case loaded
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: BrowserPushChannelCardConnection = .live
    public private(set) var capability: BrowserPushCapability?
    public private(set) var devices: [BrowserPushDeviceRow] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BrowserPushChannelCardSource
    @ObservationIgnored private let telemetry: any BrowserPushChannelCardTelemetry
    @ObservationIgnored let localize: BrowserPushChannelCardLocalizer
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any BrowserPushChannelCardSource,
        telemetry: any BrowserPushChannelCardTelemetry = OSLogBrowserPushChannelCardTelemetry(),
        localize: BrowserPushChannelCardLocalizer = .bundle,
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        clock = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The current display time (injectable for deterministic relative-time tests).
    public var now: Date {
        clock()
    }

    /// The resolved unsupported reason, or `nil` when push is available (web
    /// `disabledReason`). `nil` capability (still loading) is treated as available.
    public var unsupportedReason: BrowserPushUnsupportedReason? {
        guard let capability else { return nil }
        return BrowserPushUnsupportedReason.resolve(capability)
    }

    /// The status-badge projection (web `Active` / `Not subscribed` / `Unavailable`).
    public var status: BrowserPushStatus {
        BrowserPushStatus.resolve(reason: unsupportedReason, isSubscribed: capability?.isSubscribed ?? false)
    }

    /// The per-device row projections (web `rows.map(...)`), resolved against the
    /// current device endpoint + display clock so the list never recomputes in the
    /// view body.
    public var deviceProjections: [BrowserPushDeviceProjection] {
        let endpoint = capability?.currentEndpoint
        let reference = now
        return devices.map { row in
            BrowserPushDeviceProjection.make(
                row: row,
                currentEndpoint: endpoint,
                now: reference,
                localize: localize
            )
        }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        BrowserPushChannelCardSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (any cached snapshot stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    /// Enable push on this device (web `handleEnable`).
    public func enable() {
        source.enable()
    }

    /// Disable push on this device (web `handleDisable`).
    public func disable() {
        source.disable()
    }

    /// Remove a registered device (web `handleRemoveDevice`).
    public func remove(endpoint: String) {
        source.remove(endpoint: endpoint)
    }

    private func apply(_ update: BrowserPushChannelCardUpdate) {
        connection = update.connection
        devices = update.devices
        updatedAt = update.updatedAt
        if let payload = update.capability {
            capability = payload
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. A cached snapshot stays visible behind a refresh /
    /// failure (freshness reflected by the chip); the skeleton shows only on the
    /// initial fetch with nothing resolved; the empty state shows when the slice
    /// resolves with no registered devices; the hard-error state only when a failure
    /// arrives with nothing cached to render. Pure (no actor state) so it is callable
    /// synchronously from tests.
    public nonisolated static func resolvePhase(_ update: BrowserPushChannelCardUpdate) -> Phase {
        let resolved = update.capability != nil
        switch update.status {
        case .loading:
            return resolved ? readyPhase(update) : .loading
        case .loaded:
            return resolved ? readyPhase(update) : .empty
        case let .failed(message):
            return resolved ? readyPhase(update) : .error(message)
        }
    }

    /// A resolved snapshot renders the card; `empty` only swaps the device list for
    /// its empty state — the header, status, and enable/disable affordance always show.
    private nonisolated static func readyPhase(_ update: BrowserPushChannelCardUpdate) -> Phase {
        update.devices.isEmpty ? .empty : .loaded
    }
}

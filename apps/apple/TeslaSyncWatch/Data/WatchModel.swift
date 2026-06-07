import Foundation
import Observation
#if canImport(WidgetKit)
    import WidgetKit
#endif

/// The single `@Observable` model the watch UI binds to.
///
/// It hydrates last-known values from the watch-local cache on launch, applies the
/// coalesced sync payloads the phone pushes over WatchConnectivity, and exposes an
/// honest freshness derived from when the data was produced (never a background
/// stream — ADR-013). It mirrors each accepted snapshot into the shared
/// `WidgetSnapshotStore` and reloads the complications so the wrist face and the
/// app agree. Quick actions are relayed to the phone, which holds all vehicle
/// authority; their outcomes flow back as localized result keys.
@MainActor
@Observable
public final class WatchModel {
    public private(set) var snapshot: TeslaSyncWidgetSnapshot?
    public private(set) var settings: WatchSyncSettings = .default
    public private(set) var isAuthenticated = false
    public private(set) var lastUpdated: Date?
    public private(set) var isReachable = false
    /// The in-flight relayed command's idempotency id, or `nil` when none.
    public private(set) var pendingActionID: String?
    /// The most recent command outcome key (localized in the UI).
    public private(set) var lastOutcomeKey: String?
    /// A transient error key to surface (auth required, command failure, …).
    public private(set) var errorKey: String?

    @ObservationIgnored private let cache: WatchCacheStore
    @ObservationIgnored private let snapshotStore: WidgetSnapshotStore
    @ObservationIgnored private let policy: WidgetFreshnessPolicy
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let reloadComplications: () -> Void
    @ObservationIgnored private let makeMessenger: @MainActor (WatchLinkReceiver) -> (any WatchMessenger)?
    @ObservationIgnored private var messenger: (any WatchMessenger)?

    public init(
        cache: WatchCacheStore = WatchCacheStore(),
        snapshotStore: WidgetSnapshotStore = WidgetSnapshotStore(),
        policy: WidgetFreshnessPolicy = .standard,
        now: @escaping () -> Date = Date.init,
        reloadComplications: @escaping () -> Void = WatchModel.defaultReload,
        makeMessenger: @escaping @MainActor (WatchLinkReceiver) -> (any WatchMessenger)? = WatchModel.defaultMessenger
    ) {
        self.cache = cache
        self.snapshotStore = snapshotStore
        self.policy = policy
        self.now = now
        self.reloadComplications = reloadComplications
        self.makeMessenger = makeMessenger
        if let cached = cache.load() {
            ingest(cached, persist: false)
        }
    }

    /// Activates the link (if not already) and asks the phone for fresh data.
    public func start() {
        if messenger == nil {
            messenger = makeMessenger(self) ?? InertWatchMessenger()
        }
        requestRefresh()
    }

    /// Honest freshness for the cached values as of now.
    public var freshness: WidgetFreshness {
        policy.evaluate(now: now(), lastUpdated: lastUpdated)
    }

    /// The display state derived from the cached vehicle summary.
    public var vehicleState: WatchVehicleState {
        WatchVehicleState(snapshot: snapshot)
    }

    /// Asks the phone to push the latest snapshot (foreground refresh only).
    public func requestRefresh() {
        errorKey = nil
        messenger?.sendMessage(WatchSyncEnvelope.refreshRequestMessage())
    }

    /// Triggers a quick action. Vehicle commands are gated on the phone session and
    /// must already be confirmed by the caller; local actions run immediately.
    public func perform(_ action: WatchQuickAction) {
        errorKey = nil
        switch action {
        case .refresh:
            requestRefresh()
        case .openOnPhone:
            messenger?.sendMessage(WatchSyncEnvelope.message(for: WatchCommandRequest(action: action)))
        default:
            guard isAuthenticated else {
                errorKey = "command.outcome.needsAuth"
                return
            }
            let request = WatchCommandRequest(action: action)
            pendingActionID = request.id
            lastOutcomeKey = nil
            messenger?.sendMessage(WatchSyncEnvelope.message(for: request))
        }
    }

    /// Drops last-known values (used when the phone reports a signed-out session).
    public func clearCache() {
        cache.clear()
        snapshot = nil
        lastUpdated = nil
        snapshotStore.clear()
        reloadComplications()
    }

    // MARK: - Ingestion

    private func ingest(_ payload: WatchSyncPayload, persist: Bool) {
        snapshot = payload.snapshot
        settings = payload.settings
        isAuthenticated = payload.isAuthenticated
        lastUpdated = payload.generatedAt
        errorKey = nil
        guard persist else { return }
        cache.save(payload)
        try? snapshotStore.save(payload.snapshot ?? .empty(generatedAt: payload.generatedAt))
        reloadComplications()
    }

    private func isNewer(_ payload: WatchSyncPayload) -> Bool {
        guard let lastUpdated else { return true }
        return payload.generatedAt >= lastUpdated
    }

    // MARK: - Defaults

    public static let defaultReload: () -> Void = {
        #if canImport(WidgetKit)
            WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    public static let defaultMessenger: @MainActor (WatchLinkReceiver) -> (any WatchMessenger)? = { receiver in
        #if canImport(WatchConnectivity)
            return WatchConnectivityLink(receiver: receiver)
        #else
            _ = receiver
            return nil
        #endif
    }
}

extension WatchModel: WatchLinkReceiver {
    public func didReceivePayload(_ payload: WatchSyncPayload) {
        guard isNewer(payload) else { return }
        ingest(payload, persist: true)
    }

    public func didReceiveCommandResult(_ result: WatchCommandResult) {
        if result.requestID == pendingActionID {
            pendingActionID = nil
        }
        lastOutcomeKey = result.outcomeKey
        if result.success {
            requestRefresh()
        } else {
            errorKey = result.outcomeKey
        }
    }

    public func didReceiveCommandRequest(_: WatchCommandRequest) {}

    public func didReceiveRefreshRequest() {}

    public func reachabilityDidChange(_ reachable: Bool) {
        isReachable = reachable
        if reachable {
            requestRefresh()
        }
    }
}

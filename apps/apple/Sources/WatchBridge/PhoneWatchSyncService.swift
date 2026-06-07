import Foundation

#if canImport(WatchConnectivity)
    import Observation

    /// The phone-side half of the watch companion link.
    ///
    /// It mirrors the latest cached glance snapshot + core preferences to the watch
    /// as coalesced application context (no background stream), answers the watch's
    /// foreground-refresh requests, and relays confirmed quick actions to an injected
    /// `commandHandler` — the app wires that to its authenticated command facade +
    /// permission gate, keeping all vehicle authority on the phone/server. Kept free
    /// of app-specific types (commands, settings models) so it compiles and is
    /// verified on every platform that has WatchConnectivity.
    @MainActor
    @Observable
    public final class PhoneWatchSyncService {
        /// Runs a confirmed vehicle command and returns its honest outcome. The
        /// default reports `.unavailable` so a missing wiring never looks successful.
        public typealias CommandHandler = @MainActor (WatchCommandRequest) async -> WatchCommandResult

        @ObservationIgnored private var messenger: (any WatchMessenger)?
        @ObservationIgnored private let openRoute: @MainActor (WatchDeepLink) -> Void
        @ObservationIgnored private let commandHandler: CommandHandler
        @ObservationIgnored private let makeMessenger: @MainActor (WatchLinkReceiver) -> (any WatchMessenger)?

        private var snapshot: TeslaSyncWidgetSnapshot?
        private var settings: WatchSyncSettings = .default
        private var isAuthenticated = false

        public init(
            openRoute: @escaping @MainActor (WatchDeepLink) -> Void = { _ in },
            commandHandler: @escaping CommandHandler = PhoneWatchSyncService.unavailableHandler,
            makeMessenger: @escaping @MainActor (WatchLinkReceiver) -> (any WatchMessenger)? =
                PhoneWatchSyncService.defaultMessenger
        ) {
            self.openRoute = openRoute
            self.commandHandler = commandHandler
            self.makeMessenger = makeMessenger
        }

        /// Activates the session and pushes the current state once.
        public func start() {
            if messenger == nil {
                messenger = makeMessenger(self) ?? InertWatchMessenger()
            }
            pushContext()
        }

        /// Updates the mirrored state and re-pushes it to the watch.
        public func update(
            snapshot: TeslaSyncWidgetSnapshot?,
            settings: WatchSyncSettings,
            isAuthenticated: Bool
        ) {
            self.snapshot = snapshot
            self.settings = settings
            self.isAuthenticated = isAuthenticated
            pushContext()
        }

        private func pushContext() {
            let payload = WatchSyncPayload(
                snapshot: snapshot,
                settings: settings,
                isAuthenticated: isAuthenticated,
                generatedAt: Date()
            )
            messenger?.updateContext(WatchSyncEnvelope.context(for: payload))
        }

        private func relay(_ result: WatchCommandResult) {
            messenger?.sendMessage(WatchSyncEnvelope.message(for: result))
        }

        public static let unavailableHandler: CommandHandler = { request in
            WatchCommandResult(requestID: request.id, success: false, outcomeKey: "command.outcome.unavailable")
        }

        public static let defaultMessenger: @MainActor (WatchLinkReceiver) -> (any WatchMessenger)? = { receiver in
            WatchConnectivityLink(receiver: receiver)
        }
    }

    extension PhoneWatchSyncService: WatchLinkReceiver {
        public func didReceivePayload(_: WatchSyncPayload) {
            // The phone is the source of truth; it does not consume its own payloads.
        }

        public func didReceiveCommandResult(_: WatchCommandResult) {}

        public func reachabilityDidChange(_ reachable: Bool) {
            if reachable { pushContext() }
        }

        public func didReceiveRefreshRequest() {
            pushContext()
        }

        public func didReceiveCommandRequest(_ request: WatchCommandRequest) {
            switch request.action {
            case .refresh:
                pushContext()
            case .openOnPhone:
                openRoute(.dashboard)
            default:
                let handler = commandHandler
                Task { @MainActor in
                    await self.relay(handler(request))
                }
            }
        }
    }
#endif

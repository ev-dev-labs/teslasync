import Foundation

#if canImport(WatchConnectivity)
    import WatchConnectivity

    /// The live `WCSession`-backed transport shared by the phone and watch
    /// coordinators. It is a thin shell: the delegate callbacks arrive on
    /// WatchConnectivity's queue, decode the payload into `Sendable` sync types via
    /// the pure `WatchSyncEnvelope`, and hop those typed values to the main actor —
    /// so no `[String: Any]` ever crosses the isolation boundary. There is no
    /// streaming here; state moves only via coalesced application context and
    /// discrete messages.
    @MainActor
    public final class WatchConnectivityLink: NSObject, WatchMessenger {
        private let session: WCSession
        public weak var receiver: WatchLinkReceiver?

        /// Whether the OS supports a watch session at all (false on iPad/Mac).
        public static var isSupported: Bool {
            WCSession.isSupported()
        }

        /// Creates and activates the session, or returns `nil` when unsupported so
        /// the caller can fall back to `InertWatchMessenger`.
        public init?(receiver: WatchLinkReceiver) {
            guard WCSession.isSupported() else { return nil }
            session = WCSession.default
            self.receiver = receiver
            super.init()
            session.delegate = self
            session.activate()
        }

        public var isReachable: Bool {
            session.isReachable
        }

        public func updateContext(_ context: [String: Any]) {
            guard !context.isEmpty else { return }
            try? session.updateApplicationContext(context)
        }

        public func sendMessage(_ message: [String: Any]) {
            guard !message.isEmpty else { return }
            if session.isReachable {
                session.sendMessage(message, replyHandler: nil, errorHandler: nil)
            } else {
                // Not reachable: queue for guaranteed background delivery instead of
                // dropping a confirmed command or a refresh request.
                session.transferUserInfo(message)
            }
        }

        /// Hops a `Sendable`-only closure onto the main actor and runs it against the
        /// receiver. The captured values (decoded sync types) are all `Sendable`.
        private nonisolated func forward(_ body: @escaping @MainActor (WatchLinkReceiver) -> Void) {
            Task { @MainActor [weak self] in
                guard let receiver = self?.receiver else { return }
                body(receiver)
            }
        }

        private nonisolated func route(_ message: [String: Any]) {
            if WatchSyncEnvelope.isRefreshRequest(message) {
                forward { $0.didReceiveRefreshRequest() }
            } else if let request = WatchSyncEnvelope.commandRequest(from: message) {
                forward { $0.didReceiveCommandRequest(request) }
            } else if let result = WatchSyncEnvelope.commandResult(from: message) {
                forward { $0.didReceiveCommandResult(result) }
            } else if let payload = WatchSyncEnvelope.payload(from: message) {
                forward { $0.didReceivePayload(payload) }
            }
        }
    }

    extension WatchConnectivityLink: WCSessionDelegate {
        public nonisolated func session(
            _ session: WCSession,
            activationDidCompleteWith _: WCSessionActivationState,
            error _: Error?
        ) {
            let reachable = session.isReachable
            forward { $0.reachabilityDidChange(reachable) }
        }

        public nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
            let reachable = session.isReachable
            forward { $0.reachabilityDidChange(reachable) }
        }

        public nonisolated func session(_: WCSession, didReceiveApplicationContext context: [String: Any]) {
            if let payload = WatchSyncEnvelope.payload(from: context) {
                forward { $0.didReceivePayload(payload) }
            }
        }

        public nonisolated func session(_: WCSession, didReceiveMessage message: [String: Any]) {
            route(message)
        }

        public nonisolated func session(
            _: WCSession,
            didReceiveMessage message: [String: Any],
            replyHandler: @escaping ([String: Any]) -> Void
        ) {
            replyHandler([:])
            route(message)
        }

        public nonisolated func session(_: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
            route(userInfo)
        }

        #if os(iOS)
            public nonisolated func sessionDidBecomeInactive(_: WCSession) {}

            public nonisolated func sessionDidDeactivate(_ session: WCSession) {
                // Reactivate so a switched watch keeps syncing.
                session.activate()
            }
        #endif
    }
#endif

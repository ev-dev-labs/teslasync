#if os(iOS)
    import ActivityKit
    import Foundation

    /// The production `LiveActivityPresenting` over ActivityKit (iOS 16.2+, where the
    /// `ActivityContent` API and async `update`/`end` are available). It reconstructs
    /// the typed `Activity<…>` call from the erased request/state and looks running
    /// activities up by id. macOS / older iOS never reach here (the controller picks
    /// `NoopLiveActivityPresenter`).
    @available(iOS 16.2, *)
    public struct SystemLiveActivityPresenter: LiveActivityPresenting {
        private let log: PushLog

        public init(log: PushLog = PushLog()) {
            self.log = log
        }

        public var isSupported: Bool {
            ActivityAuthorizationInfo().areActivitiesEnabled
        }

        public func start(_ request: LiveActivityRequest) async -> String? {
            guard isSupported else {
                log.notice("live activities unavailable (disabled by user or OS)")
                return nil
            }
            switch request {
            case let .charging(attributes, state): return startActivity(attributes, state)
            case let .drive(attributes, state): return startActivity(attributes, state)
            case let .command(attributes, state): return startActivity(attributes, state)
            }
        }

        public func update(kind _: LiveActivityKind, id: String, state: LiveActivityState) async {
            switch state {
            case let .charging(content): await updateActivity(ChargingActivityAttributes.self, id: id, state: content)
            case let .drive(content): await updateActivity(DriveActivityAttributes.self, id: id, state: content)
            case let .command(content): await updateActivity(CommandActivityAttributes.self, id: id, state: content)
            }
        }

        public func end(kind: LiveActivityKind, id: String, finalState: LiveActivityState?) async {
            switch finalState {
            case let .charging(content): await endActivity(ChargingActivityAttributes.self, id: id, state: content)
            case let .drive(content): await endActivity(DriveActivityAttributes.self, id: id, state: content)
            case let .command(content): await endActivity(CommandActivityAttributes.self, id: id, state: content)
            case nil: await endImmediately(kind: kind, id: id)
            }
        }

        // MARK: - Typed bridges

        private func startActivity<A: ActivityAttributes>(_ attributes: A, _ state: A.ContentState) -> String? {
            do {
                let content = ActivityContent(state: state, staleDate: nil)
                let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                return activity.id
            } catch {
                log.error("live activity start failed: \(String(describing: error))")
                return nil
            }
        }

        private func updateActivity<A: ActivityAttributes>(_: A.Type, id: String, state: A.ContentState) async {
            guard let activity = Activity<A>.activities.first(where: { $0.id == id }) else { return }
            await activity.update(ActivityContent(state: state, staleDate: nil))
        }

        private func endActivity<A: ActivityAttributes>(_: A.Type, id: String, state: A.ContentState) async {
            guard let activity = Activity<A>.activities.first(where: { $0.id == id }) else { return }
            await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .default)
        }

        private func endImmediately(kind: LiveActivityKind, id: String) async {
            switch kind {
            case .charging: await endImmediately(ChargingActivityAttributes.self, id: id)
            case .drive: await endImmediately(DriveActivityAttributes.self, id: id)
            case .command: await endImmediately(CommandActivityAttributes.self, id: id)
            }
        }

        private func endImmediately<A: ActivityAttributes>(_: A.Type, id: String) async {
            guard let activity = Activity<A>.activities.first(where: { $0.id == id }) else { return }
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
#endif

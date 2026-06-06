import Foundation
import Observation

/// Starts, updates, and ends Live Activities for charging / drive / command,
/// tracking the running activity id per kind so callers never juggle ids. It
/// resolves to the real ActivityKit presenter on iOS 16.2+ and a no-op everywhere
/// else, so the same call sites work on macOS and old OSes (graceful degradation —
/// ADR-002/ADR-009). `@MainActor`-confined; all mutation is observable.
@MainActor
@Observable
public final class LiveActivityController {
    /// The kinds with a currently-running activity (drives optional UI affordances).
    public private(set) var activeKinds: Set<LiveActivityKind> = []

    @ObservationIgnored private let presenter: any LiveActivityPresenting
    @ObservationIgnored private var activeIDs: [LiveActivityKind: String] = [:]
    @ObservationIgnored private let log: PushLog

    public init(presenter: any LiveActivityPresenting, log: PushLog = PushLog()) {
        self.presenter = presenter
        self.log = log
    }

    /// Whether Live Activities can be presented on this device right now.
    public var isSupported: Bool {
        presenter.isSupported
    }

    /// The production controller — ActivityKit on iOS, no-op on macOS/unsupported.
    public static func live(log: PushLog = PushLog()) -> LiveActivityController {
        #if os(iOS)
            return LiveActivityController(presenter: SystemLiveActivityPresenter(log: log), log: log)
        #else
            return LiveActivityController(presenter: NoopLiveActivityPresenter(), log: log)
        #endif
    }

    // MARK: - Charging

    @discardableResult
    public func startCharging(vehicleName: String, state: ChargingActivityAttributes.ContentState) async -> Bool {
        await start(.charging(ChargingActivityAttributes(vehicleName: vehicleName), state))
    }

    public func updateCharging(_ state: ChargingActivityAttributes.ContentState) async {
        await update(.charging, .charging(state))
    }

    public func endCharging(_ finalState: ChargingActivityAttributes.ContentState? = nil) async {
        await end(.charging, finalState.map(LiveActivityState.charging))
    }

    // MARK: - Drive

    @discardableResult
    public func startDrive(vehicleName: String, state: DriveActivityAttributes.ContentState) async -> Bool {
        await start(.drive(DriveActivityAttributes(vehicleName: vehicleName), state))
    }

    public func updateDrive(_ state: DriveActivityAttributes.ContentState) async {
        await update(.drive, .drive(state))
    }

    public func endDrive(_ finalState: DriveActivityAttributes.ContentState? = nil) async {
        await end(.drive, finalState.map(LiveActivityState.drive))
    }

    // MARK: - Command

    @discardableResult
    public func startCommand(
        vehicleName: String,
        commandName: String,
        state: CommandActivityAttributes.ContentState
    ) async -> Bool {
        await start(.command(CommandActivityAttributes(vehicleName: vehicleName, commandName: commandName), state))
    }

    public func updateCommand(_ state: CommandActivityAttributes.ContentState) async {
        await update(.command, .command(state))
    }

    public func endCommand(_ finalState: CommandActivityAttributes.ContentState? = nil) async {
        await end(.command, finalState.map(LiveActivityState.command))
    }

    /// Ends every running activity (sign-out / app teardown).
    public func endAll() async {
        for kind in Array(activeIDs.keys) {
            await end(kind, nil)
        }
    }

    // MARK: - Core lifecycle

    private func start(_ request: LiveActivityRequest) async -> Bool {
        if activeIDs[request.kind] != nil {
            await update(request.kind, request.state)
            return true
        }
        guard let id = await presenter.start(request) else {
            log.notice("live activity not started (unsupported): \(request.kind.rawValue)")
            return false
        }
        activeIDs[request.kind] = id
        activeKinds.insert(request.kind)
        log.info("live activity started: \(request.kind.rawValue)")
        return true
    }

    private func update(_ kind: LiveActivityKind, _ state: LiveActivityState) async {
        guard let id = activeIDs[kind] else { return }
        await presenter.update(kind: kind, id: id, state: state)
    }

    private func end(_ kind: LiveActivityKind, _ finalState: LiveActivityState?) async {
        guard let id = activeIDs[kind] else { return }
        await presenter.end(kind: kind, id: id, finalState: finalState)
        activeIDs[kind] = nil
        activeKinds.remove(kind)
        log.info("live activity ended: \(kind.rawValue)")
    }
}

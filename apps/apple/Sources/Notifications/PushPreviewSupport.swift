import Foundation

/// A controllable `PushAuthorizing` for previews, the demo screen, and tests: it
/// returns a scripted status and flips to a configured result on request, recording
/// how often the app registered/unregistered for remote notifications. Locking goes
/// through sync helpers so no `NSLock` call happens in an `async` context (Swift 6).
public final class PreviewPushAuthorizer: PushAuthorizing, @unchecked Sendable {
    private let lock = NSLock()
    private var status: PushAuthorizationStatus
    private let grantResult: PushAuthorizationStatus
    private var registerCalls = 0
    private var unregisterCalls = 0

    public init(initial: PushAuthorizationStatus = .notDetermined, grants: PushAuthorizationStatus = .authorized) {
        status = initial
        grantResult = grants
    }

    public var registerCount: Int {
        readInt { registerCalls }
    }

    public var unregisterCount: Int {
        readInt { unregisterCalls }
    }

    public func currentStatus() async -> PushAuthorizationStatus {
        readStatus()
    }

    @discardableResult
    public func requestAuthorization(options _: PushAuthorizationOptions) async -> PushAuthorizationStatus {
        setStatus(grantResult)
        return grantResult
    }

    public func registerForRemoteNotifications() async {
        bump(\.registerCalls)
    }

    public func unregisterForRemoteNotifications() async {
        bump(\.unregisterCalls)
    }

    // MARK: - Sync locking helpers (never called from inside `lock`)

    private func readStatus() -> PushAuthorizationStatus {
        lock.lock()
        defer { lock.unlock() }
        return status
    }

    private func setStatus(_ value: PushAuthorizationStatus) {
        lock.lock()
        status = value
        lock.unlock()
    }

    private func readInt(_ value: () -> Int) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return value()
    }

    private func bump(_ keyPath: ReferenceWritableKeyPath<PreviewPushAuthorizer, Int>) {
        lock.lock()
        self[keyPath: keyPath] += 1
        lock.unlock()
    }
}

/// An in-memory `DeviceRegistering` for previews, the demo screen, and tests:
/// records registrations/unregistrations and can be set to fail with a fixed error.
public final class InMemoryDeviceRegistrar: DeviceRegistering, @unchecked Sendable {
    private let lock = NSLock()
    private var registrations: [DeviceRegistration] = []
    private var unregistered: [String] = []
    private let failure: FacadeError?

    public init(failure: FacadeError? = nil) {
        self.failure = failure
    }

    public var registeredTokens: [String] {
        lock.lock()
        defer { lock.unlock() }
        return registrations.map(\.token)
    }

    public var unregisteredTokens: [String] {
        lock.lock()
        defer { lock.unlock() }
        return unregistered
    }

    @discardableResult
    public func register(_ registration: DeviceRegistration) async throws -> RegisteredDevice {
        if let failure { throw failure }
        append(registration)
        return RegisteredDevice(id: 1, token: registration.token, platform: registration.platform)
    }

    public func unregister(token: String) async throws {
        if let failure { throw failure }
        appendUnregister(token)
    }

    private func append(_ registration: DeviceRegistration) {
        lock.lock()
        registrations.append(registration)
        lock.unlock()
    }

    private func appendUnregister(_ token: String) {
        lock.lock()
        unregistered.append(token)
        lock.unlock()
    }
}

/// A `LiveActivityPresenting` that reports itself supported and records every
/// start/update/end — so the demo screen exercises Live Activities even on macOS,
/// and tests assert the controller's lifecycle bookkeeping.
public final class PreviewLiveActivityPresenter: LiveActivityPresenting, @unchecked Sendable {
    private let lock = NSLock()
    private var startedKinds: [LiveActivityKind] = []
    private var updatedKinds: [LiveActivityKind] = []
    private var endedKinds: [LiveActivityKind] = []
    private let supported: Bool

    public init(supported: Bool = true) {
        self.supported = supported
    }

    public var isSupported: Bool {
        supported
    }

    public var starts: [LiveActivityKind] {
        snapshot { startedKinds }
    }

    public var updates: [LiveActivityKind] {
        snapshot { updatedKinds }
    }

    public var ends: [LiveActivityKind] {
        snapshot { endedKinds }
    }

    public func start(_ request: LiveActivityRequest) async -> String? {
        guard supported else { return nil }
        record(request.kind, into: \.startedKinds)
        return "preview-\(request.kind.rawValue)"
    }

    public func update(kind: LiveActivityKind, id _: String, state _: LiveActivityState) async {
        record(kind, into: \.updatedKinds)
    }

    public func end(kind: LiveActivityKind, id _: String, finalState _: LiveActivityState?) async {
        record(kind, into: \.endedKinds)
    }

    private func snapshot(_ value: () -> [LiveActivityKind]) -> [LiveActivityKind] {
        lock.lock()
        defer { lock.unlock() }
        return value()
    }

    private func record(
        _ kind: LiveActivityKind,
        into keyPath: ReferenceWritableKeyPath<PreviewLiveActivityPresenter, [LiveActivityKind]>
    ) {
        lock.lock()
        self[keyPath: keyPath].append(kind)
        lock.unlock()
    }
}

/// Sample APNs payloads for the demo screen / previews — one per category, so the
/// parser, router, and foreground banner can be driven without a real push.
public enum DemoPushSamples {
    public static func charging(critical: Bool = false) -> [AnyHashable: Any] {
        [
            "aps": ["alert": ["title": "Charging started", "body": "Now charging at 11 kW"], "category": "charging"],
            "category": "charging",
            "deeplink": "teslasync://charging",
            "vehicle_id": 1,
            "severity": critical ? "critical" : "info"
        ]
    }

    public static func command() -> [AnyHashable: Any] {
        [
            "aps": ["alert": ["title": "Climate on", "body": "Cabin preconditioning started"], "category": "command"],
            "category": "command",
            "deeplink": "teslasync://vehicles",
            "vehicle_id": 1
        ]
    }

    public static func security() -> [AnyHashable: Any] {
        [
            "aps": [
                "alert": ["title": "Sentry event", "body": "Motion detected near your vehicle"],
                "category": "security"
            ],
            "category": "security",
            "severity": "critical"
        ]
    }
}

public extension PushCoordinator {
    /// A demo coordinator wired entirely to in-memory fakes (previews + UI tests).
    @MainActor
    static func demo(
        authorizer: PreviewPushAuthorizer = PreviewPushAuthorizer(),
        registrar: InMemoryDeviceRegistrar = InMemoryDeviceRegistrar()
    ) -> PushCoordinator {
        PushCoordinator(
            authorizer: authorizer,
            registrar: registrar,
            settingsModel: PushSettingsModel(storage: InMemoryPushSettingsStore()),
            context: DeviceRegistrationContext(platform: .iOS, environment: .sandbox, bundleID: "io.teslasync.app")
        )
    }
}

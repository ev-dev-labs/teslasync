//
//  BrowserCompatBanner.Seams.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  The dependency seams the BrowserCompatBanner view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S8 source protocol, the production source (the native parity of
//  the web component running `detectMissingFeatures()` on mount and reading the localStorage
//  dismissal), the in-memory source for previews/tests, the capability probe (production
//  device-capability check + a seeded test double — the native parity of the web `testHookMissing`),
//  and the dismissal store (the native parity of the web `teslasync:compat-warning-dismissed:v1`
//  localStorage contract).
//
//  Parity note: the web banner owns its data through a one-shot synchronous detection plus a sticky
//  localStorage flag. This surface keeps the detection + persistence out of the view (P1/S8): the
//  production `DefaultBrowserCompatBannerSource` runs the `CapabilityProbe` and reads/writes the
//  `DismissalStore`, re-emitting on `start` / `refresh` / `dismiss`. There is no re-detection poller —
//  capabilities cannot change inside a running process, exactly as the web detects once on mount.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app uses `DefaultBrowserCompatBannerSource` over
/// the device capability probe + the persisted dismissal; previews and tests use
/// `InMemoryBrowserCompatBannerSource`. The view never probes capabilities or touches persistence.
@MainActor
public protocol BrowserCompatBannerSource: AnyObject {
    var onUpdate: (@MainActor (BrowserCompatInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Persists the dismissal and re-emits (web `dismissCompatWarning()`).
    func dismiss()
}

// MARK: - Capability probe (web `detectMissingFeatures()` + `testHookMissing`)

/// The seam that decides which required capabilities are unavailable — the native parity of the web
/// `detectMissingFeatures()`. The production app uses `DefaultCapabilityProbe`; previews and tests
/// use `StaticCapabilityProbe` to force a result (the native parity of the web `testHookMissing`).
@MainActor
public protocol CapabilityProbe: AnyObject {
    /// The required capabilities missing on the running device. Empty means the device is supported
    /// (web empty array).
    func detectMissing() -> [RequiredCapability]
}

/// One production capability check — a required capability paired with the runtime predicate that
/// confirms it. Internal so tests can inject predicates that fail, exercising the probe's
/// collect-unsatisfied logic without depending on the host OS.
struct CapabilityCheck {
    let capability: RequiredCapability
    let isSatisfied: () -> Bool
}

/// The production probe. Walks the platform's required-capability checks and returns the ones whose
/// runtime predicate is not satisfied — the native parity of the web feature sweep. Each predicate
/// uses `ProcessInfo.isOperatingSystemAtLeast` (a runtime query, so there is no always-true compile
/// folding) against the minimum OS that ships the framework. On a supported iOS 18 / macOS 15 runtime
/// every predicate passes, so the result is empty and the banner stays hidden — exactly as the web
/// banner returns nothing on a modern browser.
@MainActor
public final class DefaultCapabilityProbe: CapabilityProbe {
    private let checks: [CapabilityCheck]

    public init() {
        checks = Self.platformChecks()
    }

    init(checks: [CapabilityCheck]) {
        self.checks = checks
    }

    public func detectMissing() -> [RequiredCapability] {
        checks.filter { !$0.isSatisfied() }.map(\.capability)
    }

    private static func atLeast(_ major: Int, _ minor: Int) -> Bool {
        ProcessInfo.processInfo.isOperatingSystemAtLeast(
            OperatingSystemVersion(majorVersion: major, minorVersion: minor, patchVersion: 0)
        )
    }

    private static func platformChecks() -> [CapabilityCheck] {
        #if os(iOS)
            return [
                CapabilityCheck(capability: BrowserCompatCapabilities.swiftCharts) { atLeast(16, 0) },
                CapabilityCheck(capability: BrowserCompatCapabilities.mapKit) { atLeast(17, 0) },
                CapabilityCheck(capability: BrowserCompatCapabilities.liveActivities) { atLeast(16, 1) },
                CapabilityCheck(capability: BrowserCompatCapabilities.widgets) { atLeast(16, 0) },
                CapabilityCheck(capability: BrowserCompatCapabilities.backgroundRefresh) { atLeast(16, 0) }
            ]
        #else
            // Live Activities + Background App Refresh are iOS-only; on macOS they are not applicable
            // and must never be reported missing, so their predicate is satisfied unconditionally.
            return [
                CapabilityCheck(capability: BrowserCompatCapabilities.swiftCharts) { atLeast(13, 0) },
                CapabilityCheck(capability: BrowserCompatCapabilities.mapKit) { atLeast(14, 0) },
                CapabilityCheck(capability: BrowserCompatCapabilities.liveActivities) { true },
                CapabilityCheck(capability: BrowserCompatCapabilities.widgets) { atLeast(13, 0) },
                CapabilityCheck(capability: BrowserCompatCapabilities.backgroundRefresh) { true }
            ]
        #endif
    }
}

/// A probe that returns a fixed missing set — the native parity of the web `testHookMissing` seam.
/// Used by previews, tests, and the surface's controlled convenience initializer.
@MainActor
public final class StaticCapabilityProbe: CapabilityProbe {
    private let missing: [RequiredCapability]

    public init(missing: [RequiredCapability]) {
        self.missing = missing
    }

    public func detectMissing() -> [RequiredCapability] {
        missing
    }
}

// MARK: - Dismissal store (web `teslasync:compat-warning-dismissed:v1` localStorage)

/// The seam that persists the sticky dismissal — the native parity of the web `localStorage`
/// contract. `isDismissed` defaults to "not dismissed" when unknown, so the banner shows by default
/// (the web safe-default when storage access throws).
@MainActor
public protocol DismissalStore: AnyObject {
    var isDismissed: Bool { get }
    func setDismissed(_ dismissed: Bool)
}

/// Production store backed by `UserDefaults`, using the same versioned key + `"1"` value the web
/// persists so the dismissal contract is identical across platforms (web
/// `isCompatWarningDismissed()` / `dismissCompatWarning()`).
@MainActor
public final class UserDefaultsDismissalStore: DismissalStore {
    /// The versioned dismissal key — verbatim from the web `COMPAT_WARNING_STORAGE_KEY`.
    public static let storageKey = "teslasync:compat-warning-dismissed:v1"
    private static let dismissedValue = "1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var isDismissed: Bool {
        defaults.string(forKey: Self.storageKey) == Self.dismissedValue
    }

    public func setDismissed(_ dismissed: Bool) {
        if dismissed {
            defaults.set(Self.dismissedValue, forKey: Self.storageKey)
        } else {
            defaults.removeObject(forKey: Self.storageKey)
        }
    }
}

/// In-memory dismissal store for previews + tests. Records the number of writes so the persistence
/// contract can be asserted without touching `UserDefaults`.
@MainActor
public final class InMemoryDismissalStore: DismissalStore {
    public private(set) var isDismissed: Bool
    public private(set) var setCount = 0

    public init(isDismissed: Bool = false) {
        self.isDismissed = isDismissed
    }

    public func setDismissed(_ dismissed: Bool) {
        isDismissed = dismissed
        setCount += 1
    }
}

// MARK: - Default source (production — probe + persisted dismissal)

/// The production source. Runs the `CapabilityProbe` and reads the `DismissalStore` on `start` /
/// `refresh`, persisting the dismissal on `dismiss` — the native parity of the web component
/// detecting on mount and reading/writing the localStorage flag. No view logic lives here.
@MainActor
public final class DefaultBrowserCompatBannerSource: BrowserCompatBannerSource {
    public var onUpdate: (@MainActor (BrowserCompatInput) -> Void)?

    private let probe: any CapabilityProbe
    private let store: any DismissalStore

    public init(
        probe: any CapabilityProbe = DefaultCapabilityProbe(),
        store: any DismissalStore = UserDefaultsDismissalStore()
    ) {
        self.probe = probe
        self.store = store
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    public func dismiss() {
        store.setDismissed(true)
        emit()
    }

    private func emit() {
        onUpdate?(BrowserCompatInput(missing: probe.detectMissing(), dismissed: store.isDismissed))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`
/// and lets a test push further snapshots via `push(_:)`, counting the lifecycle calls so the model
/// contract can be asserted without a device probe or real persistence.
@MainActor
public final class InMemoryBrowserCompatBannerSource: BrowserCompatBannerSource {
    public var onUpdate: (@MainActor (BrowserCompatInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dismissCount = 0

    private let initial: BrowserCompatInput?

    public init(initial: BrowserCompatInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func dismiss() {
        dismissCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: BrowserCompatInput) {
        onUpdate?(input)
    }
}

// MARK: - Production factory

public extension BrowserCompatBannerModel {
    /// The production model — wires the device capability probe + the `UserDefaults`-backed dismissal
    /// store. The app mounts `BrowserCompatBanner(model: .live())` at the top of its chrome, the
    /// native parity of the web `<Layout>` mounting the banner above the service-status banner.
    static func live(
        telemetry: any BrowserCompatBannerTelemetry = OSLogBrowserCompatBannerTelemetry()
    ) -> BrowserCompatBannerModel {
        BrowserCompatBannerModel(source: DefaultBrowserCompatBannerSource(), telemetry: telemetry)
    }
}

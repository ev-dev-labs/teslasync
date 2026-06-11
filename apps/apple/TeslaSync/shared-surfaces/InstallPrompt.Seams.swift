//
//  InstallPrompt.Seams.swift
//  TeslaSync — P4 shared surface · 0125 · InstallPrompt (Apple)
//
//  The dependency seams the InstallPrompt view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S8 source protocol, the installability probe (production runtime check +
//  a seeded test double — the native parity of the web capture of the deferred prompt), the production
//  source (the native parity of the web component probing `beforeinstallprompt` / `isStandaloneMode()`
//  on mount, reading/writing the sticky 14-day localStorage dismissal, and broadcasting the dismissal
//  across tabs), and the in-memory source for previews/tests. The dismissal store + the cross-scene
//  broadcast seams live in `InstallPrompt.Stores.swift` (split out for the same length budget).
//
//  Parity note: the web prompt owns its data through a one-shot installability capture plus a sticky
//  localStorage timestamp and a cross-tab broadcast. This surface keeps that detection + persistence +
//  fan-out out of the view (P1/S8): `DefaultInstallPromptSource` runs the `InstallabilityProbe`, reads
//  the `InstallPromptDismissalStore` (evaluating the 14-day window via `InstallPromptDismissal`), and
//  posts/subscribes through the `InstallPromptBroadcast`. There is no re-detection poller — the
//  affordance does not change inside a running process, exactly as the web captures it once on mount.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app uses `DefaultInstallPromptSource` over the
/// installability probe + persisted dismissal + cross-scene broadcast; previews and tests use
/// `InMemoryInstallPromptSource`. The view never probes, persists, or broadcasts.
@MainActor
public protocol InstallPromptSource: AnyObject {
    var onUpdate: (@MainActor (InstallPromptInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Persists the dismissal (14-day window) and broadcasts it cross-scene (web `handleDismiss`).
    func dismiss()
    /// Records that the install affordance was taken so the prompt hides (web `handleInstall` accepted
    /// / the `appinstalled` event).
    func markInstalled()
}

// MARK: - Installability probe (web `beforeinstallprompt` + `isStandaloneMode`)

/// The seam that decides whether an install affordance is available + whether it has already been
/// taken — the native parity of the web capturing `beforeinstallprompt` (`canInstall`) and reading
/// `isStandaloneMode()` (`isInstalled`). The production app uses `DefaultInstallabilityProbe`; previews
/// and tests use `StaticInstallabilityProbe` to force a result.
@MainActor
public protocol InstallabilityProbe: AnyObject {
    /// `true` when the platform can offer the install affordance (web: a `beforeinstallprompt` was
    /// captured). On Apple this is the Home-/Lock-Screen widget (iOS) / pin (macOS) affordance.
    func canInstall() -> Bool
    /// `true` when the app is already running installed (web `isStandaloneMode()`).
    func isInstalled() -> Bool
}

/// The production probe. Reports installability against a runtime OS query (so there is no always-true
/// compile folding) — the affordance ships on iOS 16 / macOS 13 and later. `isInstalled` is not
/// detectable from a sandboxed app (WidgetKit does not expose which widgets a user added), so it
/// defaults to "offer it"; the composition root can pass a host-known signal (e.g. a persisted "added
/// the widget" flag) when it has one. The 14-day dismissal + the embedder's accepted callback keep the
/// prompt from nagging, exactly as the web prompt re-offers until dismissed or installed.
@MainActor
public final class DefaultInstallabilityProbe: InstallabilityProbe {
    private let installed: Bool

    public init(installed: Bool = false) {
        self.installed = installed
    }

    public func canInstall() -> Bool {
        #if os(iOS)
            return ProcessInfo.processInfo.isOperatingSystemAtLeast(
                OperatingSystemVersion(majorVersion: 16, minorVersion: 0, patchVersion: 0)
            )
        #else
            return ProcessInfo.processInfo.isOperatingSystemAtLeast(
                OperatingSystemVersion(majorVersion: 13, minorVersion: 0, patchVersion: 0)
            )
        #endif
    }

    public func isInstalled() -> Bool {
        installed
    }
}

/// A probe that returns fixed signals — the native parity of the web capturing (or not capturing) the
/// deferred prompt. Used by previews, tests, and the surface's controlled convenience initializer.
@MainActor
public final class StaticInstallabilityProbe: InstallabilityProbe {
    private let installable: Bool
    private let installed: Bool

    public init(canInstall: Bool, isInstalled: Bool = false) {
        installable = canInstall
        installed = isInstalled
    }

    public func canInstall() -> Bool {
        installable
    }

    public func isInstalled() -> Bool {
        installed
    }
}

// MARK: - Default source (production — probe + persisted dismissal + broadcast)

/// The production source. Runs the `InstallabilityProbe` and reads the `InstallPromptDismissalStore`
/// (evaluating the 14-day window) on `start` / `refresh`, persisting + broadcasting on `dismiss`, and
/// reflecting a sibling scene's dismissal through the `InstallPromptBroadcast` subscription — the
/// native parity of the web component capturing `beforeinstallprompt` on mount, reading the
/// localStorage dismissal, and syncing the dismissal across tabs. No view logic lives here.
@MainActor
public final class DefaultInstallPromptSource: InstallPromptSource {
    public var onUpdate: (@MainActor (InstallPromptInput) -> Void)?

    private let probe: any InstallabilityProbe
    private let store: any InstallPromptDismissalStore
    private let broadcast: any InstallPromptBroadcast
    private let clock: @MainActor () -> Date
    private var installedLocally = false

    public init(
        probe: any InstallabilityProbe = DefaultInstallabilityProbe(),
        store: any InstallPromptDismissalStore = UserDefaultsInstallPromptDismissalStore(),
        broadcast: any InstallPromptBroadcast = NotificationCenterInstallPromptBroadcast(),
        clock: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.probe = probe
        self.store = store
        self.broadcast = broadcast
        self.clock = clock
    }

    public func start() {
        broadcast.subscribe { [weak self] in self?.emit() }
        emit()
    }

    public func stop() {
        broadcast.unsubscribe()
    }

    public func refresh() {
        emit()
    }

    public func dismiss() {
        store.markDismissed(at: clock())
        broadcast.postDismissed()
        emit()
    }

    public func markInstalled() {
        installedLocally = true
        emit()
    }

    private func emit() {
        let dismissed = InstallPromptDismissal.isRecent(dismissedAt: store.dismissedAt, now: clock())
        let installed = installedLocally || probe.isInstalled()
        onUpdate?(InstallPromptInput(
            canInstall: probe.canInstall(),
            isInstalled: installed,
            dismissed: dismissed
        ))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, counting the lifecycle calls so the model
/// contract can be asserted without a device probe, real persistence, or `NotificationCenter`.
@MainActor
public final class InMemoryInstallPromptSource: InstallPromptSource {
    public var onUpdate: (@MainActor (InstallPromptInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var dismissCount = 0
    public private(set) var markInstalledCount = 0

    private let initial: InstallPromptInput?

    public init(initial: InstallPromptInput? = nil) {
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

    public func markInstalled() {
        markInstalledCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: InstallPromptInput) {
        onUpdate?(input)
    }
}

// MARK: - Production factory

public extension InstallPromptModel {
    /// The production model — wires the installability probe + the `UserDefaults`-backed dismissal
    /// store + the `NotificationCenter` cross-scene broadcast. The app mounts
    /// `InstallPrompt(model: .live(onInstall:))` as bottom chrome, the native parity of the web
    /// `<Layout>` mounting the prompt globally.
    ///
    /// - Parameter onInstall: the embedder's real install action (add the widget / pin the app),
    ///   returning whether the user accepted — the native parity of the web `deferredPrompt.prompt()`.
    static func live(
        telemetry: any InstallPromptTelemetry = OSLogInstallPromptTelemetry(),
        onInstall: (@MainActor () -> Bool)? = nil
    ) -> InstallPromptModel {
        InstallPromptModel(
            source: DefaultInstallPromptSource(),
            telemetry: telemetry,
            onInstall: onInstall
        )
    }
}

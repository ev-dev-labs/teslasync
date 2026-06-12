//
//  StatusBar.Model.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The state-holder (P1/S8), the telemetry seam (P1/S11), and the bound-command seam for the always-on
//  footer status bar.
//
//    • StatusBarTelemetry — the `view.opened` diagnostics seam; the default logs via `os.Logger` and the
//      production app injects the shared-core sink (consent-gated + redacted there).
//
//    • StatusBarCommands — the bound intents the segments forward to (the native peer of the web navigation
//      + `window` event dispatches + the `setVehicleId` selection + the TanStack refetch): open the
//      system-status / live-explorer routes, switch the active vehicle, open the keyboard-shortcuts / tour /
//      feedback surfaces, open the changelog / release notes, and refresh the live data. No networking lives
//      here — each is forwarded to the host.
//
//    • StatusBarModel — the @MainActor @Observable state-holder (the native peer of the web `useStatusBarPrefs`
//      + `useNarrowViewport` reads plus the per-segment hooks the parent feeds in). It pins the bound input,
//      overlays the persisted prefs from the store, derives the resolved ``StatusBarPresentation`` through the
//      pure projection, emits `view.opened` once, forwards every intent, and latches a one-shot auto-refresh
//      on the live-stream stale rising edge. SwiftUI observation replaces React's re-render; a no-op mutation
//      that does not change the resolved presentation invalidates no observer.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the shared-core diagnostics sink. The slug is a static,
/// non-identifying constant.
public protocol StatusBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogStatusBarTelemetry: StatusBarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - StatusBarCommands (P1/S8 bound intents)

/// The intents the bar forwards to the host — the native peer of the web navigation links, the
/// `setVehicleId` selection, the `window` event dispatches (shortcuts / tour / feedback / changelog), and
/// the live-data refetch. Every closure defaults to a no-op so previews + tests bind only what they assert.
@MainActor
public struct StatusBarCommands {
    public var openSystemStatus: () -> Void
    public var openLiveExplorer: () -> Void
    public var selectVehicle: (Int) -> Void
    public var openShortcuts: () -> Void
    public var openTour: () -> Void
    public var openFeedback: () -> Void
    public var openChangelog: () -> Void
    public var openReleaseNotes: () -> Void
    public var refresh: () -> Void

    public init(
        openSystemStatus: @escaping () -> Void = {},
        openLiveExplorer: @escaping () -> Void = {},
        selectVehicle: @escaping (Int) -> Void = { _ in },
        openShortcuts: @escaping () -> Void = {},
        openTour: @escaping () -> Void = {},
        openFeedback: @escaping () -> Void = {},
        openChangelog: @escaping () -> Void = {},
        openReleaseNotes: @escaping () -> Void = {},
        refresh: @escaping () -> Void = {}
    ) {
        self.openSystemStatus = openSystemStatus
        self.openLiveExplorer = openLiveExplorer
        self.selectVehicle = selectVehicle
        self.openShortcuts = openShortcuts
        self.openTour = openTour
        self.openFeedback = openFeedback
        self.openChangelog = openChangelog
        self.openReleaseNotes = openReleaseNotes
        self.refresh = refresh
    }

    /// The no-op command set — previews + the disabled bar.
    public static let noop = StatusBarCommands()
}

// MARK: - StatusBarModel (P1/S8 state-holder)

/// The bar's state-holder — pins the bound ``StatusBarInput``, overlays the persisted prefs, derives the
/// resolved ``StatusBarPresentation`` through the pure projection, emits `view.opened` once, and forwards
/// every intent. Reading `presentation` in a view registers an observation dependency, so the bar redraws
/// when the input, the prefs, or the viewport changes — and only then.
@MainActor
@Observable
public final class StatusBarModel {
    @ObservationIgnored private var input: StatusBarInput
    @ObservationIgnored private let localize: StatusBarLocalize
    @ObservationIgnored private let telemetry: any StatusBarTelemetry
    @ObservationIgnored private let prefsStore: any StatusBarPrefsStore
    @ObservationIgnored private let commands: StatusBarCommands
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var staleLatched = false

    /// The resolved, view-ready presentation (web per-render output). Recomputed on every mutation.
    public private(set) var presentation: StatusBarPresentation

    public init(
        input: StatusBarInput,
        telemetry: any StatusBarTelemetry = OSLogStatusBarTelemetry(),
        localize: @escaping StatusBarLocalize = StatusBarStrings.localize,
        prefsStore: any StatusBarPrefsStore = UserDefaultsStatusBarPrefsStore(),
        commands: StatusBarCommands = .noop
    ) {
        self.localize = localize
        self.telemetry = telemetry
        self.prefsStore = prefsStore
        self.commands = commands
        var seeded = input
        seeded.prefs = prefsStore.current
        self.input = seeded
        presentation = StatusBarProjection.resolve(input: seeded, localize: localize)
    }

    // MARK: Read access (tests + the view)

    /// The current persisted preferences (web `prefs`).
    public var prefs: StatusBarPrefs {
        input.prefs
    }

    /// The bound input this model renders.
    public var boundInput: StatusBarInput {
        input
    }

    // MARK: Preference intents (web `setStatusBarPrefs`)

    /// Shows / hides the bar — web `setStatusBarPrefs({ enabled })`.
    public func setEnabled(_ enabled: Bool) {
        writePrefs(StatusBarPrefs(enabled: enabled, iconOnly: input.prefs.iconOnly))
    }

    /// Forces / releases the icon-only variant — web `setStatusBarPrefs({ iconOnly })`.
    public func setIconOnly(_ iconOnly: Bool) {
        writePrefs(StatusBarPrefs(enabled: input.prefs.enabled, iconOnly: iconOnly))
    }

    private func writePrefs(_ next: StatusBarPrefs) {
        prefsStore.update(next)
        syncPrefs()
    }

    /// Re-reads the persisted prefs from the store — the native peer of the web cross-tab `storage` event
    /// (the host calls this on scene activation so an external change is reflected).
    public func syncPrefs() {
        input.prefs = prefsStore.current
        recompute()
    }

    // MARK: Command intents (web links / window events / selection / refetch)

    public func openSystemStatus() {
        commands.openSystemStatus()
    }

    public func openLiveExplorer() {
        commands.openLiveExplorer()
    }

    public func selectVehicle(_ id: Int) {
        commands.selectVehicle(id)
    }

    public func openShortcuts() {
        commands.openShortcuts()
    }

    public func openTour() {
        commands.openTour()
    }

    public func openFeedback() {
        commands.openFeedback()
    }

    public func openChangelog() {
        commands.openChangelog()
    }

    public func openReleaseNotes() {
        commands.openReleaseNotes()
    }

    /// Manual retry for the error / offline chip (web `QueryError` retry) — forwards to the data refetch.
    public func retry() {
        commands.refresh()
    }

    // MARK: Re-binding (web parent re-render)

    /// Re-binds the segment data — the native peer of the parent passing new props. The persisted prefs are
    /// re-overlaid from the store so a data push never clobbers the user's visibility / density choice.
    public func update(input newInput: StatusBarInput) {
        var next = newInput
        next.prefs = prefsStore.current
        input = next
        recompute()
    }

    // MARK: Lifecycle (P1/S11 view.opened)

    /// Emits `view.opened` once (P1/S11) and syncs the persisted prefs. Idempotent across SwiftUI appear /
    /// disappear churn — the event fires a single time per model instance.
    public func start() {
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: StatusBarSurface.slug)
        }
        syncPrefs()
    }

    // MARK: Private

    /// Re-derives the resolved presentation, publishes it only when it actually changed (so a no-op mutation
    /// invalidates no observer), and runs the one-shot stale auto-refresh.
    private func recompute() {
        let next = StatusBarProjection.resolve(input: input, localize: localize)
        if next != presentation { presentation = next }
        handleStaleAutoRefresh()
    }

    /// Fires the live-data refetch exactly once on the stale rising edge (web stale → auto-refresh); the
    /// latch resets when the stream recovers, so the next stale episode re-fires.
    private func handleStaleAutoRefresh() {
        if presentation.isStale {
            if !staleLatched {
                staleLatched = true
                commands.refresh()
            }
        } else {
            staleLatched = false
        }
    }
}

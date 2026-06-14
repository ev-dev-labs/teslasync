//
//  OnboardingWizard.Model.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  first-run intro. The web `<OnboardingWizard>` keeps two pieces of state — `visible` and `currentStep` —
//  and three effects: a first-run gate over `localStorage`, a 1.5 s delayed reveal, and a cross-tab
//  `subscribe` that dismisses the intro when a peer completes it. ``OnboardingWizardModel`` owns the native
//  peers of all three (binding the persistence + peer bus through the ``OnboardingWizardStore`` seam), plus
//  the `handleNext` / `handleClose` interaction and the single `view.opened` diagnostics event. No
//  networking lives here — the surface has no fetch.
//
//  The web source renders hardcoded English (it calls no `t()`); per the no-English-literals rule every
//  literal is promoted to a key, resolved through ``OnboardingWizardStrings`` (the P1/S10 facade) with the
//  source's copy as the deterministic fallback for test / preview bundles.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "OnboardingWizard" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the copy deterministic. The fallbacks are the verbatim web strings (the source is anonymous).
public enum OnboardingWizardStrings {
    public static let table = "OnboardingWizard"

    /// The `(key, fallback)` resolver — the value passed to the pure projector as ``OnboardingWizardResolve``.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The left "Skip" action (web `Skip`).
    public static var skip: String {
        string("onboardingWizard.skip", "Skip")
    }

    /// The trailing "Next" affordance for a non-final step (web `Next`).
    public static var next: String {
        string("onboardingWizard.next", "Next")
    }

    /// The trailing "Get Started" affordance for the final step (web `Get Started`).
    public static var getStarted: String {
        string("onboardingWizard.getStarted", "Get Started")
    }

    /// The VoiceOver label for the ✕ close control (web icon-only button; native a11y addition).
    public static var close: String {
        string("onboardingWizard.close", "Close")
    }

    /// The VoiceOver label for the dialog container (native a11y addition; the web modal is unlabelled).
    public static var dialogLabel: String {
        string("onboardingWizard.dialogLabel", "Welcome walkthrough")
    }

    /// The VoiceOver hint on the ✕ / backdrop describing dismissal (native a11y addition).
    public static var dismissHint: String {
        string("onboardingWizard.dismissHint", "Dismisses the walkthrough")
    }

    /// The resolved label for the trailing primary button given its role.
    public static func primaryActionLabel(_ action: OnboardingWizardPrimaryAction) -> String {
        switch action {
        case .advance: next
        case .finish: getStarted
        }
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol OnboardingWizardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogOnboardingWizardTelemetry: OnboardingWizardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - OnboardingWizardModel (P1/S8) — visibility + step state

/// The surface's observable state-holder. It owns the visibility flag (web `visible`) + the current step
/// (web `currentStep`), binds the persistence + peer bus through ``OnboardingWizardStore``, schedules the
/// 1.5 s delayed reveal (web `setTimeout`), routes the Next / Skip / close / backdrop interactions through
/// the web `handleNext` / `handleClose` rules, and emits `view.opened` exactly once — on the first reveal,
/// mirroring the web (the surface is "opened" only when it becomes visible). The web component has no
/// fetcher, so neither does this holder.
@MainActor
@Observable
public final class OnboardingWizardModel {
    /// Whether the modal is on screen (web `visible`). Observed, so the surface presents / withdraws.
    public private(set) var isPresented: Bool
    /// The current step index 0 ..< count (web `currentStep`). Observed, so the body re-derives.
    public private(set) var currentStep: Int

    @ObservationIgnored private let store: any OnboardingWizardStore
    @ObservationIgnored private let telemetry: any OnboardingWizardTelemetry
    @ObservationIgnored private let resolve: OnboardingWizardResolve
    @ObservationIgnored private let revealDelay: Duration
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var isFinished = false
    @ObservationIgnored private var revealTask: Task<Void, Never>?

    public init(
        store: any OnboardingWizardStore = UserDefaultsOnboardingWizardStore(),
        telemetry: any OnboardingWizardTelemetry = OSLogOnboardingWizardTelemetry(),
        resolve: @escaping OnboardingWizardResolve = { OnboardingWizardStrings.string($0, $1) },
        revealDelay: Duration = .milliseconds(1500),
        initiallyPresented: Bool = false,
        initialStep: Int = 0
    ) {
        self.store = store
        self.telemetry = telemetry
        self.resolve = resolve
        self.revealDelay = revealDelay
        isPresented = initiallyPresented
        currentStep = OnboardingWizardProjector.clampIndex(initialStep)
    }

    /// The resolved, view-ready modal (web render output) for the current step — a pure function of
    /// `currentStep` + the localization resolver.
    public var projection: OnboardingWizardProjection {
        OnboardingWizardProjector.resolve(currentStep: currentStep, resolve: resolve)
    }

    /// The descriptor catalog (test/host convenience).
    public var stepCount: Int {
        OnboardingWizardStepCatalog.count
    }

    /// Begins the surface (SwiftUI `onAppear`). Wires the peer-dismissal callback, starts the bus, and — when
    /// the first-run flag is unset — schedules the delayed reveal (web mount effect). When onboarding was
    /// already completed it stays dismissed forever (web `if (onboarded) return`). Idempotent across the
    /// appear / disappear churn.
    public func begin() {
        guard !started else { return }
        started = true
        store.onDismissedByPeer = { [weak self] in
            self?.dismissFromPeer()
        }
        store.start()
        guard !store.hasOnboarded else {
            isFinished = true
            return
        }
        scheduleReveal()
    }

    /// Marks the surface inactive (SwiftUI `onDisappear`): cancels the pending reveal and stops the bus. The
    /// once-only `view.opened` contract is preserved (a later ``begin()`` does not re-emit).
    public func stop() {
        started = false
        revealTask?.cancel()
        revealTask = nil
        store.stop()
    }

    /// Reveals the modal now and emits `view.opened` once — the body of the web `setTimeout` callback
    /// (`setVisible(true)`). A no-op once the intro has been finished or peer-dismissed, so a late timer can
    /// never resurrect a closed walkthrough.
    public func revealNow() {
        guard !isFinished, !isPresented else { return }
        isPresented = true
        emitOpenedOnce()
    }

    /// Advances the walkthrough — the verbatim port of the web `handleNext`: step forward while a next step
    /// exists, otherwise complete (the web `handleClose`).
    public func next() {
        switch OnboardingWizardProjector.nextOutcome(currentStep: currentStep) {
        case let .move(to):
            currentStep = to
        case .finish:
            complete()
        }
    }

    /// Dismisses via Skip / the ✕ / a backdrop tap / Esc — the web `handleClose` (persist + hide +
    /// broadcast).
    public func skip() {
        complete()
    }

    private func complete() {
        revealTask?.cancel()
        revealTask = nil
        isPresented = false
        guard !isFinished else { return }
        isFinished = true
        store.markOnboarded()
    }

    private func dismissFromPeer() {
        revealTask?.cancel()
        revealTask = nil
        isFinished = true
        isPresented = false
    }

    private func scheduleReveal() {
        revealTask?.cancel()
        let delay = revealDelay
        revealTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.revealNow()
        }
    }

    private func emitOpenedOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: OnboardingWizardSurface.slug)
    }
}

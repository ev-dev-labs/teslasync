import Foundation

// Value types + pure derivations for the first-run Onboarding surface (web
// `web/src/features/onboarding/pages/OnboardingPage.tsx`, route `/onboarding`). The page polls a
// single status anchor (`useOnboardingStatus` → `GET /onboarding/status`) reporting three
// independent setup anchors, walks the user through a three-step checklist, and lets them skip or
// continue. These types model the status, the page phase, the checklist steps + their resolved
// state (done / current / pending, web `Stepper.stateOf`), the per-step call-to-action, the doc
// links, and the local "skip" persistence (web `useOnboardingSkip`). Nothing non-SI is stored or
// computed here — the page owns no telemetry; it is pure setup-state chrome. The web page's inline
// derivations live here as pure, unit-tested helpers so the SwiftUI view stays declarative.

// MARK: - Onboarding status (web `useOnboardingStatus` → `GET /onboarding/status`)

/// The three setup anchors plus the server-computed completion flag (web `OnboardingChecklistStatus`).
/// `isComplete` is the backend AND of all three anchors — clients prefer it over re-deriving the
/// gate. A failed fetch degrades to `.pending` (all anchors false) so the checklist still renders,
/// mirroring the web query's pessimistic default (undefined data → every anchor `false`).
public struct OnboardingChecklistStatus: Equatable, Sendable {
    /// Web `tesla_connected` — a Tesla OAuth token has been stored.
    public let teslaConnected: Bool
    /// Web `vehicle_count` — vehicle rows synced locally.
    public let vehicleCount: Int
    /// Web `data_flowing` — telemetry seen within the freshness window.
    public let dataFlowing: Bool
    /// Web `is_complete` — backend AND of the three anchors.
    public let isComplete: Bool

    public init(teslaConnected: Bool, vehicleCount: Int, dataFlowing: Bool, isComplete: Bool) {
        self.teslaConnected = teslaConnected
        self.vehicleCount = vehicleCount
        self.dataFlowing = dataFlowing
        self.isComplete = isComplete
    }

    /// The pessimistic default (web: a failed/undefined query → every anchor `false`).
    public static let pending = OnboardingChecklistStatus(
        teslaConnected: false,
        vehicleCount: 0,
        dataFlowing: false,
        isComplete: false
    )
}

// MARK: - Page phase (web `PageContainer loading` vs. body)

/// The page's terminal phase, mirroring the web `PageContainer` props: `.loading` is the first-fetch
/// loader (web `isLoading`); `.ready` is the checklist body. There is no error phase — the web query
/// degrades a failure to the pessimistic body (every anchor unmet) rather than a blank error screen,
/// so a failed load resolves to `.ready` with `OnboardingChecklistStatus.pending`.
public enum OnboardingPhase: Equatable, Sendable {
    case loading
    case ready
}

// MARK: - Step identity + resolved state (web `Stepper`)

/// The three checklist anchors, in order (web `steps` array keys).
public enum OnboardingStepKey: String, CaseIterable, Identifiable, Sendable {
    case tesla
    case vehicle
    case telemetry

    public var id: String {
        rawValue
    }
}

/// A step's resolved visual state (web `Stepper.stateOf`): `done` once its anchor is satisfied,
/// `current` for the first not-done step (the only one that shows its CTA), and `pending` for every
/// not-done step below it so the user follows the flow top-down.
public enum OnboardingStepState: Equatable, Sendable {
    case done
    case current
    case pending

    /// Pure port of the web `stateOf(steps, index)` helper: the first not-done step is `current`;
    /// the rest follow from each anchor's own `done` flag.
    public static func resolve(done: [Bool], at index: Int) -> OnboardingStepState {
        guard done.indices.contains(index) else { return .pending }
        if done[index] { return .done }
        let firstNotDone = done.firstIndex(of: false)
        return firstNotDone == index ? .current : .pending
    }
}

// MARK: - Doc links (web external `href`s)

/// An external documentation destination the page links to (web `<a href>` opened in a new tab).
/// Resolved against the install's web origin at the display boundary, mirroring the web's
/// same-origin relative paths.
public enum OnboardingDocLink: String, Equatable, Sendable {
    /// Web footer `/docs/`.
    case documentation
    /// Web telemetry-step `/docs/fleet-telemetry-setup`.
    case fleetTelemetrySetup

    /// The same-origin relative path the web links to.
    public var path: String {
        switch self {
        case .documentation: "/docs/"
        case .fleetTelemetrySetup: "/docs/fleet-telemetry-setup"
        }
    }

    /// Resolves the relative path against the install's web origin (web same-origin navigation).
    public func url(base: URL) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }
}

// MARK: - Step call-to-action (web `renderCta`)

/// The action a checklist step offers while it is the current step (web `step.cta`). The three
/// shapes mirror the web render-prop branches: an internal route push (web `cta.to`), a
/// status refetch (web `cta.onClick`), and an external doc link (web `cta.href`).
public enum OnboardingStepCTA: Equatable, Sendable {
    /// Web `cta.to` — navigate to an in-app route (the Tesla-account step → Settings).
    case navigate(route: AppRoute, labelKey: String)
    /// Web `cta.onClick` — refetch the status; `busy` mirrors `isFetching` (label + disabled state).
    case refresh(labelKey: String, busy: Bool)
    /// Web `cta.href` — open external documentation in the system browser.
    case externalDoc(link: OnboardingDocLink, labelKey: String)

    /// The localized-label key the button renders.
    public var labelKey: String {
        switch self {
        case let .navigate(_, labelKey): labelKey
        case let .refresh(labelKey, _): labelKey
        case let .externalDoc(_, labelKey): labelKey
        }
    }
}

// MARK: - Checklist step (web `OnboardingChecklistStep`)

/// One checklist row (web `OnboardingChecklistStep`): its anchor key, the localized title/description keys,
/// whether its anchor is satisfied, and its call-to-action. The resolved `OnboardingStepState`
/// is derived across the whole list (so only the first not-done step is `current`).
public struct OnboardingChecklistStep: Identifiable, Equatable, Sendable {
    public let key: OnboardingStepKey
    public let titleKey: String
    public let descriptionKey: String
    public let done: Bool
    public let cta: OnboardingStepCTA

    public var id: String {
        key.rawValue
    }

    public init(
        key: OnboardingStepKey,
        titleKey: String,
        descriptionKey: String,
        done: Bool,
        cta: OnboardingStepCTA
    ) {
        self.key = key
        self.titleKey = titleKey
        self.descriptionKey = descriptionKey
        self.done = done
        self.cta = cta
    }
}

// MARK: - String keys (web `t(key, default)`)

/// The onboarding i18n keys, preserved verbatim from the web source so a shared catalog resolves
/// identically across web and native. Centralized so the view + model + tests reference one source.
public enum OnboardingStrings {
    public static let pageTitle = "onboarding.pageTitle"
    public static let welcome = "onboarding.welcome"
    public static let subtitle = "onboarding.subtitle"
    public static let introTitle = "onboarding.intro.title"
    public static let introDesc = "onboarding.intro.desc"

    public static let teslaTitle = "onboarding.tesla.title"
    public static let teslaDesc = "onboarding.tesla.desc"
    public static let teslaCta = "onboarding.tesla.cta"

    public static let vehicleTitle = "onboarding.vehicle.title"
    public static let vehicleDesc = "onboarding.vehicle.desc"
    public static let vehicleCta = "onboarding.vehicle.cta"
    public static let vehicleChecking = "onboarding.vehicle.checking"

    public static let telemetryTitle = "onboarding.telemetry.title"
    public static let telemetryDesc = "onboarding.telemetry.desc"
    public static let telemetryDocs = "onboarding.telemetry.docs"

    public static let ready = "onboarding.ready"
    public static let polling = "onboarding.polling"
    public static let checkAgain = "onboarding.checkAgain"
    public static let skip = "onboarding.skip"
    public static let skipHint = "onboarding.skipHint"
    public static let continueToDashboard = "onboarding.continue"

    public static let footerHelp = "onboarding.footer.help"
    public static let footerAccount = "onboarding.footer.account"
    public static let footerOr = "onboarding.footer.or"
    public static let footerDocs = "onboarding.footer.docs"

    /// Every visible string key the page renders (the manifest's 25 parity strings).
    public static let allKeys: [String] = [
        checkAgain, continueToDashboard, footerAccount, footerDocs, footerHelp, footerOr,
        introDesc, introTitle, pageTitle, polling, ready, skip, skipHint, subtitle,
        telemetryDesc, telemetryDocs, telemetryTitle, teslaCta, teslaDesc, teslaTitle,
        vehicleChecking, vehicleCta, vehicleDesc, vehicleTitle, welcome
    ]
}

// MARK: - Step factory (web inline `useMemo` step list)

/// Builds the three checklist steps from the status + in-flight flag (web `steps` `useMemo`). Pure
/// so the derivation is unit-tested independently of the view + async load.
public enum OnboardingStepFactory {
    /// Web `vehicle` step label: "Checking…" while a refetch is in flight, else "Refresh".
    public static func vehicleCTALabelKey(isFetching: Bool) -> String {
        isFetching ? OnboardingStrings.vehicleChecking : OnboardingStrings.vehicleCta
    }

    /// The ordered checklist (web `steps`): the Tesla-account connect step (route push to Settings),
    /// the vehicle-sync refetch step, and the telemetry setup-guide doc step.
    public static func steps(status: OnboardingChecklistStatus, isFetching: Bool) -> [OnboardingChecklistStep] {
        [
            OnboardingChecklistStep(
                key: .tesla,
                titleKey: OnboardingStrings.teslaTitle,
                descriptionKey: OnboardingStrings.teslaDesc,
                done: status.teslaConnected,
                cta: .navigate(route: .settings, labelKey: OnboardingStrings.teslaCta)
            ),
            OnboardingChecklistStep(
                key: .vehicle,
                titleKey: OnboardingStrings.vehicleTitle,
                descriptionKey: OnboardingStrings.vehicleDesc,
                done: status.vehicleCount > 0,
                cta: .refresh(labelKey: vehicleCTALabelKey(isFetching: isFetching), busy: isFetching)
            ),
            OnboardingChecklistStep(
                key: .telemetry,
                titleKey: OnboardingStrings.telemetryTitle,
                descriptionKey: OnboardingStrings.telemetryDesc,
                done: status.dataFlowing,
                cta: .externalDoc(link: .fleetTelemetrySetup, labelKey: OnboardingStrings.telemetryDocs)
            )
        ]
    }
}

// MARK: - Skip persistence (web `useOnboardingSkip`)

/// Persists the operator's "skip wizard" choice locally so the shell can suppress onboarding (web
/// `useOnboardingSkip`, localStorage `teslasync:onboarding:skipped:v1`). A small seam so tests can
/// inject an in-memory double.
public protocol OnboardingSkipStore: Sendable {
    var isSkipped: Bool { get }
    func markSkipped()
}

/// `UserDefaults`-backed skip store using the same storage key as the web client. `UserDefaults`
/// is thread-safe but not formally `Sendable`, so the conformance is `@unchecked` (the canonical
/// escape hatch — mirrors the app's other `UserDefaults`-backed seams).
public struct UserDefaultsOnboardingSkipStore: OnboardingSkipStore, @unchecked Sendable {
    /// Matches the web `STORAGE_KEY` so the choice reads consistently across surfaces.
    public static let storageKey = "teslasync:onboarding:skipped:v1"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public var isSkipped: Bool {
        defaults.bool(forKey: Self.storageKey)
    }

    public func markSkipped() {
        defaults.set(true, forKey: Self.storageKey)
    }
}

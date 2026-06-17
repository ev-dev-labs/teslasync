import Foundation
import Observation

// MARK: - Page model

/// The `@Observable` state holder the first-run Onboarding page binds to (ADR-004 — no networking in
/// the view). Owns the polled onboarding status (web `useOnboardingStatus`), the in-flight refetch
/// flag (web `isFetching`), the derived three-step checklist (web `steps` `useMemo`), and the local
/// skip persistence (web `useOnboardingSkip`). The view reads everything from here and always
/// renders the populated checklist panel — a failed load degrades to the pessimistic body (every
/// anchor unmet), never a blank region, mirroring the web query's pessimistic default.
@MainActor
@Observable
public final class OnboardingPageModel {
    /// The page phase (web `PageContainer loading` vs. body). Starts `.loading` for the first fetch.
    public private(set) var phase: OnboardingPhase = .loading

    /// The latest status anchors (web query `data`). Defaults to pessimistic until the first load.
    public private(set) var status: OnboardingChecklistStatus = .pending

    /// Web `isFetching` — a background refetch is in flight (drives the vehicle step's "Checking…"
    /// label + the spinning refresh affordances + their disabled state).
    public private(set) var isFetching = false

    @ObservationIgnored private let dataSource: any OnboardingDataSource
    @ObservationIgnored private let skipStore: any OnboardingSkipStore

    /// The install's web origin, used to resolve the external doc links (web same-origin `/docs/…`).
    @ObservationIgnored public let docsBaseURL: URL

    public init(
        dataSource: any OnboardingDataSource = SampleOnboardingDataSource(),
        skipStore: any OnboardingSkipStore = UserDefaultsOnboardingSkipStore(),
        docsBaseURL: URL = URL(string: "https://teslasync.local") ?? URL(fileURLWithPath: "/")
    ) {
        self.dataSource = dataSource
        self.skipStore = skipStore
        self.docsBaseURL = docsBaseURL
    }

    // MARK: Derivations (web inline)

    /// Web `teslaConnected = data?.tesla_connected ?? false`.
    public var teslaConnected: Bool {
        status.teslaConnected
    }

    /// Web `vehicleCount = data?.vehicle_count ?? 0`.
    public var vehicleCount: Int {
        status.vehicleCount
    }

    /// Web `dataFlowing = data?.data_flowing ?? false`.
    public var dataFlowing: Bool {
        status.dataFlowing
    }

    /// Web `isComplete = data?.is_complete ?? false` — gates the ready/continue vs. polling/skip copy.
    public var isComplete: Bool {
        status.isComplete
    }

    /// Web `useOnboardingSkip().isSkipped` — whether the operator has dismissed the wizard locally.
    public var isSkipped: Bool {
        skipStore.isSkipped
    }

    /// The ordered checklist (web `steps` `useMemo`), rebuilt from the current status + fetch flag.
    public var steps: [OnboardingChecklistStep] {
        OnboardingStepFactory.steps(status: status, isFetching: isFetching)
    }

    /// Whether the page should keep auto-refreshing (web `refetchInterval` — stops once complete).
    public var isPolling: Bool {
        !isComplete
    }

    // MARK: Loading

    /// Loads the onboarding status. Shows the first-fetch loader, then resolves to the checklist —
    /// a failure degrades to the pessimistic body (web: undefined data → every anchor `false`).
    public func load() async {
        phase = .loading
        await fetch()
    }

    /// Re-runs the load while keeping the current content visible (web `refetch`); sets `isFetching`
    /// so the vehicle step shows "Checking…" and the refresh affordances spin + disable.
    public func refresh() async {
        guard !isFetching else { return }
        isFetching = true
        await fetch()
        isFetching = false
    }

    private func fetch() async {
        do {
            status = try await dataSource.loadStatus()
        } catch {
            // Web pessimistic gate: a failed status query leaves every anchor unmet so the page
            // still renders the checklist (the user retries via "Check again"), never a blank error.
            status = .pending
        }
        phase = .ready
    }

    // MARK: Skip (web `useOnboardingSkip().skip`)

    /// Persists the "skip wizard" choice locally (web `skip()`); the view then navigates home.
    public func skip() {
        skipStore.markSkipped()
    }

    // MARK: Doc links (web external `href`s)

    /// Resolves an external doc link against the install's web origin (web same-origin `/docs/…`).
    public func docURL(_ link: OnboardingDocLink) -> URL {
        link.url(base: docsBaseURL)
    }
}

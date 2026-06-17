import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `OnboardingPageModel` and its pure helpers — every data
/// state the page renders (loading / ready-success / ready-pessimistic-on-failure), the three-step
/// checklist derivation (web `steps`), the step-state resolution (web `stateOf`), the vehicle CTA
/// label switch (web `isFetching`), the local skip persistence (web `useOnboardingSkip`), the doc
/// link resolution, the full set of parity string keys, and the route metadata + registration.
@MainActor
final class OnboardingPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: OnboardingDataSource {
        let status: OnboardingChecklistStatus
        let shouldFail: Bool

        init(status: OnboardingChecklistStatus = .pending, shouldFail: Bool = false) {
            self.status = status
            self.shouldFail = shouldFail
        }

        func loadStatus() async throws -> OnboardingChecklistStatus {
            if shouldFail { throw StubError() }
            return status
        }
    }

    private final class InMemorySkipStore: OnboardingSkipStore, @unchecked Sendable {
        private(set) var skipped = false
        var isSkipped: Bool {
            skipped
        }

        func markSkipped() {
            skipped = true
        }
    }

    private func status(
        tesla: Bool = false,
        vehicles: Int = 0,
        flowing: Bool = false,
        complete: Bool = false
    ) -> OnboardingChecklistStatus {
        OnboardingChecklistStatus(
            teslaConnected: tesla,
            vehicleCount: vehicles,
            dataFlowing: flowing,
            isComplete: complete
        )
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = OnboardingPageModel(dataSource: StubSource())
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReadyWithStatus() async {
        let source = StubSource(status: status(tesla: true, vehicles: 1, flowing: false))
        let model = OnboardingPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.teslaConnected)
        XCTAssertEqual(model.vehicleCount, 1)
        XCTAssertFalse(model.dataFlowing)
        XCTAssertFalse(model.isComplete)
    }

    func testCompleteStatusFlipsIsComplete() async {
        let source = StubSource(status: status(tesla: true, vehicles: 2, flowing: true, complete: true))
        let model = OnboardingPageModel(dataSource: source)
        await model.load()
        XCTAssertTrue(model.isComplete)
        XCTAssertFalse(model.isPolling)
    }

    func testFailedLoadDegradesToPessimisticReady() async {
        let model = OnboardingPageModel(dataSource: StubSource(shouldFail: true))
        await model.load()
        // Web pessimistic gate: failure resolves to the checklist with every anchor unmet, not error.
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.teslaConnected)
        XCTAssertEqual(model.vehicleCount, 0)
        XCTAssertFalse(model.dataFlowing)
        XCTAssertFalse(model.isComplete)
        XCTAssertTrue(model.isPolling)
    }

    func testRefreshClearsFetchingFlag() async {
        let model = OnboardingPageModel(dataSource: StubSource(status: status(tesla: true)))
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isFetching)
    }

    // MARK: Steps (web `steps` useMemo)

    func testStepsReflectStatusDoneFlags() async {
        let source = StubSource(status: status(tesla: true, vehicles: 1, flowing: false))
        let model = OnboardingPageModel(dataSource: source)
        await model.load()
        let steps = model.steps
        XCTAssertEqual(steps.count, 3)
        XCTAssertEqual(steps.map(\.key), [.tesla, .vehicle, .telemetry])
        XCTAssertTrue(steps[0].done)
        XCTAssertTrue(steps[1].done)
        XCTAssertFalse(steps[2].done)
    }

    func testStepCtaShapesMatchWeb() {
        let steps = OnboardingStepFactory.steps(status: .pending, isFetching: false)
        if case let .navigate(route, labelKey) = steps[0].cta {
            XCTAssertEqual(route, .settings)
            XCTAssertEqual(labelKey, OnboardingStrings.teslaCta)
        } else {
            XCTFail("tesla step CTA should navigate to settings")
        }
        if case let .refresh(labelKey, busy) = steps[1].cta {
            XCTAssertEqual(labelKey, OnboardingStrings.vehicleCta)
            XCTAssertFalse(busy)
        } else {
            XCTFail("vehicle step CTA should be a refresh")
        }
        if case let .externalDoc(link, labelKey) = steps[2].cta {
            XCTAssertEqual(link, .fleetTelemetrySetup)
            XCTAssertEqual(labelKey, OnboardingStrings.telemetryDocs)
        } else {
            XCTFail("telemetry step CTA should be an external doc link")
        }
    }

    func testVehicleCtaLabelSwitchesOnFetching() {
        XCTAssertEqual(OnboardingStepFactory.vehicleCTALabelKey(isFetching: false), OnboardingStrings.vehicleCta)
        XCTAssertEqual(OnboardingStepFactory.vehicleCTALabelKey(isFetching: true), OnboardingStrings.vehicleChecking)
        let busySteps = OnboardingStepFactory.steps(status: .pending, isFetching: true)
        if case let .refresh(labelKey, busy) = busySteps[1].cta {
            XCTAssertEqual(labelKey, OnboardingStrings.vehicleChecking)
            XCTAssertTrue(busy)
        } else {
            XCTFail("vehicle step CTA should be a refresh")
        }
    }

    // MARK: Step state (web `stateOf`)

    func testStepStateResolution() {
        // Nothing done → first step current, the rest pending.
        XCTAssertEqual(OnboardingStepState.resolve(done: [false, false, false], at: 0), .current)
        XCTAssertEqual(OnboardingStepState.resolve(done: [false, false, false], at: 1), .pending)
        XCTAssertEqual(OnboardingStepState.resolve(done: [false, false, false], at: 2), .pending)
        // First done → second current.
        XCTAssertEqual(OnboardingStepState.resolve(done: [true, false, false], at: 0), .done)
        XCTAssertEqual(OnboardingStepState.resolve(done: [true, false, false], at: 1), .current)
        XCTAssertEqual(OnboardingStepState.resolve(done: [true, false, false], at: 2), .pending)
        // All done → every step done.
        XCTAssertEqual(OnboardingStepState.resolve(done: [true, true, true], at: 2), .done)
        // A done step below a not-done one still reads done (per-anchor), web parity.
        XCTAssertEqual(OnboardingStepState.resolve(done: [false, true, false], at: 1), .done)
    }

    // MARK: Skip (web `useOnboardingSkip`)

    func testSkipPersistsChoice() {
        let store = InMemorySkipStore()
        let model = OnboardingPageModel(dataSource: StubSource(), skipStore: store)
        XCTAssertFalse(model.isSkipped)
        model.skip()
        XCTAssertTrue(store.skipped)
        XCTAssertTrue(model.isSkipped)
    }

    func testUserDefaultsSkipStoreRoundTrips() throws {
        let suiteName = "onboarding.tests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = UserDefaultsOnboardingSkipStore(defaults: defaults)
        XCTAssertFalse(store.isSkipped)
        store.markSkipped()
        XCTAssertTrue(store.isSkipped)
        XCTAssertTrue(defaults.bool(forKey: UserDefaultsOnboardingSkipStore.storageKey))
    }

    // MARK: Doc links (web external `href`s)

    func testDocLinksResolveAgainstBase() throws {
        let base = try XCTUnwrap(URL(string: "https://teslasync.example"))
        let model = OnboardingPageModel(dataSource: StubSource(), docsBaseURL: base)
        XCTAssertEqual(model.docURL(.documentation).absoluteString, "https://teslasync.example/docs/")
        XCTAssertEqual(
            model.docURL(.fleetTelemetrySetup).absoluteString,
            "https://teslasync.example/docs/fleet-telemetry-setup"
        )
    }

    // MARK: Strings (manifest parity set)

    func testAllParityStringKeysPresent() {
        let expected: Set = [
            "onboarding.checkAgain", "onboarding.continue", "onboarding.footer.account",
            "onboarding.footer.docs", "onboarding.footer.help", "onboarding.footer.or",
            "onboarding.intro.desc", "onboarding.intro.title", "onboarding.pageTitle",
            "onboarding.polling", "onboarding.ready", "onboarding.skip", "onboarding.skipHint",
            "onboarding.subtitle", "onboarding.telemetry.desc", "onboarding.telemetry.docs",
            "onboarding.telemetry.title", "onboarding.tesla.cta", "onboarding.tesla.desc",
            "onboarding.tesla.title", "onboarding.vehicle.checking", "onboarding.vehicle.cta",
            "onboarding.vehicle.desc", "onboarding.vehicle.title", "onboarding.welcome"
        ]
        XCTAssertEqual(OnboardingStrings.allKeys.count, 25)
        XCTAssertEqual(Set(OnboardingStrings.allKeys), expected)
    }

    func testParityStringKeysResolveFromCatalog() {
        // Every key must localize to a non-key value (the catalog wiring is real, not missing).
        for key in OnboardingStrings.allKeys {
            let value = Bundle.main.localizedString(forKey: key, value: key, table: nil)
            XCTAssertNotEqual(value, key, "missing catalog entry for \(key)")
        }
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.onboarding.pathSegment, "onboarding")
        XCTAssertEqual(AppRoute.onboarding.group, .account)
        XCTAssertEqual(AppRouteParser.parse(path: "/onboarding"), .onboarding)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = OnboardingRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.onboarding))
    }
}

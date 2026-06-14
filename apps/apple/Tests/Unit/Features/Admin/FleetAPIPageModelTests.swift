import XCTest
@testable import TeslaSync

/// State-machine tests for `FleetAPIPageModel` — the page load states (loading / error /
/// loaded), the suspend + endpoint + retention mutations (success seeds the matching web
/// toast notice; failure surfaces the error notice and leaves the snapshot intact), the
/// derived enabled/total counts, plus the pure helpers (grouped-int formatter, `PollingConfig`
/// edits) and the route registration. Mirrors the sibling `FeatureFlagsPageModelTests`.
@MainActor final class FleetAPIPageModelTests: XCTestCase {
    private actor StubSource: FleetAPIDataSource {
        var snapshot: FleetAPISnapshot
        let loadFails: Bool
        let suspendFails: Bool
        let pollingFails: Bool
        private(set) var suspendCalls: [Bool] = []
        private(set) var pollingCalls: [PollingConfig] = []

        init(
            snapshot: FleetAPISnapshot,
            loadFails: Bool = false,
            suspendFails: Bool = false,
            pollingFails: Bool = false
        ) {
            self.snapshot = snapshot
            self.loadFails = loadFails
            self.suspendFails = suspendFails
            self.pollingFails = pollingFails
        }

        func load() async throws -> FleetAPISnapshot {
            if loadFails { throw StubError() }
            return snapshot
        }

        func setAPISuspended(_ suspended: Bool) async throws {
            if suspendFails { throw StubError() }
            suspendCalls.append(suspended)
            snapshot.settings = FleetAPISettings(apiSuspended: suspended)
        }

        func updatePollingConfig(_ config: PollingConfig) async throws {
            if pollingFails { throw StubError() }
            pollingCalls.append(config)
            snapshot.polling = config
        }
    }

    private struct StubError: Error {}

    private func polling(retention: Int = 7, off: Set<String> = []) -> PollingConfig {
        var flags: [String: Bool] = [:]
        for key in FleetAPIPageModel.allEndpointKeys {
            flags[key] = !off.contains(key)
        }
        return PollingConfig(flags: flags, retentionDays: retention)
    }

    private func fullSnapshot(suspended: Bool = false, off: Set<String> = []) -> FleetAPISnapshot {
        FleetAPISnapshot(
            settings: FleetAPISettings(apiSuspended: suspended),
            polling: polling(off: off),
            capture: CaptureStats(mongoEnabled: true, totalDocuments: 10, distinctVINs: ["A"]),
            version: VersionInfo(
                chartVersion: "1",
                goVersion: "go",
                os: "linux",
                arch: "amd64",
                endpoints: ["api": "x"]
            )
        )
    }

    // MARK: - Load states

    func testInitialStateIsLoading() {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot()))
        XCTAssertEqual(model.state, .loading)
        XCTAssertNil(model.snapshot)
    }

    func testLoadSuccessLoadsSnapshot() async {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot(off: ["release_notes"])))
        await model.load()
        guard case .loaded = model.state else { return XCTFail("expected loaded") }
        XCTAssertNotNil(model.polling)
        XCTAssertNotNil(model.version)
        XCTAssertFalse(model.isSuspended)
    }

    func testLoadFailureYieldsError() async {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot(), loadFails: true))
        await model.load()
        guard case .error = model.state else { return XCTFail("expected error") }
    }

    func testEnabledAndTotalCounts() async {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot(off: ["wake_up", "commands"])))
        await model.load()
        XCTAssertEqual(model.totalCount, 21)
        XCTAssertEqual(model.enabledCount, 19)
    }

    // MARK: - Suspend mutation

    func testToggleSuspendSuspendsWhenActive() async {
        let source = StubSource(snapshot: fullSnapshot(suspended: false))
        let model = FleetAPIPageModel(dataSource: source)
        await model.load()
        await model.toggleSuspend()
        XCTAssertEqual(model.notice, .apiSuspended)
        XCTAssertTrue(model.isSuspended)
        let calls = await source.suspendCalls
        XCTAssertEqual(calls, [true])
    }

    func testToggleSuspendResumesWhenSuspended() async {
        let source = StubSource(snapshot: fullSnapshot(suspended: true))
        let model = FleetAPIPageModel(dataSource: source)
        await model.load()
        await model.toggleSuspend()
        XCTAssertEqual(model.notice, .apiResumed)
        XCTAssertFalse(model.isSuspended)
        let calls = await source.suspendCalls
        XCTAssertEqual(calls, [false])
    }

    func testToggleSuspendFailureSetsNotice() async {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot(), suspendFails: true))
        await model.load()
        await model.toggleSuspend()
        XCTAssertEqual(model.notice, .suspendFailed)
        XCTAssertFalse(model.isSuspendInFlight)
        XCTAssertFalse(model.isSuspended)
    }

    // MARK: - Polling mutations

    func testToggleEndpointFlipsAndPersists() async {
        let source = StubSource(snapshot: fullSnapshot(off: ["charge_state"]))
        let model = FleetAPIPageModel(dataSource: source)
        await model.load()
        await model.toggleEndpoint("charge_state")
        XCTAssertEqual(model.notice, .pollingUpdated)
        let calls = await source.pollingCalls
        XCTAssertEqual(calls.last?["charge_state"], true)
        XCTAssertEqual(model.polling?["charge_state"], true)
    }

    func testToggleEndpointFailureSetsNotice() async {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot(), pollingFails: true))
        await model.load()
        await model.toggleEndpoint("charge_state")
        XCTAssertEqual(model.notice, .pollingFailed)
        XCTAssertFalse(model.isPollingInFlight)
    }

    func testSetRetentionPersists() async {
        let source = StubSource(snapshot: fullSnapshot())
        let model = FleetAPIPageModel(dataSource: source)
        await model.load()
        await model.setRetention(30)
        let calls = await source.pollingCalls
        XCTAssertEqual(calls.last?.retentionDays, 30)
        XCTAssertEqual(model.polling?.retentionDays, 30)
        XCTAssertEqual(model.notice, .pollingUpdated)
    }

    func testSetRetentionNoOpWhenUnchanged() async {
        let source = StubSource(snapshot: fullSnapshot())
        let model = FleetAPIPageModel(dataSource: source)
        await model.load()
        await model.setRetention(7)
        let calls = await source.pollingCalls
        XCTAssertTrue(calls.isEmpty)
        XCTAssertNil(model.notice)
    }

    func testDismissNotice() async {
        let model = FleetAPIPageModel(dataSource: StubSource(snapshot: fullSnapshot()))
        await model.load()
        await model.toggleSuspend()
        XCTAssertNotNil(model.notice)
        model.dismissNotice()
        XCTAssertNil(model.notice)
    }
}

/// Pure value-type + formatter + routing + seed tests (split into an extension so the primary
/// `XCTestCase` body stays within the lint budget).
extension FleetAPIPageModelTests {
    func testPollingConfigEdits() {
        let config = PollingConfig(flags: ["a": true, "b": false], retentionDays: 7)
        XCTAssertTrue(config["a"])
        XCTAssertFalse(config["b"])
        XCTAssertFalse(config["missing"])
        XCTAssertFalse(config.toggling("a")["a"])
        XCTAssertTrue(config.toggling("b")["b"])
        XCTAssertEqual(config.settingRetention(30).retentionDays, 30)
    }

    func testFormatIntGroups() {
        XCTAssertEqual(FleetAPIFormat.int(0), "0")
        XCTAssertEqual(FleetAPIFormat.int(152_340), "152,340")
    }

    func testVersionSummary() {
        let version = VersionInfo(
            chartVersion: "6.4.2",
            goVersion: "go1.25",
            os: "linux",
            arch: "amd64",
            endpoints: [:]
        )
        XCTAssertEqual(version.summary, "v6.4.2 · go1.25 · linux/amd64")
    }

    func testRouteRegistrationAndParsing() {
        XCTAssertEqual(AppRoute.fleetAPI.pathSegment, "fleet-api")
        XCTAssertEqual(AppRoute.fleetAPI.group, .system)
        XCTAssertEqual(AppRouteParser.parse(path: "/fleet-api"), .fleetAPI)
        let registry = FleetAPIRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.fleetAPI))
    }

    func testSampleDataSourceSeedsEnabledCount() async {
        let model = FleetAPIPageModel(dataSource: SampleFleetAPIDataSource())
        await model.load()
        XCTAssertEqual(model.totalCount, 21)
        XCTAssertEqual(model.enabledCount, 18)
        XCTAssertEqual(model.capture?.mongoEnabled, true)
        XCTAssertEqual(model.version?.endpoints["api"], "https://teslasync.local/api")
    }
}

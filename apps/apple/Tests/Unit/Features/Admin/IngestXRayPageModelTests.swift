import XCTest
@testable import TeslaSync

/// State-machine tests for `IngestXRayPageModel` — the vehicle-list states (loading / empty /
/// error / content) that drive the controls' vehicle slot, the X-Ray query states
/// (idle / loading / empty / error / success) that drive the header + chart + fields, the
/// selection → re-fetch key, the `useSortToggle` parity, the projected field rows, and the
/// default sample seed. Mirrors the sibling `DLQInspectorPageModelTests`.
@MainActor final class IngestXRayPageModelTests: XCTestCase {
    private actor StubSource: IngestXRayDataSource {
        let vehicles: [XRayVehicleRef]
        let result: IngestXRayResult?
        let vehiclesFail: Bool
        let dataFail: Bool
        private(set) var xrayCalls: [IngestXRayFetchKey] = []

        init(
            vehicles: [XRayVehicleRef] = [],
            result: IngestXRayResult? = nil,
            vehiclesFail: Bool = false,
            dataFail: Bool = false
        ) {
            self.vehicles = vehicles
            self.result = result
            self.vehiclesFail = vehiclesFail
            self.dataFail = dataFail
        }

        func loadVehicles() async throws -> [XRayVehicleRef] {
            if vehiclesFail { throw StubError() }
            return vehicles
        }

        func loadXRay(
            vehicleID: Int,
            window: IngestXRayWindow,
            bucket: IngestXRayBucket,
            limit _: Int
        ) async throws -> IngestXRayResult {
            xrayCalls.append(IngestXRayFetchKey(vehicleID: vehicleID, window: window, bucket: bucket))
            if dataFail { throw StubError() }
            if let result { return result }
            return IngestXRayResult(
                vehicleID: vehicleID,
                window: window,
                bucket: bucket,
                totalSamples: 0,
                uniqueFields: 0,
                fields: [],
                buckets: []
            )
        }
    }

    private struct StubError: Error {}

    private func vehicle(_ id: Int) -> XRayVehicleRef {
        XRayVehicleRef(id: id, displayName: "Vehicle \(id)")
    }

    private func field(_ name: String, _ count: Int, kind: Int = 6) -> XRayFieldStat {
        XRayFieldStat(field: name, sampleCount: count, lastSeenAt: "2026-06-14T03:12:48Z", valueKind: kind)
    }

    private func loaded(
        fields: [XRayFieldStat],
        buckets: [XRayBucketInput]
    ) -> IngestXRayResult {
        IngestXRayResult(
            vehicleID: 1,
            window: .h1,
            bucket: .m1,
            totalSamples: buckets.reduce(0) { $0 + ($1.count ?? 0) },
            uniqueFields: fields.count,
            fields: fields,
            buckets: buckets
        )
    }

    private func oneBucket(_ count: Int) -> [XRayBucketInput] {
        [XRayBucketInput(bucketStart: "2026-06-14T03:12:00Z", count: count)]
    }

    // MARK: - Initial state

    func testInitialState() {
        let model = IngestXRayPageModel(dataSource: StubSource())
        XCTAssertEqual(model.vehiclesState, .loading)
        XCTAssertEqual(model.dataState, .idle)
        XCTAssertFalse(model.hasVehicle)
        XCTAssertNil(model.vehicleID)
        XCTAssertEqual(model.window, .h1)
        XCTAssertEqual(model.bucket, .m1)
        XCTAssertEqual(model.sortKey, .sampleCount)
        XCTAssertEqual(model.sortDirection, .descending)
    }

    // MARK: - Vehicle list states (controls vehicle slot)

    func testLoadVehiclesSuccess() async {
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1), vehicle(3)]))
        await model.loadVehicles()
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertEqual(model.controlsPhase, .content)
    }

    func testLoadVehiclesEmpty() async {
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: []))
        await model.loadVehicles()
        XCTAssertEqual(model.vehiclesState, .empty)
        XCTAssertEqual(model.controlsPhase, .empty)
    }

    func testLoadVehiclesError() async {
        let model = IngestXRayPageModel(dataSource: StubSource(vehiclesFail: true))
        await model.loadVehicles()
        guard case .error = model.controlsPhase else { return XCTFail("expected controls error") }
    }

    // MARK: - X-Ray query states (header / chart / fields)

    func testNoFetchWithoutVehicle() async {
        let source = StubSource()
        let model = IngestXRayPageModel(dataSource: source)
        await model.reloadData()
        XCTAssertEqual(model.dataState, .idle)
        let calls = await source.xrayCalls
        XCTAssertTrue(calls.isEmpty)
    }

    func testSelectVehicleThenLoadSuccess() async {
        let result = loaded(fields: [field("VehicleSpeed", 10)], buckets: oneBucket(10))
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1)], result: result))
        model.selectVehicle(1)
        await model.reloadData()
        guard case .loaded = model.dataState else { return XCTFail("expected loaded data") }
        XCTAssertEqual(model.summary?.totalSamples, 10)
        XCTAssertEqual(model.summary?.uniqueFields, 1)
    }

    func testReloadEmptyData() async {
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1)]))
        model.selectVehicle(1)
        await model.reloadData()
        XCTAssertEqual(model.dataState, .empty)
    }

    func testReloadDataError() async {
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1)], dataFail: true))
        model.selectVehicle(1)
        await model.reloadData()
        guard case .error = model.dataState else { return XCTFail("expected data error") }
    }
}

/// Selection, re-fetch key, sort, projection, and sample-seed tests (split into an extension so
/// the primary `XCTestCase` body stays within the lint budget).
extension IngestXRayPageModelTests {
    // MARK: - Selection → idle / re-fetch key

    func testSelectVehicleNilResetsToIdle() async {
        let result = loaded(fields: [field("Soc", 5)], buckets: oneBucket(5))
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1)], result: result))
        model.selectVehicle(1)
        await model.reloadData()
        model.selectVehicle(nil)
        XCTAssertFalse(model.hasVehicle)
        XCTAssertEqual(model.dataState, .idle)
    }

    func testFetchKeyTracksSelections() {
        let model = IngestXRayPageModel(dataSource: StubSource())
        let initial = model.fetchKey
        XCTAssertNil(initial.vehicleID)
        model.selectWindow(.m15)
        XCTAssertEqual(model.fetchKey.window, .m15)
        model.selectBucket(.s30)
        XCTAssertEqual(model.fetchKey.bucket, .s30)
        model.selectVehicle(3)
        XCTAssertEqual(model.fetchKey.vehicleID, 3)
        XCTAssertNotEqual(model.fetchKey, initial)
    }

    func testWindowAndBucketSelectionRecordedForRefetch() async {
        let source = StubSource(vehicles: [vehicle(1)])
        let model = IngestXRayPageModel(dataSource: source)
        model.selectVehicle(1)
        model.selectWindow(.h6)
        model.selectBucket(.m5)
        await model.reloadData()
        let calls = await source.xrayCalls
        XCTAssertEqual(calls.last?.window, .h6)
        XCTAssertEqual(calls.last?.bucket, .m5)
    }

    // MARK: - Sort toggle (web `useSortToggle`)

    func testToggleSortFlipsActiveAndSwitchesColumn() {
        let model = IngestXRayPageModel(dataSource: StubSource())
        model.toggleSort(.sampleCount)
        XCTAssertEqual(model.sortKey, .sampleCount)
        XCTAssertEqual(model.sortDirection, .ascending)
        model.toggleSort(.field)
        XCTAssertEqual(model.sortKey, .field)
        XCTAssertEqual(model.sortDirection, .descending)
        model.toggleSort(.field)
        XCTAssertEqual(model.sortDirection, .ascending)
    }

    // MARK: - Projected field rows (web `sorted` derive + column render)

    func testFieldRowsSortedDescendingBySampleCount() async {
        let fields = [field("alpha", 10), field("beta", 30), field("gamma", 20)]
        let result = loaded(fields: fields, buckets: oneBucket(60))
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1)], result: result))
        model.selectVehicle(1)
        await model.reloadData()
        XCTAssertEqual(model.fieldRows().map(\.field), ["beta", "gamma", "alpha"])
    }

    func testFieldRowsRespectSortToggleToField() async {
        let fields = [field("gamma", 20), field("alpha", 10), field("beta", 30)]
        let result = loaded(fields: fields, buckets: oneBucket(60))
        let model = IngestXRayPageModel(dataSource: StubSource(vehicles: [vehicle(1)], result: result))
        model.selectVehicle(1)
        await model.reloadData()
        // Tapping a new column sorts it descending; tapping again flips to ascending (web useSortToggle).
        model.toggleSort(.field)
        XCTAssertEqual(model.fieldRows().map(\.field), ["gamma", "beta", "alpha"])
        model.toggleSort(.field)
        XCTAssertEqual(model.fieldRows().map(\.field), ["alpha", "beta", "gamma"])
    }

    func testFieldRowsEmptyWithoutResult() {
        let model = IngestXRayPageModel(dataSource: StubSource())
        XCTAssertTrue(model.fieldRows().isEmpty)
    }

    // MARK: - Result helpers

    func testResultIsEmptyAndSummary() {
        let empty = IngestXRayResult(
            vehicleID: 1, window: .h1, bucket: .m1,
            totalSamples: 0, uniqueFields: 0, fields: [], buckets: []
        )
        XCTAssertTrue(empty.isEmpty)
        let full = loaded(fields: [field("Soc", 9)], buckets: oneBucket(9))
        XCTAssertFalse(full.isEmpty)
        XCTAssertEqual(full.summary.totalSamples, 9)
        XCTAssertEqual(full.summary.uniqueFields, 1)
    }

    // MARK: - Default sample seed

    func testSampleDataSourceSeeds() async throws {
        let source = SampleIngestXRayDataSource()
        let vehicles = try await source.loadVehicles()
        XCTAssertFalse(vehicles.isEmpty)
        let result = try await source.loadXRay(vehicleID: 1, window: .h1, bucket: .m1, limit: 100)
        XCTAssertFalse(result.fields.isEmpty)
        XCTAssertFalse(result.buckets.isEmpty)
        XCTAssertGreaterThan(result.totalSamples, 0)
        XCTAssertFalse(result.isEmpty)
    }

    func testSampleHonorsLimit() async throws {
        let source = SampleIngestXRayDataSource()
        let result = try await source.loadXRay(vehicleID: 1, window: .h1, bucket: .m1, limit: 3)
        XCTAssertLessThanOrEqual(result.fields.count, 3)
    }

    func testSampleEmptyVehicles() async throws {
        let source = SampleIngestXRayDataSource(emptyVehicles: true)
        let vehicles = try await source.loadVehicles()
        XCTAssertTrue(vehicles.isEmpty)
    }
}

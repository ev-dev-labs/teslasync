import XCTest
@testable import TeslaSync

/// Tests for the destructive purge flow on `RedisSignalViewerPageModel` — the per-vehicle and
/// cluster-wide paths (web `openPurgeOne` / `openPurgeAll` / `handlePurgeConfirm`), the typed
/// `PURGE ALL` gate (web `requireTypedConfirmation`), the success / no-op / partial / error
/// outcomes (web `toast.*`), plus the sample seeds and the route registration.
@MainActor
final class RedisSignalViewerPurgeTests: XCTestCase {
    // MARK: - Per-vehicle purge (web `openPurgeOne` / `handlePurgeConfirm`)

    func testOpenPurgeOnePinsTarget() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        model.openPurgeOne()
        XCTAssertEqual(model.purgeMode, .one)
        XCTAssertEqual(model.purgeTargetID, 1)
        XCTAssertEqual(model.purgeTargetLabel, "Model 3")
        XCTAssertTrue(model.canConfirmPurge)
    }

    func testConfirmPurgeOneSuccess() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot(), purgeResult: RedisPurgeResult(purged: true))
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.openPurgeOne()
        await model.confirmPurge()
        XCTAssertNil(model.purgeMode)
        XCTAssertEqual(model.outcome, .purgeSucceeded(vehicle: "Model 3"))
    }

    func testConfirmPurgeOneNoOp() async {
        let model = RedisFixtures.model(
            snapshot: RedisFixtures.snapshot(),
            purgeResult: RedisPurgeResult(purged: false)
        )
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.openPurgeOne()
        await model.confirmPurge()
        XCTAssertEqual(model.outcome, .purgeNoOp(vehicle: "Model 3"))
    }

    func testPurgeFailureSurfacesErrorOutcome() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot(), purgeFails: true)
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.openPurgeOne()
        await model.confirmPurge()
        guard case .failed = model.outcome else {
            return XCTFail("expected failed outcome, got \(String(describing: model.outcome))")
        }
        // The dialog stays open so the operator can retry (web mutation toast).
        XCTAssertEqual(model.purgeMode, .one)
    }

    // MARK: - Cluster-wide purge (web `openPurgeAll` + typed confirmation)

    func testPurgeAllRequiresTypedPhrase() async {
        let model = RedisFixtures.model()
        await model.load()
        model.openPurgeAll()
        XCTAssertEqual(model.purgeMode, .all)
        XCTAssertFalse(model.canConfirmPurge) // empty confirmation
        model.purgeAllConfirmation = "purge all"
        XCTAssertFalse(model.canConfirmPurge) // wrong case
        model.purgeAllConfirmation = RedisSignalViewerPageModel.purgeAllPhrase
        XCTAssertTrue(model.canConfirmPurge)
    }

    func testConfirmPurgeAllSuccess() async {
        let model = RedisFixtures.model(
            purgeAllResult: RedisPurgeAllResult(purged: 4, scanned: 4, limit: 1000, hasMore: false)
        )
        await model.load()
        model.openPurgeAll()
        model.purgeAllConfirmation = RedisSignalViewerPageModel.purgeAllPhrase
        await model.confirmPurge()
        XCTAssertEqual(model.outcome, .purgeAllSucceeded(count: 4))
        XCTAssertNil(model.purgeMode)
    }

    func testConfirmPurgeAllPartial() async {
        let model = RedisFixtures.model(
            purgeAllResult: RedisPurgeAllResult(purged: 1000, scanned: 1000, limit: 1000, hasMore: true)
        )
        await model.load()
        model.openPurgeAll()
        model.purgeAllConfirmation = RedisSignalViewerPageModel.purgeAllPhrase
        await model.confirmPurge()
        XCTAssertEqual(model.outcome, .purgeAllPartial(count: 1000, limit: 1000))
    }

    func testCancelPurgeResetsState() async {
        let model = RedisFixtures.model()
        await model.load()
        model.openPurgeAll()
        model.purgeAllConfirmation = "partial"
        model.cancelPurge()
        XCTAssertNil(model.purgeMode)
        XCTAssertEqual(model.purgeAllConfirmation, "")
    }

    func testDismissOutcome() async {
        let model = RedisFixtures.model(snapshot: RedisFixtures.snapshot())
        await model.load()
        model.selectVehicle(1)
        await model.loadSignals()
        model.openPurgeOne()
        await model.confirmPurge()
        XCTAssertNotNil(model.outcome)
        model.dismissOutcome()
        XCTAssertNil(model.outcome)
    }

    func testOutcomeTones() {
        XCTAssertEqual(RedisPurgeOutcome.purgeSucceeded(vehicle: "x").tone, .success)
        XCTAssertEqual(RedisPurgeOutcome.purgeNoOp(vehicle: "x").tone, .info)
        XCTAssertEqual(RedisPurgeOutcome.purgeAllSucceeded(count: 1).tone, .success)
        XCTAssertEqual(RedisPurgeOutcome.purgeAllPartial(count: 1, limit: 2).tone, .warning)
        XCTAssertEqual(RedisPurgeOutcome.failed(message: "x").tone, .danger)
    }

    // MARK: - Sample seeds + route registration

    func testSampleSourcesAreWellFormed() async throws {
        let list = try await SampleRedisSignalViewerVehicleSource().loadVehicles()
        XCTAssertEqual(list.count, 3)
        XCTAssertNil(list.last?.displayName) // exercises the VIN fallback

        let snap = try await SampleRedisSignalStore().loadSignals(vehicleID: 1)
        XCTAssertFalse(snap.rows.isEmpty)
        XCTAssertEqual(snap.signalCount, snap.rows.count)
        XCTAssertTrue(snap.rows.contains { $0.isLocation })
        XCTAssertTrue(snap.rows.contains { $0.value.typeLabel == "number" })
        XCTAssertTrue(snap.rows.contains { $0.value.typeLabel == "string" })
        XCTAssertTrue(snap.rows.contains { $0.value.typeLabel == "boolean" })
    }

    func testRouteRegistrationRegistersRedisSignals() {
        let registry = RedisSignalViewerRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.redisSignals))
        XCTAssertNotNil(registry.view(for: .redisSignals))
    }
}

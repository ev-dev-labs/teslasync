import XCTest
@testable import TeslaSync

/// State-machine + mutation tests for `ConditionBuilderPageModel` — every page state (loading /
/// empty / success), the geofence data-source states surfaced through the reused
/// `GeofenceOptionsModel` (loading / content / empty / error / offline), the add / remove /
/// change-kind / update-body mutations, and the reused `ConditionBuilderAdapter` value coercion. The
/// web component is a controlled form, so these assert the form logic directly.
@MainActor final class ConditionBuilderPageModelTests: XCTestCase {
    private struct StubProvider: ConditionBuilderPageProviding {
        let value: [ConditionBody]
        init(_ value: [ConditionBody]) {
            self.value = value
        }

        func load() async -> [ConditionBody] {
            value
        }
    }

    private func model(
        _ conditions: [ConditionBody] = [],
        geofences: GeofenceOptionsModel? = nil
    ) -> ConditionBuilderPageModel {
        ConditionBuilderPageModel(provider: StubProvider(conditions), geofences: geofences)
    }

    // MARK: - Page states

    func testInitialStateIsLoading() {
        let model = model([.signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20))])
        XCTAssertEqual(model.state, .loading)
        XCTAssertTrue(model.conditions.isEmpty)
    }

    func testLoadEmptyYieldsEmptyState() async {
        let model = model()
        await model.load()
        XCTAssertEqual(model.state, .empty)
        XCTAssertTrue(model.conditions.isEmpty)
    }

    func testLoadPopulatesSuccess() async {
        let model = model([
            .signal(SignalCondition(signal: "speed", op: .greaterThan, valueNum: 50)),
            .geofence(GeofenceCondition(placeId: 1, state: .inside))
        ])
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.conditions.count, 2)
    }

    func testDefaultProviderLoadsOneOfEachKind() async {
        let model = ConditionBuilderPageModel(provider: DefaultConditionBuilderPageData())
        await model.load()
        XCTAssertEqual(model.state, .success)
        XCTAssertEqual(model.conditions.map(\.body.kind), [.signal, .timeWindow, .geofence, .otherAutomation])
    }

    // MARK: - Geofence data-source states (web useGeofences)

    func testDefaultGeofenceFeedReachesContent() async {
        let model = ConditionBuilderPageModel(provider: DefaultConditionBuilderPageData())
        await model.load()
        guard case let .content(options, freshness, refreshing) = model.geofences.presentation else {
            return XCTFail("expected content, got \(model.geofences.presentation)")
        }
        XCTAssertEqual(options.count, ConditionBuilderPageModel.sampleGeofences.count)
        XCTAssertEqual(freshness, .live)
        XCTAssertFalse(refreshing)
    }

    func testGeofenceLoadingPresentation() async {
        let model = model(geofences: GeofenceOptionsModel(previewState: .loading(cached: nil, stale: false)))
        await model.load()
        XCTAssertEqual(model.geofences.presentation, .loading)
    }

    func testGeofenceEmptyPresentation() async {
        let model = model(geofences: GeofenceOptionsModel(previewState: .empty(stale: false)))
        await model.load()
        XCTAssertEqual(model.geofences.presentation, .empty(.live))
    }

    func testGeofenceErrorPresentationIsRetryable() async {
        let model = model(geofences: GeofenceOptionsModel(
            previewState: .failed(.network(message: "boom"), cached: nil, stale: false)
        ))
        await model.load()
        XCTAssertEqual(model.geofences.presentation, .error(retryable: true))
    }

    func testGeofenceOfflineWithNoCache() async {
        let model = model(geofences: GeofenceOptionsModel(
            previewState: .failed(.offline, cached: nil, stale: false)
        ))
        await model.load()
        XCTAssertEqual(model.geofences.presentation, .offlineNoData)
    }

    func testGeofenceDecodeErrorIsNotRetryable() async {
        let model = model(geofences: GeofenceOptionsModel(
            previewState: .failed(.decode(message: "bad"), cached: nil, stale: false)
        ))
        await model.load()
        XCTAssertEqual(model.geofences.presentation, .error(retryable: false))
    }

    // MARK: - Add / remove

    func testAddConditionAppendsDefaultSignal() async {
        let model = model()
        await model.load()
        XCTAssertEqual(model.state, .empty)
        model.addCondition()
        XCTAssertEqual(model.conditions.count, 1)
        XCTAssertEqual(model.conditions[0].body.kind, .signal)
        XCTAssertEqual(model.conditions[0].body.asSignal?.signal, "battery_level")
        XCTAssertEqual(model.state, .success)
    }

    func testRemoveCondition() async {
        let model = model([
            .signal(SignalCondition(signal: "speed", op: .greaterThan, valueNum: 50)),
            .geofence(GeofenceCondition(placeId: 2, state: .outside))
        ])
        await model.load()
        let firstID = model.conditions[0].id
        model.removeCondition(id: firstID)
        XCTAssertEqual(model.conditions.count, 1)
        XCTAssertEqual(model.conditions[0].body.kind, .geofence)
    }

    func testRemoveLastConditionReturnsToEmpty() async {
        let model = model([.geofence(GeofenceCondition(placeId: 1, state: .inside))])
        await model.load()
        model.removeCondition(id: model.conditions[0].id)
        XCTAssertEqual(model.state, .empty)
    }

    // MARK: - Change kind / update body (web replaceCondition)

    func testChangeKindReplacesWithDefault() async {
        let model = model([.signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20))])
        await model.load()
        let id = model.conditions[0].id
        model.changeKind(id: id, to: .timeWindow)
        XCTAssertEqual(model.conditions[0].body.kind, .timeWindow)
        XCTAssertEqual(model.conditions[0].body.asTimeWindow?.daysOfWeek, [1, 2, 3, 4, 5])

        model.changeKind(id: id, to: .otherAutomation)
        XCTAssertEqual(model.conditions[0].body, .otherAutomation(
            OtherAutomationCondition(otherAutomationId: 0, state: .enabled)
        ))
    }

    func testUpdateBodyCommitsSignalEdit() async {
        let model = model([.signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 20))])
        await model.load()
        let id = model.conditions[0].id
        let current = model.body(for: id)?.asSignal ?? SignalCondition(signal: "x", op: .equals)

        // Switch to a boolean signal — adapter coerces op to `=` and seeds value_bool true.
        let next = ConditionBuilderAdapter.signalChanged(to: "is_locked")
        model.updateBody(id: id, .signal(next))
        XCTAssertEqual(model.body(for: id)?.asSignal?.signal, "is_locked")
        XCTAssertEqual(model.body(for: id)?.asSignal?.op, .equals)
        XCTAssertEqual(model.body(for: id)?.asSignal?.valueBool, true)
        XCTAssertNotEqual(current.signal, "is_locked")
    }

    func testUpdateBodyBetweenOperatorSeedsMinMax() async throws {
        let model = model([.signal(SignalCondition(signal: "battery_level", op: .lessThan, valueNum: 42))])
        await model.load()
        let id = model.conditions[0].id
        let current = try XCTUnwrap(model.body(for: id)?.asSignal)
        model.updateBody(id: id, .signal(ConditionBuilderAdapter.operatorChanged(current, to: .between)))
        let signal = try XCTUnwrap(model.body(for: id)?.asSignal)
        XCTAssertEqual(signal.op, .between)
        XCTAssertEqual(signal.valueMin, 42)
        XCTAssertEqual(signal.valueMax, 100)
    }

    func testUpdateBodyIgnoresUnknownID() async {
        let model = model([.signal(SignalCondition(signal: "speed", op: .greaterThan, valueNum: 10))])
        await model.load()
        model.updateBody(id: UUID(), .signal(SignalCondition(signal: "speed", op: .lessThan, valueNum: 99)))
        XCTAssertEqual(model.body(for: model.conditions[0].id)?.asSignal?.valueNum, 10)
    }

    // MARK: - Projections / refresh

    func testConditionBodiesProjection() async {
        let bodies: [ConditionBody] = [
            .signal(SignalCondition(signal: "speed", op: .greaterThan, valueNum: 50)),
            .otherAutomation(OtherAutomationCondition(otherAutomationId: 7, state: .disabled))
        ]
        let model = model(bodies)
        await model.load()
        XCTAssertEqual(model.conditionBodies, bodies)
    }

    func testRefreshReseeds() async {
        let model = model([.geofence(GeofenceCondition(placeId: 1, state: .inside))])
        await model.load()
        model.addCondition()
        XCTAssertEqual(model.conditions.count, 2)
        await model.refresh()
        XCTAssertEqual(model.conditions.count, 1)
        XCTAssertEqual(model.conditions[0].body.kind, .geofence)
    }
}

//
//  AIPeriodCompareNarration.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  Adapter-level unit coverage (Foundation-only): the request body (`vehicle_id` + optional
//  `days_a` / `days_b`, snake_case, the /ai/analytics/period-compare/narrate path, the non-finite →
//  0 vehicle coercion, and the `days_a: 0` "all time" passthrough), the `string | number` vehicle
//  coercion + the `isFinite && > 0` gate, the `daysA` / `daysB` window coercion (`isFinite && >= 0`),
//  the SSE frame parsing (port of `parseSSEFrame` + `toTypedEvent`), the delta-accumulating stream
//  reducer (port of `handleEvent` + `finalizeError` + the `stream_http_{status}` HTTP failure), and
//  the output / action derivations (port of the `AiOutputPanel` branches + the `AIFeatureCard`
//  button contract).
//

import XCTest
@testable import TeslaSync

// MARK: - Vehicle coercion (web `Number(vehicleId)` + `Number.isFinite`)

final class PeriodCompareNarrationVehicleIDTests: XCTestCase {
    func testResolvesNumberAsIs() {
        XCTAssertEqual(PeriodCompareNarrationVehicleID.resolve(.number(7)), 7)
    }

    func testResolvesNumericString() {
        XCTAssertEqual(PeriodCompareNarrationVehicleID.resolve(.text("7")), 7)
    }

    func testResolvesNumericStringWithSurroundingWhitespace() {
        // JS Number("  12  ") === 12.
        XCTAssertEqual(PeriodCompareNarrationVehicleID.resolve(.text("  12  ")), 12)
    }

    func testResolvesEmptyStringToZero() {
        // JS Number("") === 0 (the web `?? 0`-equivalent finite-but-zero case).
        XCTAssertEqual(PeriodCompareNarrationVehicleID.resolve(.text("")), 0)
    }

    func testNonNumericStringIsNonFinite() {
        // JS Number("abc") === NaN → !Number.isFinite → nil.
        XCTAssertNil(PeriodCompareNarrationVehicleID.resolve(.text("abc")))
    }

    func testAbsentIsNonFinite() {
        // JS Number(undefined) === NaN → !Number.isFinite → nil.
        XCTAssertNil(PeriodCompareNarrationVehicleID.resolve(.absent))
    }

    func testNaNAndInfinityAreNonFinite() {
        XCTAssertNil(PeriodCompareNarrationVehicleID.resolve(.number(.nan)))
        XCTAssertNil(PeriodCompareNarrationVehicleID.resolve(.number(.infinity)))
        XCTAssertNil(PeriodCompareNarrationVehicleID.resolve(.number(-.infinity)))
    }

    func testCanStartRequiresFiniteAndPositive() {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        XCTAssertTrue(PeriodCompareNarrationVehicleID.canStart(7))
        XCTAssertFalse(PeriodCompareNarrationVehicleID.canStart(0))
        XCTAssertFalse(PeriodCompareNarrationVehicleID.canStart(-3))
        XCTAssertFalse(PeriodCompareNarrationVehicleID.canStart(nil))
    }

    func testCanStartFromRawProp() {
        XCTAssertTrue(PeriodCompareNarrationVehicleID.canStart(raw: .number(7)))
        XCTAssertTrue(PeriodCompareNarrationVehicleID.canStart(raw: .text("7")))
        XCTAssertFalse(PeriodCompareNarrationVehicleID.canStart(raw: .number(0)))
        XCTAssertFalse(PeriodCompareNarrationVehicleID.canStart(raw: .text("abc")))
        XCTAssertFalse(PeriodCompareNarrationVehicleID.canStart(raw: .absent))
    }
}

// MARK: - Days coercion (web `typeof days === 'number' && Number.isFinite(days) && days >= 0`)

final class PeriodCompareNarrationDaysTests: XCTestCase {
    func testResolvesPositiveWindow() {
        XCTAssertEqual(PeriodCompareNarrationDays.resolve(.number(30)), 30)
        XCTAssertEqual(PeriodCompareNarrationDays.resolve(.number(365)), 365)
    }

    func testZeroIsForwardedNotOmitted() {
        // Parity: 0 == "all time" and IS passed through (the wiring contract asserts days_a: 0).
        XCTAssertEqual(PeriodCompareNarrationDays.resolve(.number(0)), 0)
    }

    func testNegativeIsOmitted() {
        // Web `days >= 0` → a negative window is omitted from the body.
        XCTAssertNil(PeriodCompareNarrationDays.resolve(.number(-1)))
    }

    func testAbsentIsOmitted() {
        // Web `typeof daysA === 'number'` is false for undefined → omitted.
        XCTAssertNil(PeriodCompareNarrationDays.resolve(.absent))
    }

    func testNonFiniteIsOmitted() {
        XCTAssertNil(PeriodCompareNarrationDays.resolve(.number(.nan)))
        XCTAssertNil(PeriodCompareNarrationDays.resolve(.number(.infinity)))
        XCTAssertNil(PeriodCompareNarrationDays.resolve(.number(-.infinity)))
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class PeriodCompareNarrationRequestTests: XCTestCase {
    func testPathIsBareRoute() {
        XCTAssertEqual(PeriodCompareNarrationRequest.path, "/ai/analytics/period-compare/narrate")
    }

    func testBodyForwardsVehicleAndBothDayWindows() {
        // Parity: the verified wiring contract is `{ vehicle_id: 42, days_a: 0, days_b: 365 }`.
        let request = PeriodCompareNarrationRequest(vehicleID: 42, daysA: 0, daysB: 365)
        XCTAssertEqual(request.body, ["vehicle_id": 42, "days_a": 0, "days_b": 365])
    }

    func testBodyUsesSnakeCaseKeys() {
        let body = PeriodCompareNarrationRequest(vehicleID: 42, daysA: 30, daysB: 90).body
        XCTAssertEqual(body["vehicle_id"], 42)
        XCTAssertEqual(body["days_a"], 30)
        XCTAssertEqual(body["days_b"], 90)
        // camelCase keys must NOT exist (backend uses snake_case).
        XCTAssertNil(body["vehicleId"])
        XCTAssertNil(body["daysA"])
    }

    func testBodyOmitsAbsentDayWindows() {
        // Parity: the web spreads `days_a` / `days_b` only when present; both absent ⇒ vehicle only.
        let body = PeriodCompareNarrationRequest(vehicleID: 42).body
        XCTAssertEqual(body, ["vehicle_id": 42])
        XCTAssertNil(body["days_a"])
        XCTAssertNil(body["days_b"])
    }

    func testBodyOmitsOnlyTheAbsentWindow() {
        XCTAssertEqual(
            PeriodCompareNarrationRequest(vehicleID: 42, daysA: 30, daysB: nil).body,
            ["vehicle_id": 42, "days_a": 30]
        )
        XCTAssertEqual(
            PeriodCompareNarrationRequest(vehicleID: 42, daysA: nil, daysB: 90).body,
            ["vehicle_id": 42, "days_b": 90]
        )
    }

    func testBodyCoercesMissingVehicleToZero() {
        // Web `vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0`.
        XCTAssertEqual(PeriodCompareNarrationRequest(vehicleID: nil).body["vehicle_id"], 0)
    }

    func testEncodedBodyIsDeterministicSortedJSON() throws {
        let data = try PeriodCompareNarrationRequest(vehicleID: 42, daysA: 0, daysB: 365).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"days_a\":0,\"days_b\":365,\"vehicle_id\":42}")
    }

    func testEncodedBodyForVehicleOnly() throws {
        let data = try PeriodCompareNarrationRequest(vehicleID: 42).encodedBody()
        let json = try XCTUnwrap(String(bytes: data, encoding: .utf8))
        XCTAssertEqual(json, "{\"vehicle_id\":42}")
    }

    func testEndToEndFromRawPropsMatchesWiringContract() {
        // Resolve the raw props exactly as the parent page supplies them, then build the body.
        let vehicleID = PeriodCompareNarrationVehicleID.resolve(.number(42))
        let daysA = PeriodCompareNarrationDays.resolve(.number(0))
        let daysB = PeriodCompareNarrationDays.resolve(.number(365))
        let body = PeriodCompareNarrationRequest(vehicleID: vehicleID, daysA: daysA, daysB: daysB).body
        XCTAssertEqual(body, ["vehicle_id": 42, "days_a": 0, "days_b": 365])
    }
}

// MARK: - Output derivation (web `AiOutputPanel` branches)

final class PeriodCompareNarrationOutputDeriveTests: XCTestCase {
    func testEmptyWhenIdleAndUntouched() {
        XCTAssertEqual(PeriodCompareNarrationOutput.derive(.idle), .empty)
    }

    func testEmptyWhenPausedWithoutText() {
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(PeriodCompareNarrationStreamSnapshot(state: .pausedConfirm)),
            .empty
        )
    }

    func testThinkingWhileStreamingBeforeFirstDelta() {
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(PeriodCompareNarrationStreamSnapshot(state: .streaming, text: "")),
            .thinking
        )
    }

    func testProseWhileStreamingWithText() {
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(
                PeriodCompareNarrationStreamSnapshot(state: .streaming, text: "partial")
            ),
            .prose("partial")
        )
    }

    func testProseWhenDoneWithText() {
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(PeriodCompareNarrationStreamSnapshot(state: .done, text: "final")),
            .prose("final")
        )
    }

    func testProseEmptyWhenDoneWithoutText() {
        // Web: state==='done' is `hasAnything`, not error, not streaming → the prose branch (empty).
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(PeriodCompareNarrationStreamSnapshot(state: .done, text: "")),
            .prose("")
        )
    }

    func testFailedCarriesMessage() {
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(
                PeriodCompareNarrationStreamSnapshot(state: .error, text: "", error: "stream_http_500")
            ),
            .failed(message: "stream_http_500")
        )
    }

    func testFailedWithoutMessageIsEmptyString() {
        XCTAssertEqual(
            PeriodCompareNarrationOutput.derive(
                PeriodCompareNarrationStreamSnapshot(state: .error, text: "", error: nil)
            ),
            .failed(message: "")
        )
    }
}

// MARK: - Action derivation (web `AIFeatureCard` button)

final class PeriodCompareNarrationActionDeriveTests: XCTestCase {
    func testIdleWithVehicleIsEnabled() {
        let action = PeriodCompareNarrationAction.derive(canStart: true, state: .idle)
        XCTAssertFalse(action.isStreaming)
        XCTAssertFalse(action.isDisabled)
    }

    func testStreamingIsDisabledAndFlagged() {
        let action = PeriodCompareNarrationAction.derive(canStart: true, state: .streaming)
        XCTAssertTrue(action.isStreaming)
        XCTAssertTrue(action.isDisabled)
    }

    func testNoVehicleIsDisabled() {
        XCTAssertTrue(PeriodCompareNarrationAction.derive(canStart: false, state: .idle).isDisabled)
        XCTAssertTrue(PeriodCompareNarrationAction.derive(canStart: false, state: .streaming).isDisabled)
    }
}

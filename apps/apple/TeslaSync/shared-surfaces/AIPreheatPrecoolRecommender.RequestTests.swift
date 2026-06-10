//
//  AIPreheatPrecoolRecommender.RequestTests.swift
//  TeslaSync — P4 shared surface · 0040 · AIPreheatPrecoolRecommender (Apple)
//
//  Foundation-only unit coverage for the request core (AIPreheatPrecoolRecommender.Request.swift):
//  the `string | number` vehicle coercion, the static path `/ai/climate/schedule/draft`, the
//  five-field snake_case draft body with the web `? … : fallback` defaults (and the `target … : 21`),
//  and the five-part `canStart` gate (`haveVehicle && haveDepart && haveCabin && haveOutside`).
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Vehicle coercion (web `typeof vehicleId === 'number' ? vehicleId : Number(vehicleId)`)

final class PreheatPrecoolVehicleIDTests: XCTestCase {
    func testNumberResolvesAsIs() {
        XCTAssertEqual(PreheatPrecoolVehicleID.resolve(.number(12)), 12)
    }

    func testNumberTruncatesToInt() {
        // Web `numericVehicleId` may be fractional; the canonical id is the truncated integer.
        XCTAssertEqual(PreheatPrecoolVehicleID.resolve(.number(5.7)), 5)
    }

    func testTextParsesNumericString() {
        // Web `Number('7')` → 7.
        XCTAssertEqual(PreheatPrecoolVehicleID.resolve(.text("7")), 7)
    }

    func testTextTrimsWhitespace() {
        XCTAssertEqual(PreheatPrecoolVehicleID.resolve(.text("  42 ")), 42)
    }

    func testEmptyStringIsZero() {
        // JS `Number('') === 0`.
        XCTAssertEqual(PreheatPrecoolVehicleID.resolve(.text("")), 0)
    }

    func testNonNumericTextIsNil() {
        // JS `Number('abc') === NaN` → non-finite → nil.
        XCTAssertNil(PreheatPrecoolVehicleID.resolve(.text("abc")))
    }

    func testAbsentIsNil() {
        // JS `Number(undefined) === NaN` → nil.
        XCTAssertNil(PreheatPrecoolVehicleID.resolve(.absent))
    }

    func testNonFiniteNumberIsNil() {
        XCTAssertNil(PreheatPrecoolVehicleID.resolve(.number(.infinity)))
        XCTAssertNil(PreheatPrecoolVehicleID.resolve(.number(.nan)))
    }
}

// MARK: - Request (web `useAiStream({ url, body })`)

final class PreheatPrecoolRequestTests: XCTestCase {
    private func decode(_ request: PreheatPrecoolRequest) throws -> [String: Any] {
        let data = try request.encodedBody()
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    func testPathIsClimateScheduleDraft() {
        // Web `useAiStream({ url: '/ai/climate/schedule/draft' })` — static, id in the BODY.
        XCTAssertEqual(PreheatPrecoolRequest.path, "/ai/climate/schedule/draft")
    }

    func testResolvedValuesUseWebFallbacksWhenAbsent() {
        let request = PreheatPrecoolRequest()
        XCTAssertEqual(request.resolvedVehicleID, 0)
        XCTAssertEqual(request.resolvedDepartBy, "")
        XCTAssertEqual(request.resolvedCurrentCabinTempC, 0)
        XCTAssertEqual(request.resolvedOutsideTempC, 0)
        // Web `target = isFinite(targetCabinTempC) ? targetCabinTempC : 21`.
        XCTAssertEqual(request.resolvedTargetCabinTempC, 21)
    }

    func testResolvedValuesPassThroughWhenPresent() {
        let request = PreheatPrecoolRequest(
            vehicleID: 9,
            departBy: "2026-01-15T08:00:00Z",
            currentCabinTempC: 9.5,
            outsideTempC: 2.0,
            targetCabinTempC: 19.5
        )
        XCTAssertEqual(request.resolvedVehicleID, 9)
        XCTAssertEqual(request.resolvedDepartBy, "2026-01-15T08:00:00Z")
        XCTAssertEqual(request.resolvedCurrentCabinTempC, 9.5)
        XCTAssertEqual(request.resolvedOutsideTempC, 2.0)
        XCTAssertEqual(request.resolvedTargetCabinTempC, 19.5)
    }

    func testEncodedBodyHasFiveSnakeCaseKeysWithValues() throws {
        let request = PreheatPrecoolRequest(
            vehicleID: 7,
            departBy: "2026-01-15T08:00:00Z",
            currentCabinTempC: 20,
            outsideTempC: 5,
            targetCabinTempC: 21
        )
        let body = try decode(request)
        XCTAssertEqual(body.count, 5)
        XCTAssertEqual(body["vehicle_id"] as? Int, 7)
        XCTAssertEqual(body["depart_by"] as? String, "2026-01-15T08:00:00Z")
        XCTAssertEqual(try XCTUnwrap(body["current_cabin_temp_c"] as? Double), 20, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(body["outside_temp_c"] as? Double), 5, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(body["target_cabin_temp_c"] as? Double), 21, accuracy: 0.0001)
    }

    func testEncodedBodyAppliesFallbacksForEmptyRequest() throws {
        let body = try decode(PreheatPrecoolRequest())
        XCTAssertEqual(body["vehicle_id"] as? Int, 0)
        XCTAssertEqual(body["depart_by"] as? String, "")
        XCTAssertEqual(try XCTUnwrap(body["current_cabin_temp_c"] as? Double), 0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(body["outside_temp_c"] as? Double), 0, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(body["target_cabin_temp_c"] as? Double), 21, accuracy: 0.0001)
    }

    func testEncodedBodyPreservesFractionalTemps() throws {
        let request = PreheatPrecoolRequest(
            vehicleID: 1,
            departBy: "t",
            currentCabinTempC: 18.3,
            outsideTempC: -4.5,
            targetCabinTempC: 20.5
        )
        let body = try decode(request)
        XCTAssertEqual(try XCTUnwrap(body["current_cabin_temp_c"] as? Double), 18.3, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(body["outside_temp_c"] as? Double), -4.5, accuracy: 0.0001)
        XCTAssertEqual(try XCTUnwrap(body["target_cabin_temp_c"] as? Double), 20.5, accuracy: 0.0001)
    }

    func testEncodedBodyIsDeterministic() throws {
        // sortedKeys → identical bytes across encodes (stable for snapshotting / diffing).
        let request = PreheatPrecoolRequest(
            vehicleID: 3,
            departBy: "z",
            currentCabinTempC: 1.5,
            outsideTempC: 0,
            targetCabinTempC: 21
        )
        XCTAssertEqual(try request.encodedBody(), try request.encodedBody())
    }
}

// MARK: - canStart gate (web `haveInputs`)

final class PreheatPrecoolGateTests: XCTestCase {
    private func request(
        vehicleID: Int? = 12,
        departBy: String? = "2026-01-15T08:00:00Z",
        currentCabinTempC: Double? = 9.5,
        outsideTempC: Double? = 2.0,
        targetCabinTempC: Double? = 21
    ) -> PreheatPrecoolRequest {
        PreheatPrecoolRequest(
            vehicleID: vehicleID,
            departBy: departBy,
            currentCabinTempC: currentCabinTempC,
            outsideTempC: outsideTempC,
            targetCabinTempC: targetCabinTempC
        )
    }

    func testHaveVehicleRequiresPositiveFiniteID() {
        XCTAssertTrue(request(vehicleID: 12).haveVehicle)
        XCTAssertFalse(request(vehicleID: 0).haveVehicle)
        XCTAssertFalse(request(vehicleID: -3).haveVehicle)
        XCTAssertFalse(request(vehicleID: nil).haveVehicle)
    }

    func testHaveDepartRequiresNonEmptyString() {
        XCTAssertTrue(request(departBy: "2026-01-15T08:00:00Z").haveDepart)
        XCTAssertFalse(request(departBy: "").haveDepart)
        XCTAssertFalse(request(departBy: nil).haveDepart)
    }

    func testHaveCabinRequiresValue() {
        XCTAssertTrue(request(currentCabinTempC: 9.5).haveCabin)
        XCTAssertFalse(request(currentCabinTempC: nil).haveCabin)
    }

    func testHaveOutsideRequiresValue() {
        XCTAssertTrue(request(outsideTempC: 2.0).haveOutside)
        XCTAssertFalse(request(outsideTempC: nil).haveOutside)
    }

    func testCanStartRequiresAllFour() {
        XCTAssertTrue(request().canStart)
        XCTAssertFalse(request(vehicleID: nil).canStart)
        XCTAssertFalse(request(departBy: nil).canStart)
        XCTAssertFalse(request(currentCabinTempC: nil).canStart)
        XCTAssertFalse(request(outsideTempC: nil).canStart)
    }

    func testCanStartIgnoresTarget() {
        // The target defaults to 21 °C, so a missing target must NOT disable the button.
        XCTAssertTrue(request(targetCabinTempC: nil).canStart)
    }
}

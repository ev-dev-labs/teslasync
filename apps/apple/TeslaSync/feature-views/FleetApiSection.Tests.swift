//
//  FleetApiSection.Tests.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  Adapter + formatter + content coverage for the FleetApiSection surface: the
//  defensive `extractTelemetryErrors` / `pickString`, the card projections, the
//  partner-key badge precedence, the onboarding progress / auto-detect, the
//  result-panel + telemetry-errors-phase resolution, the pretty-printer, the
//  section phase / freshness resolution, the canonical onboarding + signal catalogs,
//  and the VoiceOver copy. Pure: no network, no view. The adapter subset is also
//  proven by an executed headless harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Telemetry-error extraction (port parity)

final class FleetApiTelemetryErrorsTests: XCTestCase {
    func testEnvelopeWrappedErrors() {
        let payload = JSONValue.object([
            "response": .object(["errors": .array([
                .object([
                    "reported_at": .string("2026-01-02T03:04:05Z"),
                    "error_code": .string("E1"), "error_message": .string("bad"), "vin": .string("V1")
                ]),
                .object(["timestamp": .string("2026-01-02T03:05:05Z"), "code": .string("E2")])
            ])])
        ])
        let result = FleetApiBuilder.extractTelemetryErrors(payload)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.errors.count, 2)
        XCTAssertEqual(result.errors[0].code, "E1")
        XCTAssertEqual(result.errors[0].message, "bad")
        XCTAssertEqual(result.errors[1].code, "E2")
        XCTAssertEqual(result.errors[1].message, "")
        XCTAssertEqual(result.errors[0].rowKey, "2026-01-02T03:04:05Z|E1|V1|0")
    }

    func testArrayUnderRootErrors() {
        let payload = JSONValue.object(["errors": .array([.object(["name": .string("topicErr")])])])
        let result = FleetApiBuilder.extractTelemetryErrors(payload)
        XCTAssertTrue(result.ok)
        XCTAssertEqual(result.errors.first?.code, "topicErr")
    }

    func testUnknownShapeIsNotOk() {
        let result = FleetApiBuilder.extractTelemetryErrors(.object(["weird": .string("x")]))
        XCTAssertFalse(result.ok)
        XCTAssertTrue(result.errors.isEmpty)
    }

    func testHealthyEmptyArrayIsOk() {
        let result = FleetApiBuilder.extractTelemetryErrors(.object(["errors": .array([])]))
        XCTAssertTrue(result.ok)
        XCTAssertTrue(result.errors.isEmpty)
    }

    func testNonObjectIsNotOk() {
        XCTAssertFalse(FleetApiBuilder.extractTelemetryErrors(.string("nope")).ok)
        XCTAssertFalse(FleetApiBuilder.extractTelemetryErrors(.null).ok)
    }

    func testPickStringCoercesNumbersAndSkipsBlanks() {
        XCTAssertEqual(FleetApiBuilder.pickString(["ts": .number(1_700_000_000)], ["ts"]), "1700000000")
        XCTAssertEqual(FleetApiBuilder.pickString(["a": .string(""), "b": .string("y")], ["a", "b"]), "y")
        XCTAssertEqual(FleetApiBuilder.pickString([:], ["missing"]), "")
    }
}

// MARK: - Card projections

final class FleetApiProjectionTests: XCTestCase {
    func testVehicleOptionsMapAndFallback() {
        let payload = JSONValue.array([
            .object(["vin": .string("VINA"), "display_name": .string("Red")]),
            .object(["vin": .string("VINB"), "display_name": .string("")]),
            .object(["display_name": .string("noVin")])
        ])
        let options = FleetApiBuilder.vehicleOptions(from: payload)
        XCTAssertEqual(options.count, 2)
        XCTAssertEqual(options[0].label, "Red")
        XCTAssertEqual(options[1].label, "VINB")
    }

    func testConfigInfoProjection() {
        let info = FleetApiBuilder.configInfo(from: .object([
            "baseUrl": .string("https://api"), "clientId": .string("cid"),
            "authenticated": .bool(true), "regions": .array([.string("na"), .string("eu")]),
            "hostname": .string("host")
        ]))
        XCTAssertEqual(info.baseURL, "https://api")
        XCTAssertEqual(info.clientID, "cid")
        XCTAssertTrue(info.authenticated)
        XCTAssertEqual(info.regions, ["na", "eu"])
        XCTAssertEqual(info.hostname, "host")
    }

    func testPublicKeyStatusProjection() {
        let status = FleetApiBuilder.publicKeyStatus(from: .object([
            "configured": .bool(true), "fingerprint": .string("ab:cd")
        ]))
        XCTAssertTrue(status.configured)
        XCTAssertEqual(status.fingerprint, "ab:cd")
        XCTAssertNil(status.wellKnownURL)
    }

    func testPartnerKeyVerificationProjection() {
        let verification = FleetApiBuilder.partnerKeyVerification(from: .object([
            "verification": .object([
                "remote_key_found": .bool(true), "matches_local": .bool(false),
                "local_key_configured": .bool(true)
            ]),
            "response": .object(["public_key": .string("-----PEM-----")])
        ]))
        XCTAssertTrue(verification.remoteKeyFound)
        XCTAssertFalse(verification.matchesLocal)
        XCTAssertTrue(verification.localKeyConfigured)
        XCTAssertEqual(verification.publicKeyPEM, "-----PEM-----")
    }

    func testPartnerKeyBadgePrecedence() {
        let mismatch = PartnerKeyVerification(remoteKeyFound: true, matchesLocal: false, localKeyConfigured: true)
        XCTAssertEqual(FleetApiBuilder.partnerKeyBadges(mismatch).map(\.id), ["registered", "mismatch"])
        let matches = PartnerKeyVerification(remoteKeyFound: true, matchesLocal: true, localKeyConfigured: true)
        XCTAssertEqual(FleetApiBuilder.partnerKeyBadges(matches).map(\.id), ["registered", "matches"])
        let noLocal = PartnerKeyVerification(remoteKeyFound: true, localKeyConfigured: false)
        XCTAssertEqual(FleetApiBuilder.partnerKeyBadges(noLocal).map(\.id), ["registered", "noLocal"])
        let notFound = PartnerKeyVerification(remoteKeyFound: false)
        XCTAssertEqual(FleetApiBuilder.partnerKeyBadges(notFound).map(\.id), ["notFound"])
    }

    func testPairingURL() {
        XCTAssertEqual(FleetApiBuilder.pairingURL(hostname: "h.com"), "https://tesla.com/_ak/h.com")
        XCTAssertEqual(FleetApiBuilder.pairingURL(hostname: ""), "https://tesla.com/_ak/yourapp.example.com")
    }

    func testOutcomeResolution() {
        XCTAssertEqual(FleetApiBuilder.outcome(from: .object(["error": .string("boom")])), .failure("boom"))
        if case .success = FleetApiBuilder.outcome(from: .object(["ok": .bool(true)])) {} else {
            XCTFail("expected success")
        }
    }
}

// MARK: - Onboarding + phase + freshness + formatters

final class FleetApiStateTests: XCTestCase {
    func testOnboardingProgressAndAutoDetect() {
        let steps = FleetApiContent.onboardingSteps()
        let progress = FleetApiBuilder.onboardingProgress(steps: steps, completed: ["account": true, "auth": true])
        XCTAssertEqual(progress.completed, 2)
        XCTAssertEqual(progress.total, 7)
        XCTAssertEqual(Int(progress.percent.rounded()), 29)
        let auto = FleetApiBuilder.autoDetectCompleted(["account": true], configured: true, authenticated: true)
        XCTAssertEqual(auto["keypair"], true)
        XCTAssertEqual(auto["auth"], true)
        XCTAssertEqual(auto["account"], true)
    }

    func testTelemetryErrorsPhaseBranches() {
        XCTAssertEqual(FleetApiBuilder.telemetryErrorsPhase(from: .idle(messageKey: "", fallback: "")), .idle)
        XCTAssertEqual(FleetApiBuilder.telemetryErrorsPhase(from: .loading), .loading)
        XCTAssertEqual(FleetApiBuilder.telemetryErrorsPhase(from: .failure("x")), .failed("x"))
        let table = FleetApiBuilder.telemetryErrorsPhase(
            from: .success(.object(["errors": .array([.object(["code": .string("E")])])]))
        )
        if case let .table(rows) = table { XCTAssertEqual(rows.count, 1) } else { XCTFail("expected table") }
        let healthy = FleetApiBuilder.telemetryErrorsPhase(from: .success(.object(["errors": .array([])])))
        XCTAssertEqual(healthy, .empty(ok: true, raw: nil))
        let drift = FleetApiBuilder.telemetryErrorsPhase(from: .success(.object(["weird": .string("x")])))
        if case let .empty(ok, raw) = drift { XCTAssertFalse(ok); XCTAssertNotNil(raw) } else { XCTFail("drift") }
    }

    func testSectionPhaseResolution() {
        XCTAssertEqual(
            FleetApiBuilder.resolveSectionPhase(fleetInfo: .loading, publicKeyStatus: .loading, hasVehicles: false),
            .loading
        )
        XCTAssertEqual(
            FleetApiBuilder.resolveSectionPhase(
                fleetInfo: .failed("x"), publicKeyStatus: .failed("y"), hasVehicles: false
            ),
            .error("x")
        )
        XCTAssertEqual(
            FleetApiBuilder.resolveSectionPhase(
                fleetInfo: .loaded(.object([:])), publicKeyStatus: .loaded(.object([:])), hasVehicles: false
            ),
            .empty
        )
        XCTAssertEqual(
            FleetApiBuilder.resolveSectionPhase(
                fleetInfo: .loaded(.object(["baseUrl": .string("u")])), publicKeyStatus: .loading, hasVehicles: false
            ),
            .content
        )
    }

    func testFreshnessPrecedence() {
        XCTAssertEqual(
            FleetApiBuilder.resolveFreshness(connection: .offline, isFetching: true, isError: true),
            .offline
        )
        XCTAssertEqual(FleetApiBuilder.resolveFreshness(connection: .live, isFetching: true, isError: true), .error)
        XCTAssertEqual(FleetApiBuilder.resolveFreshness(connection: .live, isFetching: true, isError: false), .fetching)
        XCTAssertEqual(FleetApiBuilder.resolveFreshness(connection: .stale, isFetching: false, isError: false), .stale)
        XCTAssertEqual(FleetApiBuilder.resolveFreshness(connection: .live, isFetching: false, isError: false), .fresh)
    }

    func testFormatters() {
        XCTAssertEqual(FleetApiBuilder.formatNumber(42.0), "42")
        XCTAssertEqual(FleetApiBuilder.formatInt(0), "0")
        XCTAssertTrue(FleetApiBuilder.formatInt(1_234_567).contains("567"))
        XCTAssertEqual(FleetApiBuilder.formatDateTime(""), "—")
        XCTAssertEqual(FleetApiBuilder.formatDateTime("not-a-date"), "not-a-date")
        let now = Date()
        XCTAssertTrue(FleetApiBuilder.relativeTime(since: now, now: now).contains("just"))
        XCTAssertTrue(FleetApiBuilder.relativeTime(since: now.addingTimeInterval(-120), now: now).contains("2m"))
    }

    func testPrettyJSONSortsKeysAndIndents() {
        let json = FleetApiBuilder.prettyJSON(.object(["b": .number(2), "a": .string("x")]))
        XCTAssertEqual(json, "{\n  \"a\": \"x\",\n  \"b\": 2\n}")
        XCTAssertEqual(FleetApiBuilder.prettyJSON(.object([:])), "{}")
        XCTAssertEqual(FleetApiBuilder.prettyJSON(.array([])), "[]")
    }
}

// MARK: - Canonical catalogs + a11y

final class FleetApiCatalogTests: XCTestCase {
    func testOnboardingStepCatalog() {
        let steps = FleetApiContent.onboardingSteps()
        XCTAssertEqual(steps.count, 7)
        XCTAssertEqual(steps.map(\.id), ["account", "application", "keypair", "register", "auth", "pair", "telemetry"])
    }

    func testTelemetryFieldCatalogMatchesWebShape() {
        XCTAssertEqual(FleetTelemetryFields.categories.count, 12)
        let total = FleetTelemetryFields.categories.reduce(0) { $0 + $1.fields.count }
        XCTAssertEqual(total, 230)
        XCTAssertEqual(FleetTelemetryFields.categories.first?.name, "Location")
    }

    func testTelemetryFieldFilter() {
        let charging = FleetTelemetryFields.filtered("charge")
        XCTAssertFalse(charging.isEmpty)
        XCTAssertTrue(charging.allSatisfy { category in
            category.fields.allSatisfy { $0.lowercased().contains("charge") }
        })
        XCTAssertEqual(FleetTelemetryFields.filtered("   ").count, 12)
    }

    func testAccessibilityCopy() {
        let progress = OnboardingProgress(completed: 3, total: 7)
        XCTAssertTrue(FleetApiAccessibility.progressLabel(progress).contains("3"))
        XCTAssertEqual(FleetApiAccessibility.freshnessLabel(.offline), "Offline")
        XCTAssertEqual(FleetApiAccessibility.freshnessLabel(.fresh), "Live")
        let row = TelemetryErrorRow(rowKey: "k", timestamp: "", code: "E9", message: "boom")
        let label = FleetApiAccessibility.errorRowLabel(row)
        XCTAssertTrue(label.contains("E9"))
        XCTAssertTrue(label.contains("boom"))
    }
}

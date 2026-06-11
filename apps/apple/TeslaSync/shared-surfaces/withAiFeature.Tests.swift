//
//  withAiFeature.Tests.swift
//  TeslaSync — P4 shared surface · 0062 · withAiFeature (Apple)
//
//  Pure-core coverage for the withAiFeature surface (the model + view-composition half lives in
//  withAiFeature.ModelTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • Gate — the verbatim port of `useAiEnabled(feature)`: the fail-closed truth table (enabled only
//      when the id is registered + settings resolved + mode≠off + per-feature flag exactly true;
//      unknown-feature / unresolved / failed / mode-off / mode-missing / flag-off all withdraw the
//      surface) + the boolean parity.
//    • Registry guard — `isKnown` over the canonical registry + the construction-time `validate`
//      throw (the native peer of the web HOC's unknown-id throw).
//    • Marker — the `data-testid` identifier (default `ai-feature-<id>` + explicit override) and the
//      `displayName` parity.
//    • Projection — every verdict maps to presented / withdrawn, with the connection + marker carried.
//    • Meta — the diagnostics slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Gate (web `useAiEnabled(feature)` truth table)

final class WithAiFeatureGateTests: XCTestCase {
    private let knownFeature = "chatbot-llm"

    private func input(
        _ status: AiFeatureGateSettingsStatus,
        feature: String = "chatbot-llm",
        mode: AiFeatureGateMode? = nil,
        flag: Bool = false
    ) -> AiFeatureGateInput {
        AiFeatureGateInput(featureID: feature, status: status, mode: mode, featureEnabled: flag)
    }

    func testEnabledWhenFullyOn() {
        XCTAssertEqual(AiFeatureGate.evaluate(input(.resolved, mode: .local, flag: true)), .enabled)
        XCTAssertEqual(AiFeatureGate.evaluate(input(.resolved, mode: .cloud, flag: true)), .enabled)
        XCTAssertTrue(AiFeatureGate.isEnabled(input(.resolved, mode: .local, flag: true)))
    }

    func testUnknownFeatureFailsClosed() {
        let unknown = input(.resolved, feature: "not-a-real-feature", mode: .local, flag: true)
        XCTAssertEqual(AiFeatureGate.evaluate(unknown), .unknownFeature)
        XCTAssertFalse(AiFeatureGate.isEnabled(unknown))
    }

    func testUnresolvedFailsClosed() {
        XCTAssertEqual(AiFeatureGate.evaluate(input(.loading, mode: .local, flag: true)), .unresolved)
        XCTAssertFalse(AiFeatureGate.isEnabled(input(.loading, mode: .local, flag: true)))
    }

    func testFailedFailsClosed() {
        XCTAssertEqual(AiFeatureGate.evaluate(input(.failed, mode: .local, flag: true)), .failed)
        XCTAssertFalse(AiFeatureGate.isEnabled(input(.failed, mode: .local, flag: true)))
    }

    func testModeOffFailsClosed() {
        XCTAssertEqual(AiFeatureGate.evaluate(input(.resolved, mode: .off, flag: true)), .disabled)
        XCTAssertFalse(AiFeatureGate.isEnabled(input(.resolved, mode: .off, flag: true)))
    }

    func testMissingModeFailsClosed() {
        XCTAssertEqual(AiFeatureGate.evaluate(input(.resolved, mode: nil, flag: true)), .disabled)
        XCTAssertFalse(AiFeatureGate.isEnabled(input(.resolved, mode: nil, flag: true)))
    }

    func testFlagOffFailsClosed() {
        XCTAssertEqual(AiFeatureGate.evaluate(input(.resolved, mode: .local, flag: false)), .disabled)
        XCTAssertFalse(AiFeatureGate.isEnabled(input(.resolved, mode: .local, flag: false)))
    }

    func testIsPresentedOnlyForEnabled() {
        XCTAssertTrue(AiFeatureGate.enabled.isPresented)
        XCTAssertFalse(AiFeatureGate.disabled.isPresented)
        XCTAssertFalse(AiFeatureGate.unresolved.isPresented)
        XCTAssertFalse(AiFeatureGate.failed.isPresented)
        XCTAssertFalse(AiFeatureGate.unknownFeature.isPresented)
    }

    func testKnownFeatureIsRegistered() {
        XCTAssertTrue(AiFeatureRegistryGuard.isKnown(knownFeature))
    }
}

// MARK: - Registry guard (web `AI_FEATURES[feature]` + the HOC construction-time throw)

final class WithAiFeatureRegistryGuardTests: XCTestCase {
    func testKnownIdsAreRegistered() {
        for id in ["chatbot-llm", "cost-forecast-narration", "cross-rule-conflict-detection", "yir-narration"] {
            XCTAssertTrue(AiFeatureRegistryGuard.isKnown(id), "expected \(id) to be registered")
        }
    }

    func testUnknownIdIsNotRegistered() {
        XCTAssertFalse(AiFeatureRegistryGuard.isKnown("not-a-real-feature"))
        XCTAssertFalse(AiFeatureRegistryGuard.isKnown(""))
    }

    func testValidateThrowsForUnknownId() {
        XCTAssertThrowsError(try AiFeatureRegistryGuard.validate("not-a-real-feature")) { error in
            XCTAssertEqual(error as? AiFeatureGateError, .unknownFeature("not-a-real-feature"))
        }
    }

    func testValidateDoesNotThrowForKnownId() {
        XCTAssertNoThrow(try AiFeatureRegistryGuard.validate("chatbot-llm"))
    }
}

// MARK: - Marker (web `data-testid` + `displayName`)

final class WithAiFeatureMarkerTests: XCTestCase {
    func testIdentifierDefaultsToWebFallback() {
        XCTAssertEqual(AiFeatureMarker.identifier(feature: "chatbot-llm"), "ai-feature-chatbot-llm")
    }

    func testIdentifierHonoursExplicitTestID() {
        XCTAssertEqual(
            AiFeatureMarker.identifier(feature: "chatbot-llm", testID: "ai-feature-chatbot-llm-root"),
            "ai-feature-chatbot-llm-root"
        )
    }

    func testDisplayNameMatchesWebSource() {
        XCTAssertEqual(
            AiFeatureMarker.displayName(feature: "chatbot-llm", inner: "Inner"),
            "withAiFeature(chatbot-llm, Inner)"
        )
    }
}

// MARK: - Projection (render branches)

final class WithAiFeatureProjectionTests: XCTestCase {
    private func input(
        _ status: AiFeatureGateSettingsStatus,
        feature: String = "chatbot-llm",
        mode: AiFeatureGateMode? = nil,
        flag: Bool = false,
        connection: AiFeatureGateConnection = .live
    ) -> AiFeatureGateInput {
        AiFeatureGateInput(
            featureID: feature,
            status: status,
            mode: mode,
            featureEnabled: flag,
            connection: connection
        )
    }

    func testPresentedWhenEnabled() {
        let resolved = AiFeatureGateProjection.resolve(input(.resolved, mode: .local, flag: true))
        XCTAssertEqual(resolved.outcome, .presented)
        XCTAssertTrue(resolved.isPresented)
        XCTAssertEqual(resolved.gate, .enabled)
        XCTAssertEqual(resolved.markerIdentifier, "ai-feature-chatbot-llm")
    }

    func testWithdrawnForEveryFailClosedVerdict() {
        let cases: [(AiFeatureGateInput, AiFeatureGate)] = [
            (input(.resolved, feature: "not-a-real-feature", mode: .local, flag: true), .unknownFeature),
            (input(.loading, mode: .local, flag: true), .unresolved),
            (input(.failed, mode: .local, flag: true), .failed),
            (input(.resolved, mode: .off, flag: true), .disabled),
            (input(.resolved, mode: .local, flag: false), .disabled)
        ]
        for (snapshot, expectedGate) in cases {
            let resolved = AiFeatureGateProjection.resolve(snapshot)
            XCTAssertEqual(resolved.outcome, .withdrawn, "expected withdrawn for \(expectedGate)")
            XCTAssertFalse(resolved.isPresented)
            XCTAssertEqual(resolved.gate, expectedGate)
        }
    }

    func testConnectionIsCarried() {
        for connection in AiFeatureGateConnection.allCases {
            let resolved = AiFeatureGateProjection.resolve(
                input(.resolved, mode: .local, flag: true, connection: connection)
            )
            XCTAssertEqual(resolved.connection, connection)
        }
    }

    func testMarkerOverrideIsCarried() {
        let resolved = AiFeatureGateProjection.resolve(
            input(.resolved, mode: .local, flag: true),
            testID: "ai-feature-chatbot-llm-root"
        )
        XCTAssertEqual(resolved.markerIdentifier, "ai-feature-chatbot-llm-root")
    }
}

// MARK: - Meta (diagnostics slug)

final class WithAiFeatureMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(AiFeatureGateSurface.slug, "withAiFeature")
        XCTAssertEqual(WithAiFeature<EmptyView>.surfaceSlug, "withAiFeature")
    }
}

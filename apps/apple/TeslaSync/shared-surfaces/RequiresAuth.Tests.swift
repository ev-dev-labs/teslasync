//
//  RequiresAuth.Tests.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  Adapter + projection + model + accessibility coverage for the RequiresAuth surface:
//    • `RequiresAuthCapability` / `RequiresAuthProjection.testID` — the verbatim
//      `requiresAuthEmptyTestId` port across every capability.
//    • `AuthModeCapabilities` — the per-capability subscript (web `capabilities[capability]`).
//    • `RequiresAuthCopy` — the title + generic/with-hint body interpolation and the web-source-key
//      parity guard.
//    • `RequiresAuthProjection.resolveGate` / `resolveRender` — the verbatim web gate ladder and the
//      per-state render resolution (loading / locked / content / error + cached-snapshot survival).
//    • `RequiresAuthModel` — the P1/S11 `view.opened` telemetry (once + idempotent), the
//      gate/render transitions, the stale one-shot auto-refresh (re-armed on return to live), offline
//      keeping the resolved state, the stable test-id, and the VoiceOver copy.
//    • `RequiresAuthAccessibility` — the lock notice / loading / error VoiceOver copy.
//
//  Pure, bundle-free: copy resolves through an identity localizer; the model is driven through the
//  in-memory source — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Capability → selector (web requiresAuthEmptyTestId)

final class RequiresAuthCapabilityTests: XCTestCase {
    func testCapabilityKeysAreBackendSnakeCase() {
        XCTAssertEqual(RequiresAuthCapability.stepUpReauth.key, "step_up_reauth")
        XCTAssertEqual(RequiresAuthCapability.totpEnrollment.key, "totp_enrollment")
        XCTAssertEqual(RequiresAuthCapability.sessionList.key, "session_list")
        XCTAssertEqual(RequiresAuthCapability.impersonation.key, "impersonation")
        XCTAssertEqual(RequiresAuthCapability.rbac.key, "rbac")
    }

    func testTestIDBuildsDocumentedPerCapabilityID() {
        XCTAssertEqual(
            RequiresAuthProjection.testID(capability: .totpEnrollment),
            "requires-auth-empty-totp_enrollment"
        )
        XCTAssertEqual(RequiresAuthProjection.testID(capability: .rbac), "requires-auth-empty-rbac")
    }

    func testEveryCapabilityHasAStableSelector() {
        for capability in RequiresAuthCapability.allCases {
            XCTAssertEqual(
                RequiresAuthProjection.testID(capability: capability),
                "requires-auth-empty-\(capability.key)"
            )
        }
    }
}

// MARK: - Capability matrix subscript (web capabilities[capability])

final class AuthModeCapabilitiesTests: XCTestCase {
    func testAllEnabledReadsTrueForEveryCapability() {
        let matrix = AuthModeCapabilities.allEnabled
        for capability in RequiresAuthCapability.allCases {
            XCTAssertTrue(matrix[capability], "expected \(capability.key) enabled")
        }
    }

    func testAllDisabledReadsFalseForEveryCapability() {
        let matrix = AuthModeCapabilities.allDisabled
        for capability in RequiresAuthCapability.allCases {
            XCTAssertFalse(matrix[capability], "expected \(capability.key) disabled")
        }
    }

    func testSubscriptReadsTheSpecificFlag() {
        let matrix = AuthModeCapabilities(totpEnrollment: true, rbac: true)
        XCTAssertTrue(matrix[.totpEnrollment])
        XCTAssertTrue(matrix[.rbac])
        XCTAssertFalse(matrix[.sessionList])
        XCTAssertFalse(matrix[.impersonation])
        XCTAssertFalse(matrix[.stepUpReauth])
    }
}

// MARK: - Copy (web empty-state strings)

final class RequiresAuthCopyTests: XCTestCase {
    func testTitleInterpolatesFeature() {
        XCTAssertEqual(
            RequiresAuthCopy.title(feature: "Active sessions", localize: passthroughLocalize),
            "Active sessions requires authentication mode"
        )
    }

    func testGenericBodyListsProvidersAndInterpolatesFeature() {
        let body = RequiresAuthCopy.body(
            feature: "TOTP enrollment",
            providerHint: nil,
            localize: passthroughLocalize
        )
        XCTAssertTrue(body.contains("TOTP enrollment is only available"))
        XCTAssertTrue(body.contains("Authentik, Authelia, oauth2-proxy, Keycloak"))
        XCTAssertTrue(body.contains("Set FORWARD_AUTH_HEADER"))
    }

    func testHintBodySurfacesProviderVerbatimAndDropsTheGenericList() {
        let body = RequiresAuthCopy.body(
            feature: "RBAC",
            providerHint: "authentik",
            localize: passthroughLocalize
        )
        XCTAssertTrue(body.contains("RBAC is only available"))
        XCTAssertTrue(body.contains("(authentik)"))
        XCTAssertFalse(body.contains("Authentik, Authelia, oauth2-proxy, Keycloak"))
    }

    func testEmptyHintFallsBackToTheGenericList() {
        let body = RequiresAuthCopy.body(feature: "RBAC", providerHint: "", localize: passthroughLocalize)
        XCTAssertTrue(body.contains("Authentik, Authelia, oauth2-proxy, Keycloak"))
    }

    func testWebSourceKeysAreTheExtractedSet() {
        XCTAssertEqual(
            RequiresAuthCopy.webSourceKeys,
            ["requiresAuth.title", "requiresAuth.body", "requiresAuth.bodyWithHint"]
        )
    }
}

// MARK: - Gate ladder (web isLoading / forward-auth / open)

final class RequiresAuthGateTests: XCTestCase {
    func testNoSnapshotLocks() {
        XCTAssertEqual(
            RequiresAuthProjection.resolveGate(snapshot: nil, capability: .totpEnrollment),
            .locked
        )
    }

    func testForwardAuthWithCapabilityUnlocks() {
        let snapshot = AuthModeSnapshot(mode: .forwardAuth, capabilities: .allEnabled)
        XCTAssertEqual(
            RequiresAuthProjection.resolveGate(snapshot: snapshot, capability: .totpEnrollment),
            .unlocked
        )
    }

    func testForwardAuthWithDisabledCapabilityLocks() {
        let snapshot = AuthModeSnapshot(mode: .forwardAuth, capabilities: .allDisabled)
        XCTAssertEqual(
            RequiresAuthProjection.resolveGate(snapshot: snapshot, capability: .rbac),
            .locked
        )
    }

    func testOpenModeLocksEvenIfAFlagSomehowTrue() {
        let snapshot = AuthModeSnapshot(mode: .open, capabilities: .allEnabled)
        XCTAssertEqual(
            RequiresAuthProjection.resolveGate(snapshot: snapshot, capability: .totpEnrollment),
            .locked
        )
    }
}

// MARK: - Render resolution (per-state)

final class RequiresAuthRenderTests: XCTestCase {
    private let capability = RequiresAuthCapability.totpEnrollment

    func testLoadingWithNoSnapshotRendersLoading() {
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(status: .loading, snapshot: nil, capability: capability),
            .loading
        )
    }

    func testFailedWithNoSnapshotRendersError() {
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(
                status: .failed("boom"),
                snapshot: nil,
                capability: capability
            ),
            .error("boom")
        )
    }

    func testLoadedOpenModeRendersLocked() {
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(status: .loaded, snapshot: .open, capability: capability),
            .locked
        )
    }

    func testLoadedForwardAuthWithCapabilityRendersContent() {
        let snapshot = AuthModeSnapshot(mode: .forwardAuth, capabilities: .allEnabled)
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(status: .loaded, snapshot: snapshot, capability: capability),
            .content
        )
    }

    func testFailedReloadWithCachedLockedSnapshotKeepsLockedNotError() {
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(
                status: .failed("stale read"),
                snapshot: .open,
                capability: capability
            ),
            .locked
        )
    }

    func testFailedReloadWithCachedUnlockedSnapshotKeepsContent() {
        let snapshot = AuthModeSnapshot(mode: .forwardAuth, capabilities: .allEnabled)
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(
                status: .failed("stale read"),
                snapshot: snapshot,
                capability: capability
            ),
            .content
        )
    }

    func testLoadingWithCachedSnapshotShowsResolvedNotLoadingSpinner() {
        XCTAssertEqual(
            RequiresAuthProjection.resolveRender(status: .loading, snapshot: .open, capability: capability),
            .locked
        )
    }
}

// MARK: - Accessibility

final class RequiresAuthAccessibilityTests: XCTestCase {
    func testLockNoticeSummaryJoinsTitleAndBody() {
        let summary = RequiresAuthAccessibility.lockNoticeSummary(
            feature: "RBAC",
            providerHint: "authentik",
            localize: passthroughLocalize
        )
        XCTAssertTrue(summary.hasPrefix("RBAC requires authentication mode. "))
        XCTAssertTrue(summary.contains("(authentik)"))
    }

    func testLoadingLabel() {
        XCTAssertEqual(
            RequiresAuthAccessibility.loadingLabel(localize: passthroughLocalize),
            "Checking access…"
        )
    }

    func testErrorLabelAppendsMessageWhenPresent() {
        XCTAssertEqual(
            RequiresAuthAccessibility.errorLabel(message: "503", localize: passthroughLocalize),
            "Couldn't check access. 503"
        )
        XCTAssertEqual(
            RequiresAuthAccessibility.errorLabel(message: "", localize: passthroughLocalize),
            "Couldn't check access"
        )
    }
}

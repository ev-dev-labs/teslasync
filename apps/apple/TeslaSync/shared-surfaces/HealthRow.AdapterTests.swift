//
//  HealthRow.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  Pure-core coverage for the single-line health summary row (the model + view-composition half lives
//  in HealthRow.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is
//  the "adapter (cached → projection)" unit test the acceptance calls for: it drives the structural
//  props through ``HealthRowProjector`` and asserts the verbatim port of the web `HealthRow` render
//  body, plus the value types it is built on:
//    • status  — raw values, all cases (web `'healthy' | … | 'maintenance'`).
//    • kind    — none / link / externalLink / action (web `to` / `external` / `onClick`).
//    • inputs  — value equality (the `.onChange` key) across every field.
//    • slug    — the diagnostics identity.
//    • project — status/label/summary passthrough, icon presence, navigable, chevron, href handling,
//                external flag, a11y traits.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - HealthRowSurface (diagnostics identity)

final class HealthRowSurfaceTests: XCTestCase {
    func testSlug() {
        XCTAssertEqual(HealthRowSurface.slug, "HealthRow")
    }
}

// MARK: - HealthRowStatus (web HeroStatus union)

final class HealthRowStatusTests: XCTestCase {
    func testRawValuesMatchWebUnion() {
        XCTAssertEqual(HealthRowStatus.healthy.rawValue, "healthy")
        XCTAssertEqual(HealthRowStatus.degraded.rawValue, "degraded")
        XCTAssertEqual(HealthRowStatus.unhealthy.rawValue, "unhealthy")
        XCTAssertEqual(HealthRowStatus.unknown.rawValue, "unknown")
        XCTAssertEqual(HealthRowStatus.maintenance.rawValue, "maintenance")
    }

    func testAllCases() {
        XCTAssertEqual(
            Set(HealthRowStatus.allCases),
            [.healthy, .degraded, .unhealthy, .unknown, .maintenance]
        )
    }
}

// MARK: - HealthRowActivationKind (web to / external / onClick / neither)

final class HealthRowActivationKindTests: XCTestCase {
    func testRawValues() {
        XCTAssertEqual(HealthRowActivationKind.none.rawValue, "none")
        XCTAssertEqual(HealthRowActivationKind.link.rawValue, "link")
        XCTAssertEqual(HealthRowActivationKind.externalLink.rawValue, "externalLink")
        XCTAssertEqual(HealthRowActivationKind.action.rawValue, "action")
    }

    func testAllCases() {
        XCTAssertEqual(
            Set(HealthRowActivationKind.allCases),
            [.none, .link, .externalLink, .action]
        )
    }
}

// MARK: - HealthRowInputs (the `.onChange` key)

final class HealthRowInputsTests: XCTestCase {
    func testDefaults() {
        let inputs = HealthRowInputs(status: .healthy, label: "Vehicles", summary: "12 / 12 healthy")
        XCTAssertEqual(inputs.status, .healthy)
        XCTAssertEqual(inputs.label, "Vehicles")
        XCTAssertEqual(inputs.summary, "12 / 12 healthy")
        XCTAssertFalse(inputs.hasIcon)
        XCTAssertEqual(inputs.activationKind, .none)
        XCTAssertNil(inputs.href)
    }

    func testEquality() {
        let base = HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "3 lagging",
            hasIcon: true, activationKind: .link, href: "/telemetry"
        )
        XCTAssertEqual(base, HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "3 lagging",
            hasIcon: true, activationKind: .link, href: "/telemetry"
        ))
    }

    func testEveryFieldParticipatesInEquality() {
        let base = HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "3 lagging",
            hasIcon: true, activationKind: .link, href: "/telemetry"
        )
        XCTAssertNotEqual(base, HealthRowInputs(
            status: .healthy, label: "Telemetry", summary: "3 lagging",
            hasIcon: true, activationKind: .link, href: "/telemetry"
        ))
        XCTAssertNotEqual(base, HealthRowInputs(
            status: .degraded, label: "Other", summary: "3 lagging",
            hasIcon: true, activationKind: .link, href: "/telemetry"
        ))
        XCTAssertNotEqual(base, HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "ok",
            hasIcon: true, activationKind: .link, href: "/telemetry"
        ))
        XCTAssertNotEqual(base, HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "3 lagging",
            hasIcon: false, activationKind: .link, href: "/telemetry"
        ))
        XCTAssertNotEqual(base, HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "3 lagging",
            hasIcon: true, activationKind: .action, href: "/telemetry"
        ))
        XCTAssertNotEqual(base, HealthRowInputs(
            status: .degraded, label: "Telemetry", summary: "3 lagging",
            hasIcon: true, activationKind: .link, href: "/other"
        ))
    }
}

// MARK: - HealthRowProjector (web `HealthRow` render body)

final class HealthRowProjectorTests: XCTestCase {
    private func make(
        status: HealthRowStatus = .healthy,
        label: String = "Vehicles",
        summary: String = "12 / 12 healthy",
        hasIcon: Bool = false,
        activationKind: HealthRowActivationKind = .none,
        href: String? = nil
    ) -> HealthRowProjection {
        HealthRowProjector.resolve(inputs: HealthRowInputs(
            status: status, label: label, summary: summary,
            hasIcon: hasIcon, activationKind: activationKind, href: href
        ))
    }

    func testInertRowPassesThroughAndHidesAffordances() {
        let projection = make(status: .unknown, label: "Uptime", summary: "—")
        XCTAssertEqual(projection.status, .unknown)
        XCTAssertEqual(projection.label, "Uptime")
        XCTAssertEqual(projection.summary, "—")
        XCTAssertFalse(projection.showsIcon)
        XCTAssertFalse(projection.isNavigable)
        XCTAssertEqual(projection.activationKind, .none)
        XCTAssertNil(projection.href)
        XCTAssertFalse(projection.opensExternally)
        XCTAssertFalse(projection.showsChevron, "web renders the chevron only when to || onClick")
        XCTAssertFalse(projection.accessibilityIsLink)
        XCTAssertFalse(projection.accessibilityIsButton)
    }

    func testIconPresenceDrivesRenderFlag() {
        XCTAssertTrue(make(hasIcon: true).showsIcon)
        XCTAssertFalse(make(hasIcon: false).showsIcon)
    }

    func testEveryStatusPassesThrough() {
        for status in HealthRowStatus.allCases {
            XCTAssertEqual(make(status: status).status, status)
        }
    }

    func testInternalLinkIsLinkTraitChevronAndCarriesHref() {
        let projection = make(activationKind: .link, href: "/vehicles")
        XCTAssertTrue(projection.isNavigable)
        XCTAssertTrue(projection.showsChevron)
        XCTAssertEqual(projection.href, "/vehicles")
        XCTAssertFalse(projection.opensExternally)
        XCTAssertTrue(projection.accessibilityIsLink)
        XCTAssertFalse(projection.accessibilityIsButton)
    }

    func testExternalLinkIsLinkTraitAndOpensExternally() {
        let projection = make(activationKind: .externalLink, href: "https://status.example.com")
        XCTAssertTrue(projection.isNavigable)
        XCTAssertTrue(projection.showsChevron)
        XCTAssertEqual(projection.href, "https://status.example.com")
        XCTAssertTrue(projection.opensExternally)
        XCTAssertTrue(projection.accessibilityIsLink)
        XCTAssertFalse(projection.accessibilityIsButton)
    }

    func testActionIsButtonTraitAndDropsHref() {
        let projection = make(activationKind: .action, href: "/ignored")
        XCTAssertTrue(projection.isNavigable)
        XCTAssertTrue(projection.showsChevron)
        XCTAssertNil(projection.href, "href is only meaningful for the link kinds")
        XCTAssertFalse(projection.opensExternally)
        XCTAssertFalse(projection.accessibilityIsLink)
        XCTAssertTrue(projection.accessibilityIsButton)
    }

    func testProjectionIsEquatableForIdenticalInputs() {
        let inputs = HealthRowInputs(
            status: .maintenance, label: "Database", summary: "window",
            hasIcon: true, activationKind: .link, href: "/system"
        )
        XCTAssertEqual(
            HealthRowProjector.resolve(inputs: inputs),
            HealthRowProjector.resolve(inputs: inputs)
        )
    }
}

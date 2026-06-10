//
//  ScheduledExportsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  Adapter + accessibility coverage for the ScheduledExportsPanel surface:
//    • `ScheduledExportsProjection` — phase resolution across loading / loaded / failed ×
//      empty / populated (cached rows survive a failed reload).
//    • `ScheduledExportFormState` — the `empty()` / `from(_:)` seeds, the
//      delivery-target requirement, the `isSubmittable` predicate, and the submit-time
//      delivery normalisation (drop target for download, trim otherwise).
//    • `ScheduledExportItem` — the web "Type" + "Delivery" cell rendering.
//    • `ScheduledExportsAccessibility` — the section summary + row VoiceOver content.
//
//  The state-holder coverage lives in ScheduledExportsPanel.ModelTests.swift. Pure,
//  bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real
/// copy without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum ScheduledExportsPanelSampleSchedules {
    static func drives(
        id: Int = 1,
        enabled: Bool = true,
        delivery: ScheduledExportDelivery = ScheduledExportDelivery(kind: .download),
        lastRunAt: Date? = nil,
        lastStatus: ScheduledExportRunStatus? = nil,
        nextRunAt: Date? = Date(timeIntervalSince1970: 1_717_000_000)
    ) -> ScheduledExportItem {
        ScheduledExportItem(
            id: id,
            name: "Drives weekly",
            exportType: .drives,
            format: .csv,
            scheduleCron: "0 9 * * 0",
            delivery: delivery,
            rangeWindow: "7d",
            enabled: enabled,
            lastRunAt: lastRunAt,
            lastStatus: lastStatus,
            nextRunAt: nextRunAt
        )
    }

    static func emailWebhook(id: Int = 2) -> ScheduledExportItem {
        ScheduledExportItem(
            id: id,
            name: "Charging email",
            exportType: .charging,
            format: .json,
            vehicleID: 7,
            columns: ["start", "end"],
            scheduleCron: "0 0 * * *",
            delivery: ScheduledExportDelivery(kind: .email, target: "you@example.com"),
            rangeWindow: "24h",
            enabled: false,
            lastRunAt: Date(timeIntervalSince1970: 1_716_000_000),
            lastStatus: .failed,
            nextRunAt: nil
        )
    }
}

// MARK: - Projection (phase)

final class ScheduledExportsProjectionTests: XCTestCase {
    func testLoadingResolvesByRowPresence() {
        XCTAssertEqual(
            ScheduledExportsProjection.resolvePhase(status: .loading, rowCount: 0),
            .loading
        )
        XCTAssertEqual(
            ScheduledExportsProjection.resolvePhase(status: .loading, rowCount: 3),
            .content
        )
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(
            ScheduledExportsProjection.resolvePhase(status: .loaded, rowCount: 0),
            .empty
        )
        XCTAssertEqual(
            ScheduledExportsProjection.resolvePhase(status: .loaded, rowCount: 2),
            .content
        )
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            ScheduledExportsProjection.resolvePhase(status: .failed("boom"), rowCount: 0),
            .error("boom")
        )
        XCTAssertEqual(
            ScheduledExportsProjection.resolvePhase(status: .failed("boom"), rowCount: 1),
            .content
        )
    }
}

// MARK: - Form state

final class ScheduledExportFormStateTests: XCTestCase {
    func testEmptySeedMatchesWebDefaults() {
        let form = ScheduledExportFormState.empty()
        XCTAssertEqual(form.name, "")
        XCTAssertEqual(form.exportType, .drives)
        XCTAssertEqual(form.format, .csv)
        XCTAssertEqual(form.scheduleCron, "0 9 * * 0")
        XCTAssertEqual(form.deliveryKind, .download)
        XCTAssertEqual(form.deliveryTarget, "")
        XCTAssertEqual(form.rangeWindow, "7d")
        XCTAssertTrue(form.enabled)
    }

    func testFromRowSeedsEveryField() {
        let form = ScheduledExportFormState.from(ScheduledExportsPanelSampleSchedules.emailWebhook())
        XCTAssertEqual(form.name, "Charging email")
        XCTAssertEqual(form.exportType, .charging)
        XCTAssertEqual(form.format, .json)
        XCTAssertEqual(form.vehicleID, 7)
        XCTAssertEqual(form.columns, ["start", "end"])
        XCTAssertEqual(form.scheduleCron, "0 0 * * *")
        XCTAssertEqual(form.deliveryKind, .email)
        XCTAssertEqual(form.deliveryTarget, "you@example.com")
        XCTAssertEqual(form.rangeWindow, "24h")
        XCTAssertFalse(form.enabled)
    }

    func testRequiresDeliveryTargetByKind() {
        var form = ScheduledExportFormState.empty()
        form.deliveryKind = .download
        XCTAssertFalse(form.requiresDeliveryTarget)
        form.deliveryKind = .email
        XCTAssertTrue(form.requiresDeliveryTarget)
        form.deliveryKind = .webhook
        XCTAssertTrue(form.requiresDeliveryTarget)
    }

    func testIsSubmittableRequiresNameAndCron() {
        var form = ScheduledExportFormState.empty()
        form.name = ""
        XCTAssertFalse(form.isSubmittable)
        form.name = "Weekly"
        XCTAssertTrue(form.isSubmittable)
        form.scheduleCron = "   "
        XCTAssertFalse(form.isSubmittable)
    }

    func testIsSubmittableRequiresTargetForNonDownload() {
        var form = ScheduledExportFormState.empty()
        form.name = "Weekly"
        form.deliveryKind = .webhook
        form.deliveryTarget = ""
        XCTAssertFalse(form.isSubmittable)
        form.deliveryTarget = "https://example.com/hook"
        XCTAssertTrue(form.isSubmittable)
    }

    func testNormalizedDeliveryDropsTargetForDownload() {
        var form = ScheduledExportFormState.empty()
        form.deliveryKind = .download
        form.deliveryTarget = "leftover@example.com"
        let delivery = form.normalizedDelivery()
        XCTAssertEqual(delivery.kind, .download)
        XCTAssertNil(delivery.target)
    }

    func testNormalizedDeliveryTrimsTargetOtherwise() {
        var form = ScheduledExportFormState.empty()
        form.deliveryKind = .email
        form.deliveryTarget = "  you@example.com  "
        let delivery = form.normalizedDelivery()
        XCTAssertEqual(delivery.kind, .email)
        XCTAssertEqual(delivery.target, "you@example.com")
    }
}

// MARK: - Item rendering

final class ScheduledExportItemTests: XCTestCase {
    func testTypeFormatLabel() {
        let label = ScheduledExportsPanelSampleSchedules.drives().typeFormatLabel(localize: passthroughLocalize)
        XCTAssertEqual(label, "drives (csv)")
    }

    func testDeliveryLabelWithoutTarget() {
        let item = ScheduledExportsPanelSampleSchedules.drives(delivery: ScheduledExportDelivery(kind: .download))
        XCTAssertEqual(item.deliveryLabel(localize: passthroughLocalize), "download")
    }

    func testDeliveryLabelWithTarget() {
        let item = ScheduledExportsPanelSampleSchedules.drives(
            delivery: ScheduledExportDelivery(kind: .webhook, target: "https://x/h")
        )
        XCTAssertEqual(item.deliveryLabel(localize: passthroughLocalize), "webhook → https://x/h")
    }

    func testDeliveryTargetSuffixIgnoresEmpty() {
        let delivery = ScheduledExportDelivery(kind: .email, target: "")
        XCTAssertNil(delivery.targetSuffix)
    }
}

// MARK: - Accessibility

final class ScheduledExportsAccessibilityTests: XCTestCase {
    func testSectionSummary() {
        let summary = ScheduledExportsAccessibility.sectionSummary(count: 4, localize: passthroughLocalize)
        XCTAssertEqual(summary, "Scheduled exports: 4")
    }

    func testRowLabelIncludesNameTypeCronDeliveryAndStatus() {
        let item = ScheduledExportsPanelSampleSchedules.emailWebhook()
        let label = ScheduledExportsAccessibility.rowLabel(
            item,
            dates: DefaultScheduledExportsDateFormatting(),
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("Charging email"))
        XCTAssertTrue(label.contains("charging (json)"))
        XCTAssertTrue(label.contains("Cron"))
        XCTAssertTrue(label.contains("email → you@example.com"))
        XCTAssertTrue(label.contains("Failed"))
        // Disabled schedules announce the "Enable" affordance.
        XCTAssertTrue(label.contains("Enable"))
    }

    func testRowLabelNeverRunReadsNever() {
        let label = ScheduledExportsAccessibility.rowLabel(
            ScheduledExportsPanelSampleSchedules.drives(lastRunAt: nil, lastStatus: nil),
            dates: DefaultScheduledExportsDateFormatting(),
            localize: passthroughLocalize
        )
        XCTAssertTrue(label.contains("Never"))
    }
}

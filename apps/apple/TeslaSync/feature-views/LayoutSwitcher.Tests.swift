//
//  LayoutSwitcher.Tests.swift
//  TeslaSync — P4 feature view · 0126 · LayoutSwitcher (Apple)
//
//  Unit coverage for the LayoutSwitcher surface: the Adapter projections (active
//  resolution, the per-vehicle visible filter, the row metadata, the active /
//  pinned labels, the save-as suggestion + `handleSaveAs` branch, the
//  `handlePinToggle` branch + its disabled rule), the reset-confirmation content,
//  the edit-toggle copy, the freshness chip, the VoiceOver summaries, the i18n key
//  parity (referenced == the web keys), and the P1/S11 `view.opened` telemetry. No
//  network, no real store, no rendering host — the pure projections are exercised
//  directly.
//
//  These run in the TeslaSync(/-macOS) XCTest targets.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum LayoutSwitcherFixture {
    /// A global (default) layout, a global non-default layout, and two
    /// vehicle-pinned layouts (vehicles 7 and 9).
    static let dashboards: [SavedDashboardSummary] = [
        SavedDashboardSummary(id: "default", name: "Overview", vehicleID: nil, isDefault: true),
        SavedDashboardSummary(id: "road-trip", name: "Road Trip", vehicleID: nil, isDefault: false),
        SavedDashboardSummary(id: "garage", name: "Garage", vehicleID: 7, isDefault: false),
        SavedDashboardSummary(id: "fleet", name: "Fleet", vehicleID: 9, isDefault: false)
    ]

    static func summary(id: String, name: String = "X", vehicleID: Int64? = nil) -> SavedDashboardSummary {
        SavedDashboardSummary(id: id, name: name, vehicleID: vehicleID, isDefault: false)
    }
}

// MARK: - Active / visible / rows

@MainActor final class LayoutSwitcherSelectionTests: XCTestCase {
    func testActiveResolvesByIdThenFallsBackToFirst() {
        XCTAssertEqual(
            LayoutSwitcherProjection.active(LayoutSwitcherFixture.dashboards, activeID: "garage")?.id,
            "garage"
        )
        // Unknown id falls back to the first layout (web `?? dashboards[0]`).
        XCTAssertEqual(
            LayoutSwitcherProjection.active(LayoutSwitcherFixture.dashboards, activeID: "nope")?.id,
            "default"
        )
        XCTAssertNil(LayoutSwitcherProjection.active([], activeID: "default"))
    }

    func testVisibleFiltersByVehicleScope() {
        // No vehicle selected ⇒ only user-global layouts.
        XCTAssertEqual(
            LayoutSwitcherProjection.visible(LayoutSwitcherFixture.dashboards, selectedVehicleID: nil).map(\.id),
            ["default", "road-trip"]
        )
        // Vehicle 7 ⇒ globals + the layout pinned to 7.
        XCTAssertEqual(
            LayoutSwitcherProjection.visible(LayoutSwitcherFixture.dashboards, selectedVehicleID: 7).map(\.id),
            ["default", "road-trip", "garage"]
        )
        // Vehicle 9 ⇒ globals + the layout pinned to 9 (not 7's).
        XCTAssertEqual(
            LayoutSwitcherProjection.visible(LayoutSwitcherFixture.dashboards, selectedVehicleID: 9).map(\.id),
            ["default", "road-trip", "fleet"]
        )
    }

    func testRowsCarryActivePinnedAndDefaultFlags() {
        let rows = LayoutSwitcherProjection.rows(
            LayoutSwitcherFixture.dashboards,
            activeID: "garage",
            selectedVehicleID: 7
        )
        XCTAssertEqual(rows.map(\.id), ["default", "road-trip", "garage"])

        let garage = try? XCTUnwrap(rows.first { $0.id == "garage" })
        XCTAssertEqual(garage?.isActive, true)
        XCTAssertEqual(garage?.isPinned, true)
        XCTAssertEqual(garage?.isDefault, false)

        let defaultRow = rows.first { $0.id == "default" }
        XCTAssertEqual(defaultRow?.isDefault, true)
        XCTAssertEqual(defaultRow?.isPinned, false)
        XCTAssertEqual(defaultRow?.isActive, false)
    }
}

// MARK: - Labels (active name / pinned label / save-as suggestion)

@MainActor final class LayoutSwitcherLabelTests: XCTestCase {
    private let echo = LayoutSwitcherLocalizer.echo

    func testActiveNameUsesNameOrUntitledFallback() {
        XCTAssertEqual(
            LayoutSwitcherProjection.activeName(
                LayoutSwitcherFixture.summary(id: "x", name: "Overview"),
                localize: echo
            ),
            "Overview"
        )
        XCTAssertEqual(LayoutSwitcherProjection.activeName(nil, localize: echo), "Untitled")
    }

    func testPinnedLabelPrefersDisplayNameThenVinThenId() {
        let pinned = LayoutSwitcherFixture.summary(id: "garage", vehicleID: 7)
        XCTAssertEqual(
            LayoutSwitcherProjection.pinnedLabel(
                active: pinned,
                vehicle: LayoutSwitcherVehicle(id: 7, displayName: "Model 3", vin: "VIN")
            ),
            "Model 3"
        )
        XCTAssertEqual(
            LayoutSwitcherProjection.pinnedLabel(
                active: pinned,
                vehicle: LayoutSwitcherVehicle(id: 7, displayName: nil, vin: "VIN123")
            ),
            "VIN123"
        )
        XCTAssertEqual(
            LayoutSwitcherProjection.pinnedLabel(
                active: pinned,
                vehicle: LayoutSwitcherVehicle(id: 7, displayName: nil, vin: nil)
            ),
            "#7"
        )
    }

    func testPinnedLabelNilWhenLayoutGlobalOrNoVehicle() {
        // Active layout has no vehicle scope ⇒ no pinned label (web `active.vehicleId != null`).
        XCTAssertNil(
            LayoutSwitcherProjection.pinnedLabel(
                active: LayoutSwitcherFixture.summary(id: "default", vehicleID: nil),
                vehicle: LayoutSwitcherVehicle(id: 7, displayName: "Model 3")
            )
        )
        // No selected vehicle ⇒ no pinned label (web `&& vehicle`).
        XCTAssertNil(
            LayoutSwitcherProjection.pinnedLabel(
                active: LayoutSwitcherFixture.summary(id: "garage", vehicleID: 7),
                vehicle: nil
            )
        )
    }

    func testSaveAsSuggestion() {
        XCTAssertEqual(
            LayoutSwitcherProjection.saveAsSuggestion(
                active: LayoutSwitcherFixture.summary(id: "x", name: "Overview"),
                localize: echo
            ),
            "Overview (Copy)"
        )
        XCTAssertEqual(
            LayoutSwitcherProjection.saveAsSuggestion(active: nil, localize: echo),
            "New Layout"
        )
    }
}

// MARK: - handleSaveAs / handlePinToggle branches

@MainActor final class LayoutSwitcherActionTests: XCTestCase {
    func testSaveAsOutcomeBranches() {
        let active = LayoutSwitcherFixture.summary(id: "default", name: "Overview")
        // Blank ⇒ no-op (web early return).
        XCTAssertEqual(
            LayoutSwitcherProjection.saveAsOutcome(name: "   ", active: active, hasDuplicate: true),
            .none
        )
        // Duplicator + active ⇒ duplicate the active id (typed name ignored, as in web).
        XCTAssertEqual(
            LayoutSwitcherProjection.saveAsOutcome(name: "Typed", active: active, hasDuplicate: true),
            .duplicate(id: "default")
        )
        // No duplicator ⇒ create with the trimmed typed name.
        XCTAssertEqual(
            LayoutSwitcherProjection.saveAsOutcome(name: "  My Layout  ", active: active, hasDuplicate: false),
            .create(name: "My Layout")
        )
        // Duplicator set but no active layout ⇒ falls through to create.
        XCTAssertEqual(
            LayoutSwitcherProjection.saveAsOutcome(name: "Fresh", active: nil, hasDuplicate: true),
            .create(name: "Fresh")
        )
    }

    func testPinControlDisabledRule() {
        // Pinned layout ⇒ offers Unpin, enabled.
        let pinned = LayoutSwitcherProjection.pinControl(
            active: LayoutSwitcherFixture.summary(id: "g", vehicleID: 7),
            selectedVehicleID: 7
        )
        XCTAssertTrue(pinned.isPinned)
        XCTAssertFalse(pinned.isDisabled)
        XCTAssertEqual(pinned.labelKey, "layout.unpin")
        XCTAssertEqual(pinned.systemImage, "pin.slash")

        // Global layout + a vehicle selected ⇒ offers Pin, enabled.
        let pinnable = LayoutSwitcherProjection.pinControl(
            active: LayoutSwitcherFixture.summary(id: "d", vehicleID: nil),
            selectedVehicleID: 7
        )
        XCTAssertFalse(pinnable.isPinned)
        XCTAssertFalse(pinnable.isDisabled)
        XCTAssertEqual(pinnable.labelKey, "layout.pin")

        // Global layout + no vehicle ⇒ disabled (web `disabled`).
        let inert = LayoutSwitcherProjection.pinControl(
            active: LayoutSwitcherFixture.summary(id: "d", vehicleID: nil),
            selectedVehicleID: nil
        )
        XCTAssertTrue(inert.isDisabled)
    }

    func testPinOutcomeBranches() {
        XCTAssertEqual(
            LayoutSwitcherProjection.pinOutcome(
                active: LayoutSwitcherFixture.summary(id: "g", vehicleID: 7),
                selectedVehicleID: 7
            ),
            .unpin(id: "g")
        )
        XCTAssertEqual(
            LayoutSwitcherProjection.pinOutcome(
                active: LayoutSwitcherFixture.summary(id: "d", vehicleID: nil),
                selectedVehicleID: 7
            ),
            .pin(id: "d", vehicleID: 7)
        )
        // Disabled case (global + no vehicle) ⇒ no outcome.
        XCTAssertNil(
            LayoutSwitcherProjection.pinOutcome(
                active: LayoutSwitcherFixture.summary(id: "d", vehicleID: nil),
                selectedVehicleID: nil
            )
        )
        XCTAssertNil(LayoutSwitcherProjection.pinOutcome(active: nil, selectedVehicleID: 7))
    }
}

// MARK: - Reset confirm / edit label / freshness

@MainActor final class LayoutSwitcherCopyTests: XCTestCase {
    private let echo = LayoutSwitcherLocalizer.echo

    func testResetConfirmContent() {
        let confirm = LayoutResetConfirm.build(localize: echo)
        XCTAssertEqual(confirm.title, "Reset dashboard to default?")
        XCTAssertEqual(confirm.confirmLabel, "Reset")
        XCTAssertEqual(confirm.cancelLabel, "Cancel")
        XCTAssertTrue(confirm.message.contains("removes all customizations"), confirm.message)
    }

    func testEditLabelTogglesCopy() {
        let edit = LayoutEditLabel.build(editMode: false, localize: echo)
        XCTAssertEqual(edit.label, "Edit")
        XCTAssertEqual(edit.title, "Edit dashboard (E)")
        XCTAssertEqual(edit.systemImage, "pencil")

        let done = LayoutEditLabel.build(editMode: true, localize: echo)
        XCTAssertEqual(done.label, "Done")
        XCTAssertEqual(done.title, "Exit edit (E)")
    }

    func testFreshnessChipProjection() {
        XCTAssertNil(LayoutFreshnessChip.project(.live))
        XCTAssertEqual(LayoutFreshnessChip.project(.stale), .stale)
        XCTAssertEqual(LayoutFreshnessChip.project(.offline), .offline)
        XCTAssertEqual(LayoutFreshnessChip.stale.labelKey, "layout.freshness.stale")
        XCTAssertEqual(LayoutFreshnessChip.offline.labelFallback, "Offline")
        XCTAssertTrue(LayoutSwitcherConnection.live.isLive)
        XCTAssertFalse(LayoutSwitcherConnection.stale.isLive)
        XCTAssertFalse(LayoutSwitcherConnection.offline.isLive)
    }
}

// MARK: - Accessibility + i18n key parity

@MainActor final class LayoutSwitcherAccessibilityTests: XCTestCase {
    private let echo = LayoutSwitcherLocalizer.echo

    func testTriggerLabelComposesEveryAnnotatedPart() {
        XCTAssertEqual(
            LayoutSwitcherAccessibility.triggerLabel(
                activeName: "Overview",
                dirty: true,
                pinnedLabel: "Model 3",
                localize: echo
            ),
            "Layout, Overview, modified, Model 3"
        )
        XCTAssertEqual(
            LayoutSwitcherAccessibility.triggerLabel(
                activeName: "Overview",
                dirty: false,
                pinnedLabel: nil,
                localize: echo
            ),
            "Layout, Overview"
        )
    }

    func testRowLabelTags() {
        XCTAssertEqual(
            LayoutSwitcherAccessibility.rowLabel(
                LayoutRow(id: "g", name: "Garage", isDefault: false, isPinned: true, isActive: true),
                localize: echo
            ),
            "Garage, pinned, selected"
        )
        XCTAssertEqual(
            LayoutSwitcherAccessibility.rowLabel(
                LayoutRow(id: "d", name: "Overview", isDefault: true, isPinned: false, isActive: false),
                localize: echo
            ),
            "Overview, default"
        )
    }

    /// Guards that the keys the surface references are exactly the web keys — a
    /// regression here means the folded catalog would miss a string.
    func testWebKeyParity() {
        XCTAssertEqual(
            LayoutPinControl(isPinned: true, isDisabled: false).labelKey,
            "layout.unpin"
        )
        XCTAssertEqual(
            LayoutPinControl(isPinned: false, isDisabled: false).labelKey,
            "layout.pin"
        )
        XCTAssertEqual(LayoutFreshnessChip.stale.labelKey, "layout.freshness.stale")
    }
}

// MARK: - State accessor + telemetry (P1/S11 view.opened)

@MainActor final class LayoutSwitcherStateTests: XCTestCase {
    func testStateDataAccessor() {
        let data = LayoutSwitcherData(dashboards: LayoutSwitcherFixture.dashboards, activeID: "default")
        XCTAssertEqual(LayoutSwitcherState.loaded(data).data, data)
        XCTAssertNil(LayoutSwitcherState.loading.data)
        XCTAssertNil(LayoutSwitcherState.empty.data)
        XCTAssertNil(LayoutSwitcherState.error(message: nil).data)
    }

    func testSelectedVehicleIDDerivation() {
        let withVehicle = LayoutSwitcherData(
            dashboards: LayoutSwitcherFixture.dashboards,
            activeID: "default",
            selectedVehicle: LayoutSwitcherVehicle(id: 7, displayName: "Model 3")
        )
        XCTAssertEqual(withVehicle.selectedVehicleID, 7)

        let noVehicle = LayoutSwitcherData(dashboards: LayoutSwitcherFixture.dashboards, activeID: "default")
        XCTAssertNil(noVehicle.selectedVehicleID)
    }
}

@MainActor final class LayoutSwitcherTelemetryTests: XCTestCase {
    private final class Recorder: LayoutSwitcherTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [String] = []
        var surfaces: [String] {
            lock.lock(); defer { lock.unlock() }
            return stored
        }

        func viewOpened(surface: String) {
            lock.lock(); stored.append(surface); lock.unlock()
        }
    }

    @MainActor
    func testReportOpenEmitsSlug() {
        let recorder = Recorder()
        LayoutSwitcherSurface.reportOpen(to: recorder)
        XCTAssertEqual(recorder.surfaces, ["LayoutSwitcher"])
        XCTAssertEqual(LayoutSwitcher.surfaceSlug, "LayoutSwitcher")
    }
}

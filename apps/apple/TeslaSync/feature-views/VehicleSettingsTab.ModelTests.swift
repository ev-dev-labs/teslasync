//
//  VehicleSettingsTab.ModelTests.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  State-holder coverage for the `VehicleSettingsTabModel`: the P1/S11 `view.opened`
//  telemetry, draft hydration + dirty tracking, the save validation + lifecycle, the
//  reset gating + lifecycle, the re-hydrate-on-change merge, and the stale auto-refresh
//  transition. The model is driven by `InMemoryVehicleSettingsSource` (no network).
//

import XCTest
@testable import TeslaSync

@MainActor final class VehicleSettingsModelTests: XCTestCase {
    private func populatedInput(connection: VehicleSettingsConnection = .live) -> VehicleSettingsInput {
        VehicleSettingsInput(
            settings: [
                ResolvedSetting(key: "nickname", value: "Lightning", source: .override),
                ResolvedSetting(key: "mute_until", value: "2026-06-20T09:30:00Z", source: .user),
                ResolvedSetting(key: "charge_cost_tariff_id", value: nil, source: .systemDefault),
                ResolvedSetting(key: "units_distance", value: "km", source: .vehicle),
                ResolvedSetting(key: "units_temperature", value: "C", source: .user),
                ResolvedSetting(key: "units_energy", value: "kWh", source: .systemDefault)
            ],
            connection: connection
        )
    }

    private func makeModel(
        _ input: VehicleSettingsInput,
        telemetry: VehicleSettingsTelemetry = OSLogVehicleSettingsTelemetry()
    ) -> (VehicleSettingsTabModel, InMemoryVehicleSettingsSource) {
        let source = InMemoryVehicleSettingsSource(initial: input)
        let model = VehicleSettingsTabModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func row(_ model: VehicleSettingsTabModel, _ key: String) -> RowViewState? {
        model.rows.first { $0.descriptor.key == key }
    }

    func testSurfaceSlug() {
        XCTAssertEqual(VehicleSettingsTab.surfaceSlug, "VehicleSettingsTab")
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyTelemetry()
        let (model, source) = makeModel(populatedInput(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.rows.count, 6)
        XCTAssertEqual(spy.surfaces, ["VehicleSettingsTab"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testHydratesDraftsFromEffective() {
        let (model, _) = makeModel(populatedInput())
        model.start()
        XCTAssertEqual(row(model, "nickname")?.draft, .text("Lightning"))
        XCTAssertEqual(row(model, "units_distance")?.draft, .selection("km"))
        XCTAssertEqual(
            row(model, "mute_until")?.draft,
            .timestamp(VehicleSettingsDateFormat.parse("2026-06-20T09:30:00Z"))
        )
        XCTAssertEqual(row(model, "nickname")?.isDirty, false)
    }

    func testOverrideGatesReset() {
        let (model, _) = makeModel(populatedInput())
        model.start()
        XCTAssertEqual(row(model, "nickname")?.isOverride, true)
        XCTAssertEqual(row(model, "nickname")?.canReset, true)
        XCTAssertEqual(row(model, "units_distance")?.isOverride, false)
        XCTAssertEqual(row(model, "units_distance")?.canReset, false)
    }

    func testEditUpdatesDraftAndDirty() {
        let (model, _) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text("Bolt"))
        XCTAssertEqual(row(model, "nickname")?.draft, .text("Bolt"))
        XCTAssertEqual(row(model, "nickname")?.isDirty, true)
        XCTAssertEqual(row(model, "nickname")?.canSave, true)
    }

    func testEditClampsToMaxLength() {
        let (model, _) = makeModel(populatedInput())
        model.start()
        let long = String(repeating: "a", count: 80)
        model.edit(key: "nickname", draft: .text(long))
        if case let .text(value)? = row(model, "nickname")?.draft {
            XCTAssertEqual(value.count, 64)
        } else {
            XCTFail("expected a clamped text draft")
        }
    }

    func testSaveBlockedWhenNotDirty() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.save(key: "nickname")
        XCTAssertEqual(source.upsertCount, 0)
    }

    func testSaveEmptyRequiredSetsValidationError() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text(""))
        model.save(key: "nickname")
        XCTAssertEqual(
            row(model, "nickname")?.validationError,
            VehicleSettingsStrings.string("vehicleSettings.validation.required", "Value is required.")
        )
        XCTAssertEqual(source.upsertCount, 0)
    }

    func testSaveInvalidSelectSetsValidationError() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "units_distance", draft: .selection("lightyears"))
        model.save(key: "units_distance")
        XCTAssertEqual(
            row(model, "units_distance")?.validationError,
            VehicleSettingsStrings.string(
                "vehicleSettings.validation.invalid",
                "Value is not valid for this setting."
            )
        )
        XCTAssertEqual(source.upsertCount, 0)
    }

    func testSaveValidForwardsTypedValueAndMovesToInFlight() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text("Bolt"))
        model.save(key: "nickname")
        XCTAssertEqual(source.upsertCount, 1)
        XCTAssertEqual(source.lastUpsert?.key, "nickname")
        XCTAssertEqual(source.lastUpsert?.value, .string("Bolt"))
        XCTAssertEqual(row(model, "nickname")?.savePhase, .inFlight)
        XCTAssertEqual(row(model, "nickname")?.canSave, false)
    }

    func testSaveTimestampForwardsRFC3339() throws {
        let (model, source) = makeModel(populatedInput())
        model.start()
        let date = try XCTUnwrap(VehicleSettingsDateFormat.parse("2027-01-02T03:04:05Z"))
        model.edit(key: "mute_until", draft: .timestamp(date))
        model.save(key: "mute_until")
        XCTAssertEqual(source.lastUpsert?.value, .string("2027-01-02T03:04:05Z"))
    }

    func testSaveSuccessOutcomeAndRefetchRehydrates() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text("Bolt"))
        model.save(key: "nickname")
        // Backend settles + the resolver refetch returns the new override value.
        source.pushOutcome(key: "nickname", outcome: .saveSucceeded)
        var refreshed = populatedInput()
        refreshed.settings = refreshed.settings.map {
            $0.key == "nickname" ? ResolvedSetting(key: "nickname", value: "Bolt", source: .override) : $0
        }
        source.push(refreshed)
        XCTAssertEqual(row(model, "nickname")?.savePhase, .idle)
        XCTAssertEqual(row(model, "nickname")?.draft, .text("Bolt"))
        XCTAssertEqual(row(model, "nickname")?.isDirty, false)
    }

    func testSaveFailureOutcomeSetsActionError() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text("Bolt"))
        model.save(key: "nickname")
        source.pushOutcome(key: "nickname", outcome: .saveFailed("network"))
        XCTAssertEqual(row(model, "nickname")?.savePhase, .idle)
        XCTAssertEqual(
            row(model, "nickname")?.actionError,
            VehicleSettingsStrings.string("vehicleSettings.errors.save", "Failed to save setting.")
        )
        // The draft is preserved so the user can retry.
        XCTAssertEqual(row(model, "nickname")?.isDirty, true)
    }

    func testResetOnlyFiresForOverrides() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.reset(key: "units_distance") // vehicle source → not resettable
        XCTAssertEqual(source.resetCount, 0)
        model.reset(key: "nickname") // override → resettable
        XCTAssertEqual(source.resetCount, 1)
        XCTAssertEqual(source.lastReset, "nickname")
        XCTAssertEqual(row(model, "nickname")?.resetPhase, .inFlight)
    }

    func testResetSuccessOutcomeAndRefetch() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.reset(key: "nickname")
        source.pushOutcome(key: "nickname", outcome: .resetSucceeded)
        var refreshed = populatedInput()
        refreshed.settings = refreshed.settings.map {
            $0.key == "nickname" ? ResolvedSetting(key: "nickname", value: "Model Y", source: .vehicle) : $0
        }
        source.push(refreshed)
        XCTAssertEqual(row(model, "nickname")?.resetPhase, .idle)
        XCTAssertEqual(row(model, "nickname")?.source, .vehicle)
        XCTAssertEqual(row(model, "nickname")?.canReset, false)
    }

    func testResetFailureOutcomeSetsActionError() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.reset(key: "nickname")
        source.pushOutcome(key: "nickname", outcome: .resetFailed("boom"))
        XCTAssertEqual(row(model, "nickname")?.resetPhase, .idle)
        XCTAssertEqual(
            row(model, "nickname")?.actionError,
            VehicleSettingsStrings.string("vehicleSettings.errors.reset", "Failed to reset setting.")
        )
    }

    func testMergePreservesDraftWhenEffectiveUnchanged() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text("Bolt"))
        // A refetch that re-delivers the same effective value must NOT clobber the draft.
        source.push(populatedInput())
        XCTAssertEqual(row(model, "nickname")?.draft, .text("Bolt"))
        XCTAssertEqual(row(model, "nickname")?.isDirty, true)
    }

    func testMergeRehydratesWhenEffectiveChanges() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.edit(key: "nickname", draft: .text("Bolt"))
        var changed = populatedInput()
        changed.settings = changed.settings.map {
            $0.key == "nickname" ? ResolvedSetting(key: "nickname", value: "Roadster", source: .override) : $0
        }
        source.push(changed)
        XCTAssertEqual(row(model, "nickname")?.draft, .text("Roadster"))
        XCTAssertEqual(row(model, "nickname")?.isDirty, false)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(populatedInput(connection: .live))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)
        source.push(populatedInput(connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(populatedInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(populatedInput(connection: .live))
        model.start()
        source.push(populatedInput(connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegates() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(populatedInput())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTelemetry: VehicleSettingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

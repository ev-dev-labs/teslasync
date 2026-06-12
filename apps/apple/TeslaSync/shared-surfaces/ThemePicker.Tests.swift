//
//  ThemePicker.Tests.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The state-holder + view-composition + facade + seams half of the coverage (the pure projection +
//  value types live in ThemePicker.AdapterTests.swift; split to keep each file within the SwiftLint
//  length budget):
//    • ThemePickerModel — seeding from the store, the preset / mode / custom selections writing through
//      the store (web `setTheme` / `setMode` / `setCustomColors`), the `Theme:`/`Mode:` toast on a tap
//      (web `handleTheme` / `handleMode`) and the no-toast custom-colour edit, the `onChange` /
//      `onModeChange` callbacks, the once-only `view.opened`, and the live projection.
//    • Views — the public surface + every subview compose in each branch.
//    • Strings — the web keys + a11y additions resolve through the P1/S10 facade with the fallbacks.
//    • Seams — the in-memory store + recording toast double behave as the production wiring expects.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ThemePickerModel (selection state + routing)

@MainActor
final class ThemePickerModelTests: XCTestCase {
    private func makeModel(
        store: InMemoryThemePickerStore = InMemoryThemePickerStore(),
        input: ThemePickerInput = ThemePickerInput(),
        toast: RecordingThemePickerToastPresenter? = nil,
        telemetry: any ThemePickerTelemetry = OSLogThemePickerTelemetry(),
        onChange: (@MainActor (String) -> Void)? = nil,
        onModeChange: (@MainActor (String) -> Void)? = nil
    ) -> ThemePickerModel {
        ThemePickerModel(
            store: store,
            input: input,
            toast: toast,
            onChange: onChange,
            onModeChange: onModeChange,
            telemetry: telemetry,
            resolve: { _, fallback in fallback }
        )
    }

    func testInitSeedsFromStore() {
        let store = InMemoryThemePickerStore(
            state: ThemePickerState(
                selectedThemeID: "tesla-red",
                selectedModeID: "oled",
                customPrimaryHex: "#010203",
                customAccentHex: "#040506"
            )
        )
        let model = makeModel(store: store)
        XCTAssertEqual(model.selectedThemeID, "tesla-red")
        XCTAssertEqual(model.selectedModeID, "oled")
        XCTAssertEqual(model.customPrimaryHex, "#010203")
        XCTAssertEqual(model.customAccentHex, "#040506")
    }

    func testSelectThemeWritesStorePresentsToastFiresOnChange() {
        let store = InMemoryThemePickerStore()
        let toast = RecordingThemePickerToastPresenter()
        let recorder = ChangeRecorder()
        let model = makeModel(store: store, toast: toast, onChange: { recorder.record($0) })
        model.selectTheme("tesla-red")
        XCTAssertEqual(store.setThemeCalls, ["tesla-red"])
        XCTAssertEqual(model.selectedThemeID, "tesla-red")
        XCTAssertEqual(toast.messages, ["Theme: Tesla Red"])
        XCTAssertEqual(recorder.values, ["tesla-red"])
    }

    func testSelectModeWritesStorePresentsToastFiresOnModeChange() {
        let store = InMemoryThemePickerStore()
        let toast = RecordingThemePickerToastPresenter()
        let recorder = ChangeRecorder()
        let model = makeModel(store: store, toast: toast, onModeChange: { recorder.record($0) })
        model.selectMode("light")
        XCTAssertEqual(store.setModeCalls, ["light"])
        XCTAssertEqual(model.selectedModeID, "light")
        XCTAssertEqual(toast.messages, ["Mode: Light"])
        XCTAssertEqual(recorder.values, ["light"])
    }

    func testSelectCustomAppliesCurrentColorsAndToast() {
        let store = InMemoryThemePickerStore()
        let toast = RecordingThemePickerToastPresenter()
        let recorder = ChangeRecorder()
        let model = makeModel(store: store, toast: toast, onChange: { recorder.record($0) })
        model.selectCustom()
        XCTAssertEqual(store.setCustomColorsCalls, [
            ThemePickerCustomColorEdit(
                primaryHex: ThemePickerCatalog.defaultCustomPrimaryHex,
                accentHex: ThemePickerCatalog.defaultCustomAccentHex
            )
        ])
        XCTAssertEqual(model.selectedThemeID, "custom")
        XCTAssertEqual(toast.messages, ["Theme: Custom"])
        XCTAssertEqual(recorder.values, ["custom"])
    }

    func testUpdateCustomPrimaryWritesSelectsCustomNoToast() {
        let store = InMemoryThemePickerStore()
        let toast = RecordingThemePickerToastPresenter()
        let recorder = ChangeRecorder()
        let model = makeModel(store: store, toast: toast, onChange: { recorder.record($0) })
        model.updateCustomPrimary("#123456")
        XCTAssertEqual(model.customPrimaryHex, "#123456")
        XCTAssertEqual(model.selectedThemeID, "custom")
        XCTAssertEqual(
            store.setCustomColorsCalls.last,
            ThemePickerCustomColorEdit(primaryHex: "#123456", accentHex: ThemePickerCatalog.defaultCustomAccentHex)
        )
        XCTAssertEqual(recorder.values, ["custom"])
        XCTAssertTrue(toast.messages.isEmpty, "a colour edit does not raise a toast (web parity)")
    }

    func testUpdateCustomAccentWritesSelectsCustom() {
        let store = InMemoryThemePickerStore()
        let model = makeModel(store: store)
        model.updateCustomAccent("#abcdef")
        XCTAssertEqual(model.customAccentHex, "#abcdef")
        XCTAssertEqual(model.selectedThemeID, "custom")
        XCTAssertEqual(store.setCustomColorsCalls.last?.accentHex, "#abcdef")
    }

    func testMarkAppearedEmitsViewOpenedOnce() {
        let spy = SpyThemePickerTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, ["ThemePicker"])
    }

    func testProjectionReflectsSelectionChange() {
        let model = makeModel()
        XCTAssertEqual(model.projection.themeOptions.first { $0.id == "neon-cyan" }?.isSelected, true)
        model.selectTheme("solar-amber")
        XCTAssertEqual(model.projection.themeOptions.first { $0.id == "solar-amber" }?.isSelected, true)
        XCTAssertEqual(model.projection.themeOptions.first { $0.id == "neon-cyan" }?.isSelected, false)
    }

    func testProjectionBuilderAppearsAfterSelectCustom() {
        let model = makeModel()
        XCTAssertNil(model.projection.customBuilder)
        model.selectCustom()
        XCTAssertNotNil(model.projection.customBuilder)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class ThemePickerViewTests: XCTestCase {
    func testSurfaceComposesForBranches() {
        _ = ThemePicker(store: InMemoryThemePickerStore())
        _ = ThemePicker(
            store: InMemoryThemePickerStore(),
            input: ThemePickerInput(showMode: false, showCustom: false, compact: true)
        )
        _ = ThemePicker(model: ThemePickerModel(store: InMemoryThemePickerStore()))
        XCTAssertEqual(ThemePicker.surfaceSlug, "ThemePicker")
    }

    func testSubviewsCompose() {
        let model = ThemePickerModel(store: InMemoryThemePickerStore())
        let layout = ThemePickerProjector.layout(compact: false)
        let modeOption = ThemePickerModeOption(
            id: "dark",
            displayName: "Dark",
            iconSystemName: "moon",
            swatchHexes: ["#0a0a0f", "#0f1019", "#151621", "#1a1b2e"],
            iconBackgroundHex: "#1a1b2e",
            iconBorderHex: "#FFFFFF14",
            iconForegroundHex: "#ffffff",
            isSelected: true
        )
        let themeOption = ThemePickerThemeOption(
            id: "neon-cyan",
            displayName: "Neon Cyan",
            gradientStartHex: "#00f0ff",
            gradientEndHex: "#4f46e5",
            isSelected: true,
            isCustom: false
        )
        let builder = ThemePickerCustomBuilder(
            primaryHex: "#00b4d8",
            accentHex: "#e63946",
            primaryLabel: "Primary",
            accentLabel: "Accent"
        )
        _ = ThemePickerSectionLabel(text: "Display Mode")
        _ = ThemePickerModeSection(title: "Display Mode", options: [modeOption], layout: layout, onSelect: { _ in })
        _ = ThemePickerModeCard(option: modeOption, action: {})
        _ = ThemePickerThemeSwatch(option: themeOption, action: {})
        _ = ThemePickerCustomBuilderView(builder: builder, primary: .constant(.red), accent: .constant(.blue))
        _ = ThemePickerColorWell(
            label: "Primary",
            hex: "#00b4d8",
            voiceOverLabel: "Custom primary color",
            selection: .constant(.red)
        )
        _ = ThemePickerEmptyState()
        _ = ThemePickerAccentSection(model: model, projection: model.projection, layout: layout)
    }
}

// MARK: - Strings facade (P1/S10)

final class ThemePickerStringsTests: XCTestCase {
    func testWebKeyFallbacks() {
        XCTAssertEqual(ThemePickerStrings.themeWord, "Theme")
        XCTAssertEqual(ThemePickerStrings.modeWord, "Mode")
        XCTAssertEqual(ThemePickerStrings.displayMode, "Display Mode")
        XCTAssertEqual(ThemePickerStrings.accentColor, "Accent Color")
        XCTAssertEqual(ThemePickerStrings.custom, "Custom")
        XCTAssertEqual(ThemePickerStrings.primary, "Primary")
        XCTAssertEqual(ThemePickerStrings.accent, "Accent")
    }

    func testA11yFallbacks() {
        XCTAssertEqual(ThemePickerStrings.selectedValue, "Selected")
        XCTAssertEqual(ThemePickerStrings.modeHint, "Selects the display mode")
        XCTAssertEqual(ThemePickerStrings.themeHint, "Selects the accent color")
        XCTAssertEqual(ThemePickerStrings.customPrimaryLabel, "Custom primary color")
        XCTAssertEqual(ThemePickerStrings.customAccentLabel, "Custom accent color")
        XCTAssertEqual(ThemePickerStrings.emptyTitle, "No themes available")
    }

    func testResolverReturnsFallbackForMissingKey() {
        XCTAssertEqual(ThemePickerStrings.string("theme.__missing__", "fallback"), "fallback")
    }
}

// MARK: - Seams (in-memory store + recording toast)

@MainActor
final class ThemePickerSeamsTests: XCTestCase {
    func testInMemoryStoreRecordsAndUpdatesState() {
        let store = InMemoryThemePickerStore()
        store.setTheme("tesla-red")
        XCTAssertEqual(store.setThemeCalls, ["tesla-red"])
        XCTAssertEqual(store.state.selectedThemeID, "tesla-red")
        store.setMode("oled")
        XCTAssertEqual(store.setModeCalls, ["oled"])
        XCTAssertEqual(store.state.selectedModeID, "oled")
        store.setCustomColors(primary: "#111111", accent: "#222222")
        XCTAssertEqual(
            store.setCustomColorsCalls,
            [ThemePickerCustomColorEdit(primaryHex: "#111111", accentHex: "#222222")]
        )
        XCTAssertEqual(store.state.selectedThemeID, "custom")
        XCTAssertEqual(store.state.customPrimaryHex, "#111111")
        XCTAssertEqual(store.state.customAccentHex, "#222222")
    }

    func testRecordingToastRecordsMessages() {
        let toast = RecordingThemePickerToastPresenter()
        toast.presentInfo("Theme: Neon Cyan")
        XCTAssertEqual(toast.messages, ["Theme: Neon Cyan"])
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyThemePickerTelemetry: ThemePickerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records the ids routed out through `onChange` / `onModeChange` (the `@MainActor` page-closure seam).
@MainActor
private final class ChangeRecorder {
    private(set) var values: [String] = []

    func record(_ value: String) {
        values.append(value)
    }
}

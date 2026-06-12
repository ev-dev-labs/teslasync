//
//  ThemeProvider.Tests.swift
//  TeslaSync — P4 shared surface · 0229 · ThemeProvider (Apple)
//
//  The projection + state-holder + view-composition half of the coverage (the pure value types +
//  catalog + reducer live in ThemeProvider.AdapterTests.swift; split to keep each file within the
//  SwiftLint file-length budget):
//    • ThemeProjection — every colorway/mode resolves, custom rebuilds from the live pair, and `auto`
//      collapses to dark/light against the system appearance (web `resolvedMode`).
//    • ThemeSyncPhase — the loading/stale/degraded flags.
//    • ThemeProviderModel — view.opened once + idempotent; init loads persisted; setters mutate +
//      persist + broadcast; custom activates `custom` + broadcasts both; system-appearance drives auto;
//      refreshFromRemote maps every gateway result; backend save is gated on `initialized`; a mirrored
//      change applies WITHOUT re-persist/re-broadcast (web cross-tab guard).
//    • Views — the status badge style maps every phase; the badge/swatches/board/provider compose; the
//      Color bridge builds; strings resolve through the P1/S10 facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the seams are in-memory.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ThemeProjection (web `resolvedMode` + custom rebuild)

final class ThemeProjectionTests: XCTestCase {
    func testResolvesBuiltInColorwayAndMode() {
        let resolved = ThemeProjection.resolve(
            selection: ThemeSelection(colorway: .teslaRed, mode: .midnight, customColors: .default),
            systemPrefersDark: true
        )
        XCTAssertEqual(resolved.colorway, .teslaRed)
        XCTAssertEqual(resolved.mode, .midnight)
        XCTAssertEqual(resolved.colorwayPalette.primaryRGB, "227, 25, 55")
        XCTAssertEqual(resolved.modePalette.id, .midnight)
        XCTAssertEqual(resolved.effectiveColorScheme, .dark)
    }

    func testCustomColorwayRebuildsFromLivePair() {
        let resolved = ThemeProjection.resolve(
            selection: ThemeSelection(
                colorway: .custom,
                mode: .dark,
                customColors: CustomColors(primary: "#102030", accent: "#405060")
            ),
            systemPrefersDark: true
        )
        XCTAssertEqual(resolved.colorwayPalette.id, .custom)
        XCTAssertEqual(resolved.colorwayPalette.primary.rgbString, "16, 32, 48")
    }

    func testAutoResolvesToDarkOrLightBySystem() {
        let dark = ThemeProjection.resolve(
            selection: ThemeSelection(colorway: .neonCyan, mode: .auto, customColors: .default),
            systemPrefersDark: true
        )
        XCTAssertEqual(dark.mode, .auto, "the selected id stays auto (web modeId)")
        XCTAssertEqual(dark.modePalette.id, .dark)
        XCTAssertEqual(dark.effectiveColorScheme, .dark)

        let light = ThemeProjection.resolve(
            selection: ThemeSelection(colorway: .neonCyan, mode: .auto, customColors: .default),
            systemPrefersDark: false
        )
        XCTAssertEqual(light.modePalette.id, .light)
        XCTAssertEqual(light.effectiveColorScheme, .light)
        XCTAssertTrue(light.followsSystem)
    }

    func testResolvedModeIDPassesThroughNonAuto() {
        XCTAssertEqual(ThemeProjection.resolvedModeID(for: .sunset, systemPrefersDark: false), .sunset)
        XCTAssertEqual(ThemeProjection.resolvedModeID(for: .auto, systemPrefersDark: true), .dark)
        XCTAssertEqual(ThemeProjection.resolvedModeID(for: .auto, systemPrefersDark: false), .light)
    }

    func testDefaultResolvedTheme() {
        XCTAssertEqual(ResolvedTheme.default.colorway, .neonCyan)
        XCTAssertEqual(ResolvedTheme.default.modePalette.id, .dark)
    }
}

// MARK: - ThemeSyncPhase

final class ThemeSyncPhaseTests: XCTestCase {
    func testFlags() {
        XCTAssertTrue(ThemeSyncPhase.loading.isLoading)
        XCTAssertFalse(ThemeSyncPhase.synced.isLoading)
        XCTAssertTrue(ThemeSyncPhase.stale.isStale)
        XCTAssertTrue(ThemeSyncPhase.failed.isDegraded)
        XCTAssertTrue(ThemeSyncPhase.offline.isDegraded)
        XCTAssertFalse(ThemeSyncPhase.synced.isDegraded)
    }
}

// MARK: - ThemeProviderModel (web state + useTheme value)

@MainActor
final class ThemeProviderModelTests: XCTestCase {
    /// The bound model plus the in-memory seams a test asserts against.
    private struct Harness {
        let model: ThemeProviderModel
        let persistence: InMemoryThemePersistence
        let telemetry: SpyThemeTelemetry
    }

    private func makeModel(
        seed: ThemeSelection = .default,
        result: ThemeRemoteResult = .empty,
        broadcaster: any ThemeBroadcaster = NoopThemeBroadcaster(),
        telemetry: SpyThemeTelemetry = SpyThemeTelemetry(),
        gateway: SpyThemeRemoteGateway? = nil,
        systemPrefersDark: Bool = true
    ) -> Harness {
        let persistence = InMemoryThemePersistence(seed: seed)
        let remote: any ThemeRemoteGateway = gateway ?? StaticThemeRemoteGateway(result: result)
        let model = ThemeProviderModel(
            persistence: persistence,
            remote: remote,
            broadcaster: broadcaster,
            telemetry: telemetry,
            systemPrefersDark: systemPrefersDark
        )
        return Harness(model: model, persistence: persistence, telemetry: telemetry)
    }

    private func settle() async {
        for _ in 0 ..< 5 {
            await Task.yield()
        }
    }

    func testInitLoadsPersistedSelection() {
        let seed = ThemeSelection(colorway: .royalPurple, mode: .nord, customColors: .default)
        let model = makeModel(seed: seed).model
        XCTAssertEqual(model.selection, seed)
        XCTAssertEqual(model.resolved.colorway, .royalPurple)
    }

    func testStartEmitsViewOpenedOnceAndIdempotent() {
        let harness = makeModel()
        let model = harness.model
        let telemetry = harness.telemetry
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, [ThemeProviderSurface.slug])
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.surfaces, [ThemeProviderSurface.slug], "view.opened fires once per instance")
    }

    func testSetColorwayMutatesPersistsAndBroadcasts() {
        let broadcaster = FakeThemeBroadcaster()
        let harness = makeModel(broadcaster: broadcaster)
        let model = harness.model
        let persistence = harness.persistence
        model.setColorway(.teslaRed)
        XCTAssertEqual(model.selection.colorway, .teslaRed)
        XCTAssertEqual(persistence.load().colorway, .teslaRed)
        XCTAssertEqual(broadcaster.published, [.selection(colorway: .teslaRed, mode: .dark)])
    }

    func testSetModeMutatesPersistsAndBroadcasts() {
        let broadcaster = FakeThemeBroadcaster()
        let harness = makeModel(broadcaster: broadcaster)
        let model = harness.model
        let persistence = harness.persistence
        model.setMode(.sunset)
        XCTAssertEqual(model.selection.mode, .sunset)
        XCTAssertEqual(persistence.load().mode, .sunset)
        XCTAssertEqual(broadcaster.published, [.selection(colorway: .neonCyan, mode: .sunset)])
    }

    func testSetCustomColorsActivatesCustomAndBroadcastsBoth() {
        let broadcaster = FakeThemeBroadcaster()
        let harness = makeModel(broadcaster: broadcaster)
        let model = harness.model
        let persistence = harness.persistence
        model.setCustomColors(primary: "#123456", accent: "#654321")
        XCTAssertEqual(model.selection.colorway, .custom)
        XCTAssertEqual(model.selection.customColors, CustomColors(primary: "#123456", accent: "#654321"))
        XCTAssertEqual(persistence.load().colorway, .custom)
        XCTAssertEqual(broadcaster.published, [
            .customColors(CustomColors(primary: "#123456", accent: "#654321")),
            .selection(colorway: .custom, mode: .dark)
        ])
        XCTAssertEqual(model.colorways[5].primary.rgbString, "18, 52, 86", "colorways reflects the live pair")
    }

    func testUpdateSystemAppearanceDrivesAutoResolution() {
        let seed = ThemeSelection(colorway: .neonCyan, mode: .auto, customColors: .default)
        let model = makeModel(seed: seed).model
        model.updateSystemAppearance(prefersDark: true)
        XCTAssertEqual(model.resolved.modePalette.id, .dark)
        model.updateSystemAppearance(prefersDark: false)
        XCTAssertEqual(model.resolved.modePalette.id, .light)
    }

    func testRefreshAppliedAdoptsAndSyncs() async {
        let remote = RemoteThemeSettings(theme: "matrix-green", mode: "oled", customPrimary: nil, customAccent: nil)
        let harness = makeModel(result: .applied(remote))
        let model = harness.model
        let persistence = harness.persistence
        await model.refreshFromRemote()
        XCTAssertEqual(model.syncPhase, .synced)
        XCTAssertEqual(model.selection.colorway, .matrixGreen)
        XCTAssertEqual(model.selection.mode, .oled)
        XCTAssertEqual(persistence.load().colorway, .matrixGreen, "adopted selection persisted locally")
    }

    func testRefreshMapsEveryGatewayResult() async {
        let stale = RemoteThemeSettings(theme: "nord", mode: nil, customPrimary: nil, customAccent: nil)
        let cases: [(ThemeRemoteResult, ThemeSyncPhase)] = [
            (.empty, .localOnly),
            (.failed, .failed),
            (.offline, .offline),
            (.stale(stale), .stale)
        ]
        for (result, expected) in cases {
            let model = makeModel(result: result).model
            await model.refreshFromRemote()
            XCTAssertEqual(model.syncPhase, expected, "result \(result)")
        }
    }

    func testBackendSaveGatedOnInitialized() async {
        let gateway = SpyThemeRemoteGateway(result: .empty)
        let model = makeModel(gateway: gateway).model
        model.setColorway(.teslaRed)
        await settle()
        XCTAssertEqual(gateway.savedCount, 0, "no backend save before the first hydrate (web !initialized)")

        await model.refreshFromRemote()
        let expectation = expectation(description: "backend save")
        gateway.onSave = { expectation.fulfill() }
        model.setMode(.nord)
        await fulfillment(of: [expectation], timeout: 1.0)
        XCTAssertGreaterThanOrEqual(gateway.savedCount, 1, "after initialized, mutations persist to backend")
    }

    func testMirroredChangeAppliesWithoutRePersistOrRebroadcast() async {
        let broadcaster = FakeThemeBroadcaster()
        let harness = makeModel(broadcaster: broadcaster)
        let model = harness.model
        let persistence = harness.persistence
        model.start()
        broadcaster.publish(.selection(colorway: .teslaRed, mode: .nord))
        await settle()
        XCTAssertEqual(model.selection.colorway, .teslaRed, "mirrored change applied")
        XCTAssertEqual(model.selection.mode, .nord)
        XCTAssertEqual(persistence.load().colorway, .neonCyan, "mirror must NOT re-persist (web guard)")
        XCTAssertEqual(broadcaster.published.count, 1, "mirror must NOT re-broadcast (web guard)")
        model.stop()
    }
}

// MARK: - Views (style mapping + composition + bridge + strings)

@MainActor
final class ThemeProviderViewTests: XCTestCase {
    func testStatusStyleMapsEveryPhase() {
        let phases: [ThemeSyncPhase] = [.idle, .loading, .synced, .localOnly, .stale, .failed, .offline]
        for phase in phases {
            let style = ThemeSyncStatusStyle(phase: phase)
            XCTAssertFalse(style.systemImage.isEmpty, "\(phase) needs a symbol")
            XCTAssertFalse(style.label.isEmpty, "\(phase) needs a label")
        }
        XCTAssertTrue(ThemeSyncStatusStyle(phase: .loading).showsSpinner)
        XCTAssertTrue(ThemeSyncStatusStyle(phase: .failed).showsRetry)
        XCTAssertTrue(ThemeSyncStatusStyle(phase: .stale).showsRetry)
        XCTAssertFalse(ThemeSyncStatusStyle(phase: .synced).showsRetry)
    }

    func testColorBridgeBuilds() {
        let color = Color(themeColor: ThemeCatalog.colorway(.neonCyan).primary)
        _ = color
    }

    func testViewsCompose() {
        _ = ThemeSyncStatusBadge(phase: .loading)
        _ = ThemeSyncStatusBadge(phase: .failed, onRetry: {})
        _ = ThemeColorwaySwatch(palette: ThemeCatalog.colorway(.teslaRed), isSelected: true)
        _ = ThemeModeSwatch(palette: ThemeCatalog.mode(.nord), isSelected: false)
        _ = ThemePreviewBoard(phase: .stale)
    }

    func testProviderAndModifierCompose() {
        let model = ThemeProviderModel(
            persistence: InMemoryThemePersistence(),
            remote: StaticThemeRemoteGateway(),
            broadcaster: NoopThemeBroadcaster()
        )
        _ = ThemeProvider(model: model) { EmptyView() }
        _ = EmptyView().themeProvider(broadcaster: NoopThemeBroadcaster())
        XCTAssertEqual(ThemeProvider<EmptyView>.surfaceSlug, "ThemeProvider")
    }

    func testStringsFacadeFallbacks() {
        XCTAssertEqual(
            ThemeProviderStrings.string("themeProvider.colorway.neonCyan", "Neon Cyan"),
            "Neon Cyan"
        )
        XCTAssertEqual(
            ThemeProviderStrings.string("themeProvider.status.failed", "Couldn't sync theme"),
            "Couldn't sync theme"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded for the `Sendable` telemetry seam under Swift 6.
private final class SpyThemeTelemetry: ThemeProviderTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock(); storage.append(surface); lock.unlock()
    }
}

/// A synchronous in-memory broadcaster that records publishes and fans them to live subscribers.
private final class FakeThemeBroadcaster: ThemeBroadcaster, @unchecked Sendable {
    private let lock = NSLock()
    private var handlers: [UUID: @Sendable (ThemeChange) -> Void] = [:]
    private var storage: [ThemeChange] = []

    var published: [ThemeChange] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func publish(_ change: ThemeChange) {
        lock.lock()
        storage.append(change)
        let live = Array(handlers.values)
        lock.unlock()
        live.forEach { $0(change) }
    }

    func subscribe(_ handler: @escaping @Sendable (ThemeChange) -> Void) -> ThemeSubscription {
        let id = UUID()
        lock.lock(); handlers[id] = handler; lock.unlock()
        return ThemeSubscription { [weak self] in
            self?.lock.lock(); self?.handlers[id] = nil; self?.lock.unlock()
        }
    }
}

/// A gateway with a fixed load result that counts backend saves (for the `initialized` gating test).
private final class SpyThemeRemoteGateway: ThemeRemoteGateway, @unchecked Sendable {
    private let lock = NSLock()
    private let result: ThemeRemoteResult
    private var saves = 0
    var onSave: (@Sendable () -> Void)?

    init(result: ThemeRemoteResult) {
        self.result = result
    }

    var savedCount: Int {
        lock.lock(); defer { lock.unlock() }
        return saves
    }

    func load() async -> ThemeRemoteResult {
        result
    }

    func save(_: ThemeSelection) async {
        let callback = lock.withLock { () -> (@Sendable () -> Void)? in
            saves += 1
            return onSave
        }
        callback?()
    }
}

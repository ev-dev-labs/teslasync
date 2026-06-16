import XCTest
@testable import TeslaSync

/// State-machine + derivation tests for `DashboardPageModel` — every data state the page renders
/// (loading / error / ready-onboarding / ready-populated), the auth-driven onboarding branch +
/// warning, the soft-failing auth read, the sync flow, the customization layout (edit mode, add /
/// remove / auto-arrange / reset with undo-redo history), the soft-banner gates, the kiosk
/// toggle, and the route metadata + registration.
@MainActor
final class DashboardPageModelTests: XCTestCase {
    private struct StubError: Error {}

    private actor StubSource: DashboardDataSource {
        let authenticated: Bool
        let vehicles: [DashboardVehicle]
        let synced: [DashboardVehicle]
        let failVehicles: Bool
        let failAuth: Bool

        init(
            authenticated: Bool = true,
            vehicles: [DashboardVehicle] = [],
            synced: [DashboardVehicle] = [],
            failVehicles: Bool = false,
            failAuth: Bool = false
        ) {
            self.authenticated = authenticated
            self.vehicles = vehicles
            self.synced = synced
            self.failVehicles = failVehicles
            self.failAuth = failAuth
        }

        func loadAuthStatus() async throws -> DashboardAuthStatus {
            if failAuth { throw StubError() }
            return DashboardAuthStatus(authenticated: authenticated)
        }

        func loadVehicles() async throws -> [DashboardVehicle] {
            if failVehicles { throw StubError() }
            return vehicles
        }

        func syncVehicles() async throws -> [DashboardVehicle] {
            if failVehicles { throw StubError() }
            return synced
        }
    }

    private func vehicle(_ id: Int64, _ name: String, model: String = "Model 3") -> DashboardVehicle {
        DashboardVehicle(id: id, displayName: name, model: model)
    }

    // MARK: Phases

    func testInitialPhaseIsLoading() {
        let model = DashboardPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadResolvesToReadyWithVehicles() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha"), vehicle(2, "Bravo")])
        let model = DashboardPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.vehicles.count, 2)
        XCTAssertFalse(model.showsOnboarding)
        XCTAssertNotNil(model.updatedAt)
    }

    func testNoVehiclesResolvesToOnboarding() async {
        let model = DashboardPageModel(dataSource: StubSource(vehicles: []))
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.showsOnboarding)
    }

    func testVehiclesFailureResolvesToError() async {
        let model = DashboardPageModel(dataSource: StubSource(failVehicles: true))
        await model.load()
        XCTAssertEqual(model.phase, .error)
    }

    func testAuthFailureStaysReady() async {
        let source = StubSource(vehicles: [vehicle(1, "Alpha")], failAuth: true)
        let model = DashboardPageModel(dataSource: source)
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNil(model.auth)
        XCTAssertFalse(model.showsAuthWarning)
    }

    func testRefreshKeepsReady() async {
        let model = DashboardPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        await model.load()
        await model.refresh()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.isRefreshing)
    }

    // MARK: Auth + onboarding branch

    func testShowsAuthWarningWhenNotConnected() async {
        let model = DashboardPageModel(dataSource: StubSource(authenticated: false, vehicles: []))
        await model.load()
        XCTAssertTrue(model.showsAuthWarning)
        XCTAssertFalse(model.isAuthenticated)
    }

    func testOnboardingCopySwitchesOnAuth() {
        XCTAssertEqual(DashboardOnboardingCopy.titleKey(authenticated: true), "onboarding.syncTitle")
        XCTAssertEqual(DashboardOnboardingCopy.titleKey(authenticated: false), "onboarding.title")
        XCTAssertEqual(DashboardOnboardingCopy.ctaKey(authenticated: true), "onboarding.sync")
        XCTAssertEqual(DashboardOnboardingCopy.ctaKey(authenticated: false), "onboarding.connect")
    }

    // MARK: Sync (web useSyncVehicles)

    func testSyncPopulatesGarage() async {
        let source = StubSource(authenticated: true, vehicles: [], synced: [vehicle(1, "Alpha")])
        let model = DashboardPageModel(dataSource: source)
        await model.load()
        XCTAssertTrue(model.showsOnboarding)
        await model.sync()
        XCTAssertFalse(model.isSyncing)
        XCTAssertEqual(model.vehicles.count, 1)
        XCTAssertFalse(model.showsOnboarding)
    }

    // MARK: Customization (web useDashboardLayout)

    func testEditModeToggle() {
        let model = DashboardPageModel()
        XCTAssertFalse(model.editMode)
        model.toggleEditMode()
        XCTAssertTrue(model.editMode)
        model.setEditMode(false)
        XCTAssertFalse(model.editMode)
    }

    func testRemoveWidgetWithUndoRedo() {
        let model = DashboardPageModel()
        let seededCount = DashboardWidget.seeded.count
        model.removeWidget(.batteryGauge)
        XCTAssertEqual(model.layout.count, seededCount - 1)
        XCTAssertFalse(model.layout.contains(.batteryGauge))
        XCTAssertTrue(model.canUndo)
        XCTAssertEqual(model.undoCount, 1)
        model.undo()
        XCTAssertTrue(model.layout.contains(.batteryGauge))
        XCTAssertTrue(model.canRedo)
        model.redo()
        XCTAssertFalse(model.layout.contains(.batteryGauge))
    }

    func testAddWidgetIgnoresDuplicate() {
        let model = DashboardPageModel()
        model.addWidget(.batteryGauge)
        XCTAssertEqual(model.layout, DashboardWidget.seeded)
        XCTAssertFalse(model.canUndo)
    }

    func testAutoArrangeRestoresSeededOrder() {
        let model = DashboardPageModel()
        model.removeWidget(.vehicleHero)
        model.addWidget(.vehicleHero)
        XCTAssertNotEqual(model.layout, DashboardWidget.seeded)
        model.autoArrange()
        XCTAssertEqual(model.layout, DashboardWidget.seeded)
    }

    func testResetToDefault() {
        let model = DashboardPageModel()
        model.removeWidget(.quickNav)
        XCTAssertFalse(model.isOnlyDefaultLayout)
        model.resetToDefault()
        XCTAssertTrue(model.isOnlyDefaultLayout)
        XCTAssertEqual(model.layout, DashboardWidget.seeded)
    }

    func testNewBlankDashboardClearsLayout() {
        let model = DashboardPageModel()
        model.newBlankDashboard()
        XCTAssertTrue(model.layout.isEmpty)
        XCTAssertTrue(model.canUndo)
        model.undo()
        XCTAssertEqual(model.layout, DashboardWidget.seeded)
    }

    func testAddWidgetAppendsAfterRemove() {
        let model = DashboardPageModel()
        model.removeWidget(.batteryGauge)
        XCTAssertFalse(model.layout.contains(.batteryGauge))
        model.addWidget(.batteryGauge)
        XCTAssertTrue(model.layout.contains(.batteryGauge))
        XCTAssertEqual(model.layout.last, .batteryGauge)
    }

    func testAddableWidgetsExcludesPresent() {
        let model = DashboardPageModel()
        XCTAssertTrue(model.addableWidgets.isEmpty)
        model.removeWidget(.chargeStatus)
        XCTAssertEqual(model.addableWidgets, [.chargeStatus])
    }

    // MARK: Banners + kiosk

    func testCustomizeHintGate() async {
        let model = DashboardPageModel(dataSource: StubSource(vehicles: [vehicle(1, "Alpha")]))
        await model.load()
        XCTAssertFalse(model.showsCustomizeHint)
        model.markCustomizeHintReady()
        XCTAssertTrue(model.showsCustomizeHint)
        model.dismissCustomizeHint()
        XCTAssertFalse(model.showsCustomizeHint)
    }

    func testThemeBannerDismiss() {
        let model = DashboardPageModel(themeIsDefault: true)
        XCTAssertTrue(model.showsThemeBanner)
        model.dismissThemeBanner()
        XCTAssertFalse(model.showsThemeBanner)
    }

    func testThemeBannerHiddenWhenCustomTheme() {
        let model = DashboardPageModel(themeIsDefault: false)
        XCTAssertFalse(model.showsThemeBanner)
    }

    func testKioskToggle() {
        let model = DashboardPageModel()
        XCTAssertFalse(model.isKiosk)
        model.enterKiosk()
        XCTAssertTrue(model.isKiosk)
        model.exitKiosk()
        XCTAssertFalse(model.isKiosk)
    }

    // MARK: Route + registration

    func testRouteMetadata() {
        XCTAssertEqual(AppRoute.dashboard.pathSegment, "dashboard")
        XCTAssertEqual(AppRoute.dashboard.group, .overview)
        XCTAssertEqual(AppRouteParser.parse(path: "/"), .dashboard)
    }

    func testRouteRegistrationRegistersPage() {
        let registry = DashboardRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.dashboard))
    }
}

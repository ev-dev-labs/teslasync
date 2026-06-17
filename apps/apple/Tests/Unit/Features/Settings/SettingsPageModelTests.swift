import SwiftUI
import XCTest
@testable import TeslaSync

/// State-machine + parity tests for `SettingsPageModel` and the `.settingsPage` route
/// registration: every web i18n key the page renders, the loading → ready resolution (on both
/// success and failure, faithful to the web `PageContainer` loading gate), the tour-launcher /
/// checklist-restart / edit-conflict actions over their injected seams, and the route
/// metadata + deep-link parsing (without regressing the native `.settings` surface).
@MainActor
final class SettingsPageModelTests: XCTestCase {
    // MARK: - Parity i18n keys (web `t(key, default)`)

    func testParityStringKeysMatchWeb() {
        let model = SettingsPageModel()
        XCTAssertEqual(model.titleKey, LocalizedStringKey("settings.title"))
        XCTAssertEqual(model.subtitleKey, LocalizedStringKey("settings.subtitle"))
        XCTAssertEqual(model.editConflictResourceKey, LocalizedStringKey("editConflict.resource.settings"))
        XCTAssertEqual(model.exportTitleKey, LocalizedStringKey("settings.export.title"))
        XCTAssertEqual(model.exportSubtitleKey, LocalizedStringKey("settings.export.subtitle"))
        XCTAssertEqual(model.tourTitleKey, LocalizedStringKey("settings.tour.title"))
        XCTAssertEqual(model.tourDescriptionKey, LocalizedStringKey("settings.tour.description"))
        XCTAssertEqual(model.tourRestartKey, LocalizedStringKey("settings.tour.restart"))
        XCTAssertEqual(model.checklistTitleKey, LocalizedStringKey("settings.checklist.settings.title"))
        XCTAssertEqual(model.checklistDescriptionKey, LocalizedStringKey("settings.checklist.settings.description"))
        XCTAssertEqual(model.checklistRestartKey, LocalizedStringKey("settings.checklist.settings.restart"))
        XCTAssertEqual(model.checklistRestartedKey, LocalizedStringKey("settings.checklist.settings.restarted"))
    }

    // MARK: - Load states (web PageContainer loading gate)

    func testInitialStateIsLoading() {
        XCTAssertEqual(SettingsPageModel().state, .loading)
    }

    func testLoadResolvesToReadyOnSuccess() async {
        let model = SettingsPageModel(dataSource: SampleSettingsPageDataSource())
        await model.load()
        XCTAssertEqual(model.state, .ready)
        XCTAssertTrue(model.lastLoadSucceeded)
    }

    func testLoadResolvesToReadyOnFailure() async {
        // Web parity: PageContainer receives only `isLoading`, so a settings fetch failure still
        // renders the page's static action panels (no blocking error region).
        let model = SettingsPageModel(dataSource: FailingSettingsPageDataSource())
        await model.load()
        XCTAssertEqual(model.state, .ready)
        XCTAssertFalse(model.lastLoadSucceeded)
    }

    func testRefreshReloads() async {
        let model = SettingsPageModel(dataSource: SampleSettingsPageDataSource())
        await model.refresh()
        XCTAssertEqual(model.state, .ready)
        XCTAssertTrue(model.lastLoadSucceeded)
    }

    // MARK: - Checklist restart (web restartChecklist + toast)

    func testRestartChecklistInvokesStoreAndShowsConfirmation() {
        let store = InMemorySettingsChecklistStore()
        let model = SettingsPageModel(checklistStore: store)
        XCTAssertFalse(model.checklistRestarted)
        model.restartChecklist()
        XCTAssertEqual(store.restartCount, 1)
        XCTAssertTrue(model.checklistRestarted)
        model.dismissChecklistRestarted()
        XCTAssertFalse(model.checklistRestarted)
    }

    // MARK: - Tour launcher (web dispatchTourLauncherOpen)

    func testOpenTourLauncherInvokesLauncher() {
        let launcher = RecordingSettingsTourLauncher()
        let model = SettingsPageModel(tourLauncher: launcher)
        model.openTourLauncher()
        model.openTourLauncher()
        XCTAssertEqual(launcher.openCount, 2)
    }

    // MARK: - Edit conflict (web EditConflictBanner)

    func testDismissEditConflict() {
        let model = SettingsPageModel(hasEditConflict: true)
        XCTAssertTrue(model.hasEditConflict)
        model.dismissEditConflict()
        XCTAssertFalse(model.hasEditConflict)
    }

    // MARK: - Data export navigation (web <a href="/data-export">)

    func testDataExportRouteIsExports() {
        XCTAssertEqual(SettingsPageModel().dataExportRoute, .exports)
    }

    func testRestartStoreReusesWebStorageKeys() {
        XCTAssertEqual(UserDefaultsSettingsChecklistStore.dismissedKey, "teslasync:checklist:dismissed")
        XCTAssertEqual(UserDefaultsSettingsChecklistStore.completedAtKey, "teslasync:checklist:completed-at")
        XCTAssertEqual(
            NotificationTourLauncher.openLauncherNotification,
            Notification.Name("teslasync:tour:openLauncher")
        )
    }

    // MARK: - Route registration + deep links

    func testRouteRegistrationHostsSettingsPage() {
        let registry = SettingsPageRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.settingsPage))
        XCTAssertNotNil(registry.view(for: .settingsPage))
    }

    func testRouteRegistrationForwardsNavigation() {
        var navigated: AppRoute?
        let registry = SettingsPageRouteRegistration.registry(onNavigate: { navigated = $0 })
        XCTAssertNotNil(registry.view(for: .settingsPage))
        XCTAssertNil(navigated) // wiring is captured, not invoked at registration time
    }

    func testSettingsDeepLinksParseToSettingsPage() {
        XCTAssertEqual(AppRouteParser.parse(path: "/settings"), .settingsPage)
        XCTAssertEqual(AppRouteParser.parse(path: "/settings/overview"), .settingsPage)
    }

    func testSettingsPageRouteMetadata() {
        XCTAssertEqual(AppRoute.settingsPage.pathSegment, "settings/overview")
        XCTAssertEqual(AppRoute.settingsPage.path, "/settings/overview")
        XCTAssertEqual(AppRoute.settingsPage.group, .account)
    }

    func testNativeSettingsStillReachableViaAccount() {
        // The platform-native consolidated settings surface keeps owning `/account` (no regression).
        XCTAssertEqual(AppRouteParser.parse(path: "/account"), .settings)
        XCTAssertEqual(AppRouteParser.parse(path: "/account/sessions"), .accountSessions)
    }

    func testEveryRouteHasUniquePathSegment() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, AppRoute.allCases.count)
    }
}

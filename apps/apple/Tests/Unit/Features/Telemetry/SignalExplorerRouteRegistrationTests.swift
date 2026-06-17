//
//  SignalExplorerRouteRegistrationTests.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/SignalExplorer (Apple)
//
//  Route tests for the Signal Explorer surface: the web `/signal-explorer` path
//  resolves to a typed `SignalExplorerLink` (tolerating trailing slash, query, and
//  casing), every other path is rejected, and the factory builds the page.
//

import SwiftUI
import XCTest
@testable import TeslaSync

@MainActor
final class SignalExplorerRouteRegistrationTests: XCTestCase {
    func testPathResolvesToLink() {
        XCTAssertNotNil(SignalExplorerRouteRegistration.link(forPath: "/signal-explorer"))
    }

    func testPathToleratesTrailingSlashQueryAndCasing() {
        XCTAssertNotNil(SignalExplorerRouteRegistration.link(forPath: "/signal-explorer/"))
        XCTAssertNotNil(SignalExplorerRouteRegistration.link(forPath: "/Signal-Explorer"))
        XCTAssertNotNil(SignalExplorerRouteRegistration.link(forPath: "/signal-explorer?signals=BatteryLevel"))
    }

    func testUnrelatedPathsAreRejected() {
        XCTAssertNil(SignalExplorerRouteRegistration.link(forPath: "/signals"))
        XCTAssertNil(SignalExplorerRouteRegistration.link(forPath: "/signal-gaps"))
        XCTAssertNil(SignalExplorerRouteRegistration.link(forPath: "/dashboard"))
    }

    func testLinkIsValueStableForNavigation() {
        XCTAssertEqual(SignalExplorerLink(), SignalExplorerLink())
        XCTAssertEqual(Set([SignalExplorerLink(), SignalExplorerLink()]).count, 1)
    }

    func testFactoryBuildsPage() {
        _ = SignalExplorerRouteRegistration.make()
        _ = SignalExplorerRouteRegistration.make(model: SignalExplorerPageModel())
    }
}

import SwiftUI
import XCTest
@testable import TeslaSync

/// Route + registry tests for the Helix chatbot surface: the web `/chatbot` path resolves to the
/// `.chatbot` route, the route is grouped + iconned with a unique path segment, and the
/// registration hosts the page so the shell can render it.
@MainActor
final class ChatbotRouteRegistrationTests: XCTestCase {
    func testPathResolvesToRoute() {
        XCTAssertEqual(AppRouteParser.parse(path: "/chatbot"), .chatbot)
        XCTAssertEqual(AppRoute.chatbot.pathSegment, "chatbot")
        XCTAssertEqual(AppRoute.chatbot.path, "/chatbot")
    }

    func testRouteIsGroupedAndIconned() {
        XCTAssertEqual(AppRoute.chatbot.group, .account)
        XCTAssertTrue(AppRoute.routes(in: .account).contains(.chatbot))
        XCTAssertFalse(AppRoute.chatbot.systemImage.isEmpty)
    }

    func testPathSegmentIsUnique() {
        let segments = AppRoute.allCases.map(\.pathSegment)
        XCTAssertEqual(Set(segments).count, AppRoute.allCases.count)
    }

    func testDeepLinkToleratesTrailingSlashAndCasing() throws {
        XCTAssertEqual(AppRouteParser.parse(path: "/Chatbot/"), .chatbot)
        XCTAssertEqual(try AppRouteParser.parse(url: XCTUnwrap(URL(string: "teslasync://chatbot"))), .chatbot)
    }

    func testRegistrationHostsThePage() {
        let registry = ChatbotRouteRegistration.registry()
        XCTAssertTrue(registry.registeredRoutes.contains(.chatbot))
        XCTAssertNotNil(registry.view(for: .chatbot))
    }

    func testRegistrationPreservesBaseRoutes() {
        var base = AppRouteHostRegistry()
        base.register(.dashboard) { EmptyView() }
        let registry = ChatbotRouteRegistration.registry(base: base)
        XCTAssertNotNil(registry.view(for: .dashboard)) // base registration is preserved
        XCTAssertNotNil(registry.view(for: .chatbot))
    }
}

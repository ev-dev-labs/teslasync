//
//  RegexTester.ViewTests.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  Per-state view-render smoke tests for the regex-tester surface: every render
//  state (idle / matches / no-match / invalid-pattern) materializes through
//  `ImageRenderer`. The model is a pure local transform, so the tests run with no
//  network and no real store.
//

#if canImport(UIKit) || canImport(AppKit)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class RegexTesterViewStateTests: XCTestCase {
        private struct SilentTelemetry: RegexTesterTelemetry {
            func viewOpened(surface _: String) {}
        }

        private func renders(pattern: String, flags: RegexFlags, test: String) -> Bool {
            let model = RegexTesterModel(
                pattern: pattern,
                flags: flags,
                testString: test,
                telemetry: SilentTelemetry()
            )
            model.start()
            let renderer = ImageRenderer(content: RegexTester(model: model).frame(width: 440, height: 600))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        func testIdleRenders() {
            XCTAssertTrue(renders(pattern: "", flags: .global, test: ""))
        }

        func testMatchesRender() {
            XCTAssertTrue(renders(pattern: "\\d+", flags: .global, test: "a1 b22 c333"))
        }

        func testCaseInsensitiveMatchesRender() {
            XCTAssertTrue(renders(pattern: "tesla", flags: .globalCaseInsensitive, test: "Tesla TESLA tesla"))
        }

        func testNoMatchRenders() {
            XCTAssertTrue(renders(pattern: "zzz", flags: .global, test: "nothing to find here"))
        }

        func testInvalidPatternRenders() {
            XCTAssertTrue(renders(pattern: "(unclosed", flags: .global, test: "anything"))
        }
    }
#endif

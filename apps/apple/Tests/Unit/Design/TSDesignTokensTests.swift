import XCTest
@testable import TeslaSync

/// Design-token presence + drift tests: assert the generated `Tokens.swift`
/// stays in sync with `apps/design/tokens.json` and exposes a usable scale.
@MainActor final class TSDesignTokensTests: XCTestCase {
    private struct ChartTokens: Decodable { let categorical: [String] }
    private struct TokenFile: Decodable { let chart: ChartTokens }

    func testChartPaletteMatchesTokenSourceCount() throws {
        let tokens = try loadTokens()
        XCTAssertEqual(
            TSChartPalette.categorical.count,
            tokens.chart.categorical.count,
            "Generated chart palette drifted from apps/design/tokens.json"
        )
        XCTAssertFalse(TSChartPalette.categorical.isEmpty)
    }

    func testChartPaletteIndexWraps() {
        let count = TSChartPalette.categorical.count
        try? XCTSkipIf(count == 0)
        XCTAssertEqual(TSChartPalette.color(at: count), TSChartPalette.categorical[0])
        XCTAssertEqual(TSChartPalette.color(at: -1), TSChartPalette.categorical[count - 1])
    }

    func testSpacingScaleIsMonotonic() {
        let scale: [CGFloat] = [
            TSSpacing.none, TSSpacing.xs, TSSpacing.sm, TSSpacing.md, TSSpacing.lg,
            TSSpacing.xl, TSSpacing.x2xl, TSSpacing.x3xl, TSSpacing.x4xl
        ]
        XCTAssertEqual(scale, scale.sorted())
        XCTAssertEqual(TSSpacing.none, 0)
    }

    func testMotionDurationsOrdered() {
        XCTAssertGreaterThan(TSMotion.fastDuration, 0)
        XCTAssertLessThan(TSMotion.fastDuration, TSMotion.normalDuration)
        XCTAssertLessThan(TSMotion.normalDuration, TSMotion.slowDuration)
    }

    func testReduceMotionDisablesAnimation() {
        XCTAssertNil(TSAnimation.standard(reduceMotion: true))
        XCTAssertNotNil(TSAnimation.standard(reduceMotion: false))
    }

    private func loadTokens() throws -> TokenFile {
        let data = try Data(contentsOf: Self.tokensURL())
        return try JSONDecoder().decode(TokenFile.self, from: data)
    }

    private static func tokensURL() throws -> URL {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0 ..< 9 {
            let candidate = directory.appendingPathComponent("apps/design/tokens.json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            directory = directory.deletingLastPathComponent()
        }
        throw XCTSkip("apps/design/tokens.json not found relative to \(#filePath)")
    }
}

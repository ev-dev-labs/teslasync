import XCTest
@testable import TeslaSync

/// Golden-vector parity: runs the shared `apps/shared/spec/units-golden.json`
/// fixtures through the Swift `Units` facade and asserts identical conversion +
/// formatting to the KMP core. This is the SI-parity proof the spec requires.
final class UnitsGoldenVectorTests: XCTestCase {
    private struct Preference: Decodable {
        let distance: String
        let speed: String
        let temperature: String
        let pressure: String
        let energy: String
        let duration: String
        let power: String
        let locale: String?
    }

    private struct GoldenCase: Decodable {
        let fn: String
        let formatter: String
        let quantity: String
        let system: String
        let inputSi: Double
        let preference: Preference
        let expectedValue: Double
        let expectedFormatted: String
    }

    func testConversionAndFormattingMatchKotlinGoldenVectors() throws {
        let cases = try loadGoldenCases()
        XCTAssertFalse(cases.isEmpty, "Golden fixture should contain cases")

        for golden in cases {
            let prefs = UnitPreferences(
                distance: golden.preference.distance,
                speed: golden.preference.speed,
                temperature: golden.preference.temperature,
                pressure: golden.preference.pressure,
                energy: golden.preference.energy,
                duration: golden.preference.duration,
                power: golden.preference.power,
                locale: golden.preference.locale
            )
            let label = "\(golden.quantity)/\(golden.system) input=\(golden.inputSi)"

            let value = convert(golden.quantity, golden.inputSi, prefs)
            XCTAssertEqual(value, golden.expectedValue, accuracy: 1e-6, "convert \(label)")

            let formatted = format(golden.quantity, golden.inputSi, prefs)
            XCTAssertEqual(formatted, golden.expectedFormatted, "format \(label)")
        }
    }

    private func convert(_ quantity: String, _ inputSi: Double, _ prefs: UnitPreferences) -> Double {
        switch quantity {
        case "distance": Units.convertDistance(inputSi, prefs)
        case "speed": Units.convertSpeed(inputSi, prefs)
        case "temperature": Units.convertTemperature(inputSi, prefs)
        case "pressure": Units.convertPressure(inputSi, prefs)
        case "energy": Units.convertEnergy(inputSi, prefs)
        case "duration": Units.convertDuration(inputSi, prefs)
        case "power": Units.convertPower(inputSi, prefs)
        default: .nan
        }
    }

    private func format(_ quantity: String, _ inputSi: Double, _ prefs: UnitPreferences) -> String {
        switch quantity {
        case "distance": Units.formatDistance(inputSi, prefs)
        case "speed": Units.formatSpeed(inputSi, prefs)
        case "temperature": Units.formatTemperature(inputSi, prefs)
        case "pressure": Units.formatPressure(inputSi, prefs)
        case "energy": Units.formatEnergy(inputSi, prefs)
        case "duration": Units.formatDuration(inputSi, prefs)
        case "power": Units.formatPower(inputSi, prefs)
        default: ""
        }
    }

    private func loadGoldenCases() throws -> [GoldenCase] {
        let url = try Self.goldenFixtureURL()
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode([GoldenCase].self, from: data)
    }

    /// Walks up from this test file to the repo and locates the shared fixture,
    /// so the golden vectors stay single-sourced (no duplicated copy in the app).
    private static func goldenFixtureURL() throws -> URL {
        let relativePath = "apps/shared/spec/units-golden.json"
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0 ..< 8 {
            let candidate = directory.appendingPathComponent(relativePath)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
            directory = directory.deletingLastPathComponent()
        }
        throw XCTSkip("Shared golden fixture not found relative to \(#filePath)")
    }
}

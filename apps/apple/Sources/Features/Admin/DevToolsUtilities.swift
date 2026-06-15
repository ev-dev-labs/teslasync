import CryptoKit
import Foundation

// MARK: - Pure compute for the client-side utility tools (web devtools `tools/*` + `helpers.ts`)

/// Locale-free, dependency-free compute backing every Utilities tool. Each function
/// mirrors the corresponding web tool / helper so the SwiftUI widgets stay thin and the
/// logic is unit-testable. No networking, no shared mutable state (all `static`). The
/// converters/decoders live in `DevToolsUtilities+Format` / `+Patterns` extensions.
public enum DevToolsUtilities {
    // MARK: VIN decoder (web `VinDecoderTool`)

    /// Decoded VIN fields (web `VinDecoder` `decoded`). Empty strings mark unmapped codes.
    public struct VINDecode: Equatable, Sendable {
        public let manufacturer: String
        public let model: String
        public let driveType: String
        public let year: String
        public let plant: String
        public let serial: String
    }

    /// Decodes a Tesla VIN using the same character positions as the web tool
    /// (`<11` chars → nil). Unmapped codes resolve to "" so the view can show "Unknown".
    public static func decodeVIN(_ vin: String) -> VINDecode? {
        let upper = vin.uppercased()
        guard upper.count >= 11 else { return nil }
        let chars = Array(upper)
        let reference = DevToolsReferenceData.self
        return VINDecode(
            manufacturer: reference.vinManufacturers[String(chars[0 ..< 3])] ?? "",
            model: reference.vinModels[String(chars[3])] ?? "",
            driveType: reference.vinDrive[String(chars[7])] ?? "",
            year: reference.vinYear[String(chars[9])] ?? "",
            plant: reference.vinPlant[String(chars[10])] ?? "",
            serial: String(chars[11...])
        )
    }

    // MARK: Base64 (web `Base64Tool`)

    public static func base64Encode(_ input: String) -> String {
        Data(input.utf8).base64EncodedString()
    }

    public static func base64Decode(_ input: String) -> String? {
        guard let data = Data(base64Encoded: input), let text = String(data: data, encoding: .utf8) else {
            return nil
        }
        return text
    }

    // MARK: URL encode/decode (web `UrlEncoderTool`)

    /// Characters left unescaped by JavaScript `encodeURIComponent`.
    private static let uriComponentAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    public static func urlEncode(_ input: String) -> String {
        input.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed) ?? input
    }

    public static func urlDecode(_ input: String) -> String? {
        input.removingPercentEncoding
    }

    // MARK: JSON formatter (web `JsonFormatterTool`)

    /// Result of formatting JSON (web `{ formatted, error }`). Exactly one is non-empty.
    public struct JSONResult: Equatable, Sendable {
        public let formatted: String
        public let error: String
    }

    /// Pretty-prints JSON or returns a parse-error message (web `JSON.parse` catch).
    public static func formatJSON(_ input: String) -> JSONResult {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return JSONResult(formatted: "", error: "") }
        let data = Data(input.utf8)
        do {
            let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            let pretty = try JSONSerialization.data(
                withJSONObject: object,
                options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]
            )
            guard let text = String(data: pretty, encoding: .utf8) else {
                return JSONResult(formatted: "", error: "Invalid JSON")
            }
            return JSONResult(formatted: text, error: "")
        } catch {
            return JSONResult(formatted: "", error: error.localizedDescription)
        }
    }

    // MARK: UUID + SHA-256 (web `UuidGeneratorTool` / `HashCalculatorTool`)

    public static func generateUUID() -> String {
        UUID().uuidString.lowercased()
    }

    public static func sha256Hex(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Shared helpers (used by the Format / Patterns extensions)

    /// Left-pads a numeric string to two digits (web cron `padStart(2, '0')`).
    static func pad(_ value: String) -> String {
        value.count >= 2 ? value : String(repeating: "0", count: 2 - value.count) + value
    }

    /// Formats a number to at most `decimals` fraction digits, locale-free, trailing
    /// zeros trimmed (a deterministic stand-in for the web `fmtNumber`).
    static func trimmedNumber(_ value: Double, decimals: Int) -> String {
        if decimals == 0 { return String(format: "%.0f", value.rounded()) }
        var text = String(format: "%.\(decimals)f", value)
        while text.contains("."), text.hasSuffix("0") {
            text.removeLast()
        }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }
}

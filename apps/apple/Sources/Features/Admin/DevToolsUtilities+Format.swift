import Foundation

// MARK: - Byte / color / JWT / permission compute (web devtools tools)

public extension DevToolsUtilities {
    // MARK: Byte size (web `ByteSizeConverterTool`)

    struct ByteConversion: Equatable, Sendable {
        public let unit: String
        public let value: String
    }

    /// Converts a value in `unit` to every byte unit (web `ByteSizeConverter` conversions).
    static func convertBytes(value: Double, unit: String) -> [ByteConversion]? {
        let units = DevToolsReferenceData.byteUnits
        guard let unitIndex = units.firstIndex(of: unit) else { return nil }
        let bytes = value * pow(1024, Double(unitIndex))
        return units.enumerated().map { offset, name in
            let converted = bytes / pow(1024, Double(offset))
            return ByteConversion(unit: name, value: trimmedNumber(converted, decimals: offset == 0 ? 0 : 4))
        }
    }

    // MARK: Color (web `ColorConverterTool` + `helpers.rgbToHsl`)

    struct RGB: Equatable, Sendable {
        public let red: Int
        public let green: Int
        public let blue: Int
    }

    struct HSL: Equatable, Sendable {
        public let hue: Int
        public let saturation: Int
        public let lightness: Int
    }

    static func hexToRGB(_ hex: String) -> RGB? {
        let clean = hex.replacingOccurrences(of: "#", with: "")
        guard clean.count == 6 else { return nil }
        let chars = Array(clean)
        func component(_ start: Int) -> Int? {
            Int(String(chars[start ..< start + 2]), radix: 16)
        }
        guard let red = component(0), let green = component(2), let blue = component(4) else {
            return nil
        }
        return RGB(red: red, green: green, blue: blue)
    }

    /// Ports web `helpers.rgbToHsl` (HSL components as whole degrees / percentages).
    static func rgbToHSL(_ rgb: RGB) -> HSL {
        let red = Double(rgb.red) / 255
        let green = Double(rgb.green) / 255
        let blue = Double(rgb.blue) / 255
        let maxValue = max(red, green, blue)
        let minValue = min(red, green, blue)
        let lightness = (maxValue + minValue) / 2
        guard maxValue != minValue else {
            return HSL(hue: 0, saturation: 0, lightness: Int((lightness * 100).rounded()))
        }
        let delta = maxValue - minValue
        let saturation = lightness > 0.5 ? delta / (2 - maxValue - minValue) : delta / (maxValue + minValue)
        let hue = hueComponent(red: red, green: green, blue: blue, maxValue: maxValue, delta: delta)
        return HSL(
            hue: Int((hue * 360).rounded()),
            saturation: Int((saturation * 100).rounded()),
            lightness: Int((lightness * 100).rounded())
        )
    }

    private static func hueComponent(
        red: Double,
        green: Double,
        blue: Double,
        maxValue: Double,
        delta: Double
    ) -> Double {
        if maxValue == red {
            return ((green - blue) / delta + (green < blue ? 6 : 0)) / 6
        }
        if maxValue == green {
            return ((blue - red) / delta + 2) / 6
        }
        return ((red - green) / delta + 4) / 6
    }

    // MARK: JWT decoder (web `JwtDecoderTool`)

    struct JWTDecode: Equatable, Sendable {
        public let header: String
        public let payload: String
    }

    /// Decodes the (unverified) header + payload of a JWT, pretty-printing each as JSON.
    static func decodeJWT(_ token: String) -> JWTDecode? {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count >= 2 else { return nil }
        guard let header = decodeJWTSegment(String(parts[0])) else { return nil }
        guard let payload = decodeJWTSegment(String(parts[1])) else { return nil }
        return JWTDecode(header: header, payload: payload)
    }

    private static func decodeJWTSegment(_ segment: String) -> String? {
        var base64 = segment
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64 += "="
        }
        guard let data = Data(base64Encoded: base64) else { return nil }
        return prettyJSON(from: data) ?? String(data: data, encoding: .utf8)
    }

    private static func prettyJSON(from data: Data) -> String? {
        let readOptions: JSONSerialization.ReadingOptions = [.fragmentsAllowed]
        let writeOptions: JSONSerialization.WritingOptions = [.prettyPrinted, .sortedKeys, .fragmentsAllowed]
        guard let object = try? JSONSerialization.jsonObject(with: data, options: readOptions) else { return nil }
        guard let pretty = try? JSONSerialization.data(withJSONObject: object, options: writeOptions) else {
            return nil
        }
        return String(data: pretty, encoding: .utf8)
    }

    // MARK: Unix permission (web `UnixPermissionTool`)

    struct UnixPermission: Equatable, Sendable {
        public let owner: String
        public let group: String
        public let other: String

        public var symbolic: String {
            owner + group + other
        }
    }

    /// Decodes a 3-digit octal mode to symbolic notation (web `UnixPermissionTool`).
    static func decodePermission(_ octal: String) -> UnixPermission? {
        guard octal.count == 3, octal.allSatisfy({ ("0" ... "7").contains($0) }) else { return nil }
        let chars = Array(octal)
        let bits = DevToolsReferenceData.permissionBits
        guard let owner = bits[String(chars[0])],
              let group = bits[String(chars[1])],
              let other = bits[String(chars[2])]
        else {
            return nil
        }
        return UnixPermission(owner: owner, group: group, other: other)
    }
}

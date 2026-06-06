import Foundation

/// Privacy redaction applied by the publisher before anything is cached for the
/// widgets (ADR-005/ADR-013 — no token or precise-location leakage). Redaction is
/// belt-and-braces: the snapshot models already omit coordinates and VINs, and
/// these helpers scrub free-text fields that could otherwise carry them.
public enum WidgetRedaction {
    /// Max characters kept for a display name shown on a small widget.
    public static let maxNameLength = 24

    /// A VIN is 17 chars of A–Z/0–9 (no I/O/Q). Used to strip an accidental VIN.
    private static let vinPattern = "[A-HJ-NPR-Z0-9]{17}"

    /// Trims a vehicle display name: removes any embedded VIN, collapses
    /// whitespace, and truncates. Empty input falls back to a neutral label.
    public static func vehicleName(_ raw: String, fallback: String = "Vehicle") -> String {
        let stripped = stripVIN(raw)
        let collapsed = stripped
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let trimmed = collapsed.isEmpty ? fallback : collapsed
        return truncate(trimmed, to: maxNameLength)
    }

    /// Returns a coarse place label suitable for display, or `nil` if the input is
    /// empty or looks like raw coordinates (which must never be cached).
    public static func coarseLocation(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !looksLikeCoordinates(trimmed) else { return nil }
        return truncate(trimmed, to: maxNameLength)
    }

    /// Removes any substring that matches the VIN shape.
    public static func stripVIN(_ raw: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: vinPattern) else { return raw }
        let range = NSRange(raw.startIndex..., in: raw)
        return regex.stringByReplacingMatches(in: raw, range: range, withTemplate: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Heuristic: a string of digits, signs, dots, and a separator is likely a raw
    /// `lat,long` pair and must not be surfaced.
    public static func looksLikeCoordinates(_ value: String) -> Bool {
        let allowed = CharacterSet(charactersIn: "0123456789.,-+ ")
        guard value.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return false }
        let digits = value.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) }
        return digits.count >= 4 && (value.contains(",") || value.contains(" "))
    }

    private static func truncate(_ value: String, to limit: Int) -> String {
        guard value.count > limit else { return value }
        let end = value.index(value.startIndex, offsetBy: limit - 1)
        return String(value[..<end]) + "…"
    }
}

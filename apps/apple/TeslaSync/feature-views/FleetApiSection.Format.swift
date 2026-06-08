//
//  FleetApiSection.Format.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The formatting + state-resolution half of the pure adapter: number / int /
//  date / relative-time formatters (ports of `fmtInt`, `formatDateTime`,
//  `getRelativeTime`), the `JSON.stringify(…, null, 2)` pretty-printer, the section
//  shell phase + freshness resolution, the canonical onboarding step catalog (port
//  of `ONBOARDING_STEPS`), and the VoiceOver copy. Foundation-only + pure.
//

import Foundation

public extension FleetApiBuilder {
    // MARK: Number / int formatting (port of `fmtInt` / number stringify)

    /// Stringifies a JSON number the way the web does: integers drop the decimal,
    /// fractionals keep their natural representation.
    static func formatNumber(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// Formats an integer with locale grouping separators (port of `fmtInt` →
    /// `toLocaleString` with 0 fraction digits).
    static func formatInt(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    // MARK: Date formatting (port of `formatDateTime`)

    /// Formats an ISO-8601 timestamp as a localized medium-date + short-time string,
    /// falling back to the raw value when it is blank or unparseable (the web
    /// `formatDateTime` renders an em dash for empty input — handled by callers).
    static func formatDateTime(_ iso: String) -> String {
        guard !iso.isEmpty else { return "—" }
        guard let date = parseISO(iso) else { return iso }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    // MARK: Relative time (port of `getRelativeTime`)

    /// A localized "just now / 5m ago / 2h ago / 3d ago" label.
    static func relativeTime(since date: Date, now: Date = Date()) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        if seconds < 60 {
            return FleetApiStrings.string("devtools.fleet.justNow", "just now")
        }
        if seconds < 3600 {
            return FleetApiStrings.count("devtools.fleet.minutesAgo", "%lldm ago", seconds / 60)
        }
        if seconds < 86400 {
            return FleetApiStrings.count("devtools.fleet.hoursAgo", "%lldh ago", seconds / 3600)
        }
        return FleetApiStrings.count("devtools.fleet.daysAgo", "%lldd ago", seconds / 86400)
    }

    // MARK: Pretty JSON (port of `JSON.stringify(data, null, 2)`)

    /// Serializes a value with sorted keys + two-space indentation, matching the
    /// `ResultPanel` `<pre>` output the operator copies.
    static func prettyJSON(_ value: JSONValue) -> String {
        serialize(value, indent: 0)
    }

    private static func serialize(_ value: JSONValue, indent: Int) -> String {
        let pad = String(repeating: "  ", count: indent)
        let childPad = String(repeating: "  ", count: indent + 1)
        switch value {
        case let .object(object):
            guard !object.isEmpty else { return "{}" }
            let body = object.keys.sorted().map { key in
                "\(childPad)\(encodeString(key)): \(serialize(object[key] ?? .null, indent: indent + 1))"
            }
            return "{\n\(body.joined(separator: ",\n"))\n\(pad)}"
        case let .array(array):
            guard !array.isEmpty else { return "[]" }
            let body = array.map { "\(childPad)\(serialize($0, indent: indent + 1))" }
            return "[\n\(body.joined(separator: ",\n"))\n\(pad)]"
        case let .string(string):
            return encodeString(string)
        case let .number(number):
            return formatNumber(number)
        case let .bool(bool):
            return bool ? "true" : "false"
        case .null:
            return "null"
        }
    }

    private static func encodeString(_ value: String) -> String {
        var escaped = ""
        for character in value.unicodeScalars {
            switch character {
            case "\"": escaped += "\\\""
            case "\\": escaped += "\\\\"
            case "\n": escaped += "\\n"
            case "\t": escaped += "\\t"
            case "\r": escaped += "\\r"
            default: escaped.unicodeScalars.append(character)
            }
        }
        return "\"\(escaped)\""
    }

    // MARK: Section phase + freshness

    /// Resolves the section shell branch from the two shared queries + vehicle
    /// presence: both still loading → loading; both failed → error; everything
    /// resolved with nothing usable → empty; otherwise content.
    static func resolveSectionPhase(
        fleetInfo: FleetQuery,
        publicKeyStatus: FleetQuery,
        hasVehicles: Bool
    ) -> FleetRenderPhase {
        if case .loading = fleetInfo, case .loading = publicKeyStatus {
            return .loading
        }
        if case let .failed(message) = fleetInfo, case .failed = publicKeyStatus {
            return .error(message)
        }
        if isResolvedEmpty(fleetInfo), isResolvedEmpty(publicKeyStatus), !hasVehicles {
            return .empty
        }
        return .content
    }

    private static func isResolvedEmpty(_ query: FleetQuery) -> Bool {
        guard case let .loaded(value) = query else { return false }
        return (value.objectValue ?? [:]).isEmpty
    }

    /// Resolves the freshness chip status (offline ▸ error ▸ fetching ▸ stale ▸
    /// fresh), mirroring the web `DataFreshness` precedence with the offline add.
    static func resolveFreshness(
        connection: FleetConnection,
        isFetching: Bool,
        isError: Bool
    ) -> FleetFreshness {
        if connection == .offline { return .offline }
        if isError { return .error }
        if isFetching { return .fetching }
        if connection == .stale { return .stale }
        return .fresh
    }
}

// MARK: - Canonical content (port of `ONBOARDING_STEPS`)

/// The onboarding step catalog, ported from `ONBOARDING_STEPS`. Labels + details
/// resolve through the surface i18n table; lucide icons map to SF Symbols.
public enum FleetApiContent {
    public static func onboardingSteps() -> [OnboardingStep] {
        [
            step(
                "account",
                "Tesla Developer Account",
                "Create a Tesla Developer account at developer.tesla.com",
                "key.horizontal"
            ),
            step(
                "application",
                "Create Application",
                "Register a new application in the Tesla Developer Portal",
                "doc.text"
            ),
            step(
                "keypair",
                "Generate Key Pair",
                "Generate an EC private/public key pair for Fleet API authentication",
                "key"
            ),
            step(
                "register",
                "Register Partner",
                "Register as a Fleet API partner with your public key",
                "globe"
            ),
            step(
                "auth",
                "Authorize Account",
                "Complete OAuth2 authorization to get API access tokens",
                "checkmark.shield"
            ),
            step(
                "pair",
                "Pair Vehicle Key",
                "Pair your public key with each vehicle for command access",
                "link"
            ),
            step(
                "telemetry",
                "Fleet Telemetry",
                "Configure Fleet Telemetry streaming for real-time data",
                "dot.radiowaves.left.and.right"
            )
        ]
    }

    private static func step(_ id: String, _ label: String, _ detail: String, _ symbol: String) -> OnboardingStep {
        OnboardingStep(
            id: id,
            label: FleetApiStrings.string("devtools.onboarding.\(id).label", label),
            detail: FleetApiStrings.string("devtools.onboarding.\(id).desc", detail),
            systemImage: symbol
        )
    }
}

// MARK: - Accessibility copy (testable seam)

/// VoiceOver copy for the section chrome. Pure + public so the spoken content can
/// be unit-tested without rendering the view.
public enum FleetApiAccessibility {
    /// "Setup progress, 3 of 7 complete" for the wizard progress bar.
    public static func progressLabel(_ progress: OnboardingProgress) -> String {
        let format = FleetApiStrings.string(
            "devtools.onboarding.progressA11y",
            "Setup progress, %1$lld of %2$lld complete"
        )
        return String(format: format, progress.completed, progress.total)
    }

    /// The localized freshness label spoken by the chip / used as its value.
    public static func freshnessLabel(_ freshness: FleetFreshness) -> String {
        switch freshness {
        case .fresh: FleetApiStrings.string("devtools.fleet.freshness.live", "Live")
        case .fetching: FleetApiStrings.string("devtools.fleet.freshness.updating", "Updating…")
        case .stale: FleetApiStrings.string("devtools.fleet.freshness.stale", "Stale")
        case .error: FleetApiStrings.string("devtools.fleet.freshness.error", "Error")
        case .offline: FleetApiStrings.string("devtools.fleet.freshness.offline", "Offline")
        }
    }

    /// "POST timestamp, error E123, message …" for one telemetry-error row.
    public static func errorRowLabel(_ row: TelemetryErrorRow) -> String {
        var parts: [String] = []
        parts.append(row.timestamp.isEmpty ? FleetApiStrings.string("devtools.fleet.noTime", "no timestamp")
            : FleetApiBuilder.formatDateTime(row.timestamp))
        if !row.code.isEmpty {
            parts.append(FleetApiStrings.format("devtools.fleet.codeA11y", "code %@", row.code))
        }
        if !row.message.isEmpty { parts.append(row.message) }
        return parts.joined(separator: ", ")
    }
}

import SwiftUI

// MARK: - Static catalog (web devtools `constants.ts`)

/// All static, vehicle-agnostic developer-tools reference data — the native
/// equivalent of the web `constants.ts` plus the `useToolList` registry. Pure
/// value data with no networking, matching the manifest's "renders from local state".
public enum DevToolsCatalog {
    public static let onboardingSteps: [DevToolsOnboardingStep] = [
        DevToolsOnboardingStep(
            id: "account",
            titleKey: "devtools.onboarding.account.title",
            detailKey: "devtools.onboarding.account.detail",
            systemImage: "key.horizontal.fill"
        ),
        DevToolsOnboardingStep(
            id: "application",
            titleKey: "devtools.onboarding.application.title",
            detailKey: "devtools.onboarding.application.detail",
            systemImage: "doc.text.fill"
        ),
        DevToolsOnboardingStep(
            id: "keypair",
            titleKey: "devtools.onboarding.keypair.title",
            detailKey: "devtools.onboarding.keypair.detail",
            systemImage: "key.fill"
        ),
        DevToolsOnboardingStep(
            id: "register",
            titleKey: "devtools.onboarding.register.title",
            detailKey: "devtools.onboarding.register.detail",
            systemImage: "globe"
        ),
        DevToolsOnboardingStep(
            id: "auth",
            titleKey: "devtools.onboarding.auth.title",
            detailKey: "devtools.onboarding.auth.detail",
            systemImage: "checkmark.shield.fill"
        ),
        DevToolsOnboardingStep(
            id: "pair",
            titleKey: "devtools.onboarding.pair.title",
            detailKey: "devtools.onboarding.pair.detail",
            systemImage: "link"
        ),
        DevToolsOnboardingStep(
            id: "telemetry",
            titleKey: "devtools.onboarding.telemetry.title",
            detailKey: "devtools.onboarding.telemetry.detail",
            systemImage: "dot.radiowaves.left.and.right"
        )
    ]

    public static let teslaEndpoints: [DevToolsTeslaEndpoint] = [
        endpoint("GET", "/api/1/vehicles", "List vehicles"),
        endpoint("GET", "/api/1/vehicles/{id}/vehicle_data", "Get vehicle data"),
        endpoint("POST", "/api/1/vehicles/{id}/command/wake_up", "Wake up vehicle"),
        endpoint("POST", "/api/1/vehicles/{id}/command/door_lock", "Lock doors"),
        endpoint("POST", "/api/1/vehicles/{id}/command/door_unlock", "Unlock doors"),
        endpoint("POST", "/api/1/vehicles/{id}/command/flash_lights", "Flash lights"),
        endpoint("POST", "/api/1/vehicles/{id}/command/honk_horn", "Honk horn"),
        endpoint("POST", "/api/1/vehicles/{id}/command/set_charge_limit", "Set charge limit"),
        endpoint("POST", "/api/1/vehicles/{id}/command/charge_start", "Start charging"),
        endpoint("POST", "/api/1/vehicles/{id}/command/charge_stop", "Stop charging"),
        endpoint("GET", "/api/1/vehicles/{id}/nearby_charging_sites", "Nearby chargers")
    ]

    public static let infraTools: [DevToolsInfraTool] = [
        DevToolsInfraTool(
            id: "db-stats",
            nameKey: "devtools.infra.dbStats.name",
            detailKey: "devtools.infra.dbStats.detail",
            endpoint: "db-stats",
            method: "GET",
            systemImage: "cylinder.split.1x2.fill",
            tone: .info
        ),
        DevToolsInfraTool(
            id: "migration-status",
            nameKey: "devtools.infra.migrations.name",
            detailKey: "devtools.infra.migrations.detail",
            endpoint: "migration-status",
            method: "GET",
            systemImage: "arrow.triangle.branch",
            tone: .success
        ),
        DevToolsInfraTool(
            id: "mqtt-test",
            nameKey: "devtools.infra.mqtt.name",
            detailKey: "devtools.infra.mqtt.detail",
            endpoint: "mqtt-test",
            method: "POST",
            systemImage: "dot.radiowaves.left.and.right",
            tone: .warning
        ),
        DevToolsInfraTool(
            id: "env-check",
            nameKey: "devtools.infra.env.name",
            detailKey: "devtools.infra.env.detail",
            endpoint: "env-check",
            method: "GET",
            systemImage: "checkmark.shield.fill",
            tone: .accent
        ),
        DevToolsInfraTool(
            id: "runtime-info",
            nameKey: "devtools.infra.runtime.name",
            detailKey: "devtools.infra.runtime.detail",
            endpoint: "runtime-info",
            method: "GET",
            systemImage: "cpu.fill",
            tone: .warning
        )
    ]

    public static let referenceLinks: [DevToolsReferenceLink] = [
        DevToolsReferenceLink(
            id: "fleetOverview",
            titleKey: "devtools.ref.fleetOverview",
            urlString: "https://developer.tesla.com/docs/fleet-api",
            systemImage: "book.fill"
        ),
        DevToolsReferenceLink(
            id: "partnerEndpoints",
            titleKey: "devtools.ref.partnerEndpoints",
            urlString: "https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register",
            systemImage: "globe"
        ),
        DevToolsReferenceLink(
            id: "devPortal",
            titleKey: "devtools.ref.devPortal",
            urlString: "https://developer.tesla.com",
            systemImage: "arrow.up.right.square"
        ),
        DevToolsReferenceLink(
            id: "telemetryGuide",
            titleKey: "devtools.ref.telemetryGuide",
            urlString: "https://developer.tesla.com/docs/fleet-api/fleet-telemetry",
            systemImage: "dot.radiowaves.left.and.right"
        )
    ]

    /// The client-side utility registry (web `useToolList()`), in source order.
    public static let utilityTools: [DevToolsUtilityTool] = [
        tool("vin", "Vin Decoder", "Decode a Tesla VIN into make, model, year and plant", "car.fill", .info),
        tool("jwt", "Jwt Decoder", "Decode JWT header and payload without verifying", "key.fill", .accent),
        tool("timestamp", "Timestamp", "Convert between Unix epoch and human dates", "clock.fill", .success),
        tool("base64", "Base64", "Encode and decode Base64 text", "curlybraces", .warning),
        tool("url", "URL Encoder", "Percent-encode and decode URL components", "link", .info),
        tool("json", "JSON Formatter", "Validate and pretty-print JSON", "curlybraces.square", .success),
        tool("uuid", "UUID Generator", "Generate random version-4 UUIDs", "touchid", .accent),
        tool("hash", "Hash Calculator", "Compute a SHA-256 digest of text", "number", .danger),
        tool("bytes", "Byte Size", "Convert byte counts to human units", "internaldrive.fill", .info),
        tool("color", "Color Converter", "Convert between HEX, RGB and HSL", "paintpalette.fill", .accent),
        tool("cron", "Cron Parser", "Describe a 5-field cron expression", "timer", .success),
        tool("http", "HTTP Status", "Look up HTTP status code meanings", "network", .warning),
        tool("tesla-api", "Tesla API Reference", "Browse common Tesla Fleet API endpoints", "book.fill", .info),
        tool("regex", "Regex Tester", "Test a regular expression against sample text", "textformat.abc", .danger),
        tool("unix-perm", "Unix Permission", "Decode octal file permissions to symbolic", "lock.fill", .success)
    ]

    /// Filters the utility registry by a case-insensitive query over name+description
    /// (web `ClientUtilitiesSection` search). An empty/whitespace query returns all.
    public static func filterTools(_ query: String) -> [DevToolsUtilityTool] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else { return utilityTools }
        return utilityTools.filter { $0.searchText.contains(trimmed) }
    }

    // MARK: - Builders

    private static func endpoint(
        _ method: String,
        _ path: String,
        _ detail: String
    ) -> DevToolsTeslaEndpoint {
        DevToolsTeslaEndpoint(method: method, path: path, detail: detail)
    }

    private static func tool(
        _ id: String,
        _ name: String,
        _ detail: String,
        _ systemImage: String,
        _ tone: DevToolsTone
    ) -> DevToolsUtilityTool {
        DevToolsUtilityTool(
            id: id,
            nameKey: "devtools.tool.\(id).name",
            detailKey: "devtools.tool.\(id).detail",
            systemImage: systemImage,
            tone: tone,
            searchText: "\(name) \(detail)".lowercased()
        )
    }
}

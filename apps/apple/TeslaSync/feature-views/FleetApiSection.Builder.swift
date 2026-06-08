//
//  FleetApiSection.Builder.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The pure adapter layer (cached JSON → projection). A 1:1 port of the derivation
//  logic in the web source + its `helpers.ts`: the defensive `extractTelemetryErrors`
//  / `pickString`, the vehicle-option mapping, the fleet-config / public-key /
//  partner-verification projections, the onboarding progress + auto-detect, the
//  result-panel outcome resolution, the pretty-printer (`JSON.stringify(…, null, 2)`),
//  the section phase / freshness resolution, and the int / date / relative-time
//  formatters. Foundation-only and side-effect-free so it is unit-tested by an
//  executed headless harness.
//

import Foundation

/// Stateless projectors that turn the untyped `apiFetch` payloads into the typed
/// projections the SwiftUI tools render. Every function is pure.
public enum FleetApiBuilder {
    // MARK: Field extraction (port of `pickString`)

    /// Returns the first non-empty string/number field among `keys` (port of the
    /// web `pickString`: strings pass through, numbers stringify, blanks skip).
    public static func pickString(_ row: [String: JSONValue], _ keys: [String]) -> String {
        for key in keys {
            switch row[key] {
            case let .string(value) where !value.isEmpty:
                return value
            case let .number(value):
                return formatNumber(value)
            default:
                continue
            }
        }
        return ""
    }

    // MARK: Telemetry errors (port of `extractTelemetryErrors`)

    /// Normalises Tesla's per-vehicle fleet-telemetry errors response into UI rows,
    /// tolerating every observed wire variant (envelope-wrapped, envelope-less,
    /// array-only). Returns `ok == true` for a recognised array (even when empty),
    /// `ok == false` for an unrecognised shape — the web's healthy-vs-drift signal.
    public static func extractTelemetryErrors(_ value: JSONValue) -> TelemetryErrorsResult {
        guard case let .object(root) = value else {
            return TelemetryErrorsResult(errors: [], ok: false)
        }
        let candidates: [JSONValue] = [
            root["errors"] ?? .null,
            value["response"]["errors"],
            root["response"] ?? .null,
            value
        ]
        guard let raw = candidates.compactMap(\.arrayValue).first else {
            return TelemetryErrorsResult(errors: [], ok: false)
        }
        let errors = raw.enumerated().map { index, row in errorRow(from: row, index: index) }
        return TelemetryErrorsResult(errors: errors, ok: true)
    }

    /// Maps one raw error element to a `TelemetryErrorRow`, mirroring the web key
    /// fallbacks + the collision-proof composite row key.
    private static func errorRow(from row: JSONValue, index: Int) -> TelemetryErrorRow {
        let object = row.objectValue ?? [:]
        let timestamp = pickString(object, ["reported_at", "timestamp", "created_at", "ts"])
        let code = pickString(object, ["error_code", "code", "name", "topic"])
        let message = pickString(object, ["error_message", "message", "body", "description"])
        let vin = pickString(object, ["vin"])
        return TelemetryErrorRow(
            rowKey: "\(timestamp)|\(code)|\(vin)|\(index)",
            timestamp: timestamp,
            code: code,
            message: message
        )
    }

    // MARK: Vehicle options (port of `useVehicleOptions`)

    /// Maps the `/vehicles` payload to `{ vin, display_name || vin }` options,
    /// skipping rows without a VIN (web maps every row; a blank VIN is unusable).
    public static func vehicleOptions(from value: JSONValue) -> [VehicleOption] {
        guard let rows = value.arrayValue else { return [] }
        return rows.compactMap { row in
            let object = row.objectValue ?? [:]
            let vin = pickString(object, ["vin"])
            guard !vin.isEmpty else { return nil }
            let name = pickString(object, ["display_name"])
            return VehicleOption(vin: vin, label: name.isEmpty ? vin : name)
        }
    }

    // MARK: Card projections

    /// Projects the `fleet-api-info` payload into the config card model.
    public static func configInfo(from value: JSONValue) -> FleetApiConfigInfo {
        let object = value.objectValue ?? [:]
        let regions = (object["regions"]?.arrayValue ?? []).compactMap(\.stringValue)
        return FleetApiConfigInfo(
            baseURL: object["baseUrl"]?.stringValue ?? "",
            clientID: object["clientId"]?.stringValue ?? "",
            authenticated: object["authenticated"]?.boolValue == true,
            regions: regions,
            hostname: object["hostname"]?.stringValue
        )
    }

    /// Projects the `public-key-status` payload into the setup card model.
    public static func publicKeyStatus(from value: JSONValue) -> PublicKeyStatus {
        let object = value.objectValue ?? [:]
        return PublicKeyStatus(
            configured: object["configured"]?.boolValue == true,
            fingerprint: object["fingerprint"]?.stringValue,
            wellKnownURL: object["wellKnownUrl"]?.stringValue
        )
    }

    /// Projects the `partner-public-key` payload's `verification` envelope.
    public static func partnerKeyVerification(from value: JSONValue) -> PartnerKeyVerification {
        let verification = value["verification"].objectValue ?? [:]
        let publicKey = value["response"]["public_key"].stringValue
        return PartnerKeyVerification(
            remoteKeyFound: verification["remote_key_found"]?.boolValue == true,
            matchesLocal: verification["matches_local"]?.boolValue == true,
            localKeyConfigured: verification["local_key_configured"]?.boolValue == true,
            publicKeyPEM: (publicKey?.isEmpty == false) ? publicKey : nil
        )
    }

    /// Builds the verification status chips (port of the `Badge` row precedence:
    /// registered/not-found, then matches/mismatch/no-local).
    public static func partnerKeyBadges(_ verification: PartnerKeyVerification) -> [PartnerKeyBadge] {
        var badges: [PartnerKeyBadge] = []
        if verification.remoteKeyFound {
            badges.append(PartnerKeyBadge(
                id: "registered", tone: .green,
                titleKey: "devtools.partnerKey.keyRegistered", fallback: "Key Registered"
            ))
        } else {
            badges.append(PartnerKeyBadge(
                id: "notFound", tone: .red,
                titleKey: "devtools.partnerKey.keyNotFound", fallback: "Key Not Found"
            ))
        }
        if verification.remoteKeyFound, verification.localKeyConfigured {
            badges.append(verification.matchesLocal
                ? PartnerKeyBadge(
                    id: "matches", tone: .green,
                    titleKey: "devtools.partnerKey.matchesLocal", fallback: "Matches Local Key"
                )
                : PartnerKeyBadge(
                    id: "mismatch", tone: .amber,
                    titleKey: "devtools.partnerKey.mismatch", fallback: "Does Not Match Local Key"
                ))
        }
        if verification.remoteKeyFound, !verification.localKeyConfigured {
            badges.append(PartnerKeyBadge(
                id: "noLocal", tone: .neutral,
                titleKey: "devtools.partnerKey.noLocal", fallback: "No Local Key Configured"
            ))
        }
        return badges
    }

    /// The vehicle key-pairing URL (web `https://tesla.com/_ak/${hostname}`).
    public static func pairingURL(hostname: String) -> String {
        let host = hostname.isEmpty ? "yourapp.example.com" : hostname
        return "https://tesla.com/_ak/\(host)"
    }

    // MARK: Onboarding (port of the progress + auto-detect)

    /// Tallies completed steps (web `ONBOARDING_STEPS.filter(s => completed[s.id])`).
    public static func onboardingProgress(
        steps: [OnboardingStep],
        completed: [String: Bool]
    ) -> OnboardingProgress {
        let done = steps.count(where: { completed[$0.id] == true })
        return OnboardingProgress(completed: done, total: steps.count)
    }

    /// Auto-marks the keypair/auth steps from live status (web effect:
    /// `configured → keypair`, `authenticated → auth`), preserving manual marks.
    public static func autoDetectCompleted(
        _ completed: [String: Bool],
        configured: Bool,
        authenticated: Bool
    ) -> [String: Bool] {
        var next = completed
        if configured { next["keypair"] = true }
        if authenticated { next["auth"] = true }
        return next
    }

    // MARK: Result-panel outcome (port of `data.error ? error : data`)

    /// Resolves a mutation/query payload into a `ToolResult`: a string `error`
    /// field becomes `.failure`, otherwise the whole payload is `.success`.
    public static func outcome(from value: JSONValue) -> ToolResult {
        if case let .string(message) = value["error"], !message.isEmpty {
            return .failure(message)
        }
        return .success(value)
    }

    // MARK: Telemetry-errors panel phase (port of the `TelemetryErrorsPanel` gate)

    /// Maps the "View Errors" action result to the panel's five-state phase
    /// (idle / loading / error / table / empty + raw disclosure).
    public static func telemetryErrorsPhase(from result: ToolResult) -> TelemetryErrorsPhase {
        switch result {
        case .idle:
            return .idle
        case .loading:
            return .loading
        case let .failure(message):
            return .failed(message)
        case let .success(value):
            let extracted = extractTelemetryErrors(value)
            if extracted.errors.isEmpty {
                return .empty(ok: extracted.ok, raw: extracted.ok ? nil : value)
            }
            return .table(extracted.errors)
        }
    }
}

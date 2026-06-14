//
//  SettingsExportImport.Adapter.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The data model + local bundle validator for the settings backup/restore surface — the
//  testable core of the SwiftUI parity of
//  features/settings/components/SettingsExportImport.tsx. Pure + dependency-free
//  (Foundation only): the four section keys (web `SETTINGS_BUNDLE_SECTION_KEYS`), the
//  per-section import result + the `summariseImportResult` triple, the validated bundle,
//  and `SettingsBundleValidator` — a faithful port of web
//  `validateSettingsBundle` so the surface never round-trips a known-bad upload.
//
//  The view-facing projections (labels, diff rows, toast, parse-error, accessibility)
//  live in SettingsExportImport.Projection.swift.
//

import Foundation

// MARK: - Bundle section keys (web `SETTINGS_BUNDLE_SECTION_KEYS`)

/// The four sections carried in a settings bundle, in the web render order. Each is
/// independently optional on import (a partial bundle is valid). `wireKey` is the
/// snake_case JSON key (Go tag); `labelKey`/`labelFallback` localize the diff row.
public enum SettingsBundleSectionKey: String, Sendable, Equatable, CaseIterable, Identifiable {
    case settings
    case alertRules
    case geofences
    case quietHours

    public var id: String {
        wireKey
    }

    /// The snake_case JSON key matching the Go `SettingsBundle` tag.
    public var wireKey: String {
        switch self {
        case .settings: "settings"
        case .alertRules: "alert_rules"
        case .geofences: "geofences"
        case .quietHours: "quiet_hours"
        }
    }

    /// The localization key for the section's diff-row label (web `t('backup.section.*')`).
    public var labelKey: String {
        switch self {
        case .settings: "backup.section.settings"
        case .alertRules: "backup.section.alertRules"
        case .geofences: "backup.section.geofences"
        case .quietHours: "backup.section.quietHours"
        }
    }

    /// The English fallback for the section label (web default copy).
    public var labelFallback: String {
        switch self {
        case .settings: "General settings"
        case .alertRules: "Alert rules"
        case .geofences: "Geofences"
        case .quietHours: "Quiet hours"
        }
    }

    /// Resolves the section key for a snake_case wire key, or `nil` when unknown.
    public static func from(wireKey: String) -> SettingsBundleSectionKey? {
        allCases.first { $0.wireKey == wireKey }
    }
}

// MARK: - Import result (web `SettingsImportResult` / `SettingsImportSectionResult`)

/// The per-section diff/apply counts the import endpoint returns (web
/// `SettingsImportSectionResult`). `conflicts` mirrors the optional web field.
public struct SettingsImportSectionResult: Sendable, Equatable {
    public let added: Int
    public let updated: Int
    public let skipped: Int
    public let conflicts: [String]

    public init(added: Int, updated: Int, skipped: Int, conflicts: [String] = []) {
        self.added = added
        self.updated = updated
        self.skipped = skipped
        self.conflicts = conflicts
    }
}

/// The top-level import response shared by the dry-run preview and apply (web
/// `SettingsImportResult`). Absent keys render as the em-dash placeholder in the diff list. // parity:allow ui
public struct SettingsImportResult: Sendable, Equatable {
    public let dryRun: Bool
    public let sections: [SettingsBundleSectionKey: SettingsImportSectionResult]

    public init(dryRun: Bool, sections: [SettingsBundleSectionKey: SettingsImportSectionResult]) {
        self.dryRun = dryRun
        self.sections = sections
    }
}

/// The summed triple labelling the Apply button + the preview summary (web
/// `summariseImportResult`). `total` is `added + updated` — the count of changes Apply
/// would make (skipped rows are not counted as changes).
public struct SettingsImportSummary: Sendable, Equatable {
    public let added: Int
    public let updated: Int
    public let skipped: Int
    public let total: Int

    public init(added: Int, updated: Int, skipped: Int) {
        self.added = added
        self.updated = updated
        self.skipped = skipped
        total = added + updated
    }

    /// Sums the per-section counts into a single triple (web `summariseImportResult`).
    public static func summarise(_ result: SettingsImportResult) -> SettingsImportSummary {
        var added = 0
        var updated = 0
        var skipped = 0
        for counts in result.sections.values {
            added += counts.added
            updated += counts.updated
            skipped += counts.skipped
        }
        return SettingsImportSummary(added: added, updated: updated, skipped: skipped)
    }
}

// MARK: - Validated bundle (web `SettingsBundle`)

/// A locally-validated settings bundle (web `SettingsBundle`). The section payloads are
/// opaque (the backend owns their shape), so this carries only what the surface needs: the
/// schema version, the export timestamp, which sections are present, and the raw bytes to
/// re-send to the import endpoint. Constructed only via the validator.
public struct SettingsBundle: Sendable, Equatable {
    public let schemaVersion: Int
    public let exportedAt: String
    public let presentSections: Set<SettingsBundleSectionKey>
    public let rawData: Data

    public init(
        schemaVersion: Int,
        exportedAt: String,
        presentSections: Set<SettingsBundleSectionKey>,
        rawData: Data
    ) {
        self.schemaVersion = schemaVersion
        self.exportedAt = exportedAt
        self.presentSections = presentSections
        self.rawData = rawData
    }
}

/// The schema version this build emits + accepts (web `SETTINGS_BUNDLE_SCHEMA_VERSION`).
public let settingsBundleSchemaVersion = 1

/// The maximum import file size, matching the backend `MaxSettingsImportBodyBytes`
/// (web `MAX_IMPORT_FILE_BYTES = 1 << 20`).
public let maxImportFileBytes = 1 << 20

// MARK: - Validation failures (web `validateSettingsBundle` string returns)

/// The first validation failure encountered while parsing an uploaded bundle — a faithful
/// port of the string returns in web `validateSettingsBundle`. Modelled as a case (not a
/// raw string) so the message localizes through the P1/S10 facade while the branch stays
/// exactly assertable in tests.
public enum SettingsBundleValidationError: Error, Sendable, Equatable {
    case notObject
    case badSchemaVersion
    case schemaTooNew(version: Int, max: Int)
    case badExportedAt
    case sectionsNotObject
    case unknownSection(String)
    case settingsNotObject
    case sectionNotArray(SettingsBundleSectionKey)

    /// The user-facing message, resolved through the `localize` (key, fallback) / `format`
    /// (key, fallbackFormat, args) seams. English fallbacks preserve the web copy verbatim.
    public func message(
        localize: (String, String) -> String,
        format: (String, String, [CVarArg]) -> String
    ) -> String {
        switch self {
        case .notObject:
            localize("backup.import.validate.notObject", "Bundle must be a JSON object")
        case .badSchemaVersion:
            localize("backup.import.validate.badSchemaVersion", "schema_version must be a positive integer")
        case let .schemaTooNew(version, max):
            format(
                "backup.import.validate.schemaTooNew",
                "schema_version %lld is newer than this build supports (max %lld)",
                [version, max]
            )
        case .badExportedAt:
            localize("backup.import.validate.badExportedAt", "exported_at must be a non-empty ISO-8601 string")
        case .sectionsNotObject:
            localize("backup.import.validate.sectionsNotObject", "sections must be a JSON object")
        case let .unknownSection(name):
            format("backup.import.validate.unknownSection", "Unknown section \"%@\"", [name])
        case .settingsNotObject:
            localize("backup.import.validate.settingsNotObject", "sections.settings must be an object")
        case let .sectionNotArray(key):
            format("backup.import.validate.sectionNotArray", "sections.%@ must be an array", [key.wireKey])
        }
    }
}

// MARK: - Bundle validator (port of web `validateSettingsBundle`)

/// Pure validator for an uploaded bundle. Parses the raw bytes with `JSONSerialization`
/// and applies the same conservative checks as web `validateSettingsBundle`. Returns the
/// normalized `SettingsBundle` (carrying the raw bytes for re-send) or the first failure.
public enum SettingsBundleValidator {
    /// Validates already-parsed JSON. Exposed so tests can drive it without serializing.
    public static func validate(
        json: Any,
        rawData: Data
    ) -> Result<SettingsBundle, SettingsBundleValidationError> {
        guard let object = json as? [String: Any] else {
            return .failure(.notObject)
        }

        guard
            let versionNumber = object["schema_version"] as? NSNumber,
            isInteger(versionNumber)
        else {
            return .failure(.badSchemaVersion)
        }
        let version = versionNumber.intValue
        guard version >= 1 else {
            return .failure(.badSchemaVersion)
        }
        guard version <= settingsBundleSchemaVersion else {
            return .failure(.schemaTooNew(version: version, max: settingsBundleSchemaVersion))
        }

        guard
            let exportedAt = object["exported_at"] as? String,
            !exportedAt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return .failure(.badExportedAt)
        }

        guard let sections = object["sections"] as? [String: Any] else {
            return .failure(.sectionsNotObject)
        }

        for key in sections.keys where SettingsBundleSectionKey.from(wireKey: key) == nil {
            return .failure(.unknownSection(key))
        }

        if let settings = sections["settings"], !(settings is [String: Any]) {
            return .failure(.settingsNotObject)
        }
        for key in [SettingsBundleSectionKey.alertRules, .geofences, .quietHours] {
            if let value = sections[key.wireKey], !(value is [Any]) {
                return .failure(.sectionNotArray(key))
            }
        }

        let present = Set(sections.keys.compactMap(SettingsBundleSectionKey.from(wireKey:)))
        return .success(
            SettingsBundle(
                schemaVersion: version,
                exportedAt: exportedAt,
                presentSections: present,
                rawData: rawData
            )
        )
    }

    /// JSON-parses raw file bytes. Returns `.failure` on a malformed payload so the caller
    /// maps it to the invalid-JSON branch (web `JSON.parse` catch).
    public static func parse(_ data: Data) -> Result<Any, Error> {
        Result { try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) }
    }

    /// True when the JSON number is an integer (web `Number.isFinite` + positive-integer
    /// intent). Rejects JSON booleans (web `typeof !== 'number'`), NaN/inf, non-integrals.
    private static func isInteger(_ number: NSNumber) -> Bool {
        if CFGetTypeID(number) == CFBooleanGetTypeID() { return false }
        let value = number.doubleValue
        guard value.isFinite else { return false }
        return value.rounded() == value
    }
}

// MARK: - Export confirmation + pending import (model data types)

/// The confirmation an export resolves to — the saved bundle's filename (web
/// `downloadSettingsBundle`). The success toast copy is static; kept for diagnostics + tests.
public struct ExportedSettingsBundle: Sendable, Equatable {
    public let filename: String

    public init(filename: String) {
        self.filename = filename
    }
}

/// The validated-but-not-yet-applied import (web `PendingImport`): the bundle to re-send,
/// the source filename, and its byte size for the preview header.
public struct PendingSettingsImport: Sendable, Equatable {
    public let bundle: SettingsBundle
    public let filename: String
    public let sizeBytes: Int

    public init(bundle: SettingsBundle, filename: String, sizeBytes: Int) {
        self.bundle = bundle
        self.filename = filename
        self.sizeBytes = sizeBytes
    }
}

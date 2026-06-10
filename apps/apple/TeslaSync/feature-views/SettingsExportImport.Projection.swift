//
//  SettingsExportImport.Projection.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The view-facing projections for the settings backup/restore surface — pure +
//  dependency-free (Foundation only) so they unit-test without a bundle or a rendered
//  view: the inline parse-error message (web `parseError`), the export/choose/apply
//  button-label projections (web ternaries), the per-section diff rows (web
//  `SectionDiffList`), the toast content (web `useToast`), the dry-run preview header
//  builders (web `Previewing {{name}} ({{size}} bytes)`), and the accessibility builders +
//  stable automation identifiers (web `data-testid`).
//

import Foundation

// MARK: - Inline parse error (web `parseError` ErrorText)

/// The inline import-pipeline failure rendered under the dropzone (web `parseError`).
/// Mirrors each branch of web `ingestFile`: the size guard, the read failure, the
/// JSON-parse failure (with the parser detail), the schema-validation failure, and the
/// dry-run preview failure (the API message when present, else the generic fallback).
public enum SettingsImportParseError: Sendable, Equatable {
    case tooLarge
    case readFailed
    case invalidJSON(detail: String)
    case invalidBundle(SettingsBundleValidationError)
    case previewFailed(message: String?)

    /// The localized message shown in the inline error banner.
    public func message(
        localize: (String, String) -> String,
        format: (String, String, [CVarArg]) -> String
    ) -> String {
        switch self {
        case .tooLarge:
            localize("backup.import.errorTooLarge", "File is too large (max 1 MB).")
        case .readFailed:
            localize("backup.import.errorRead", "Failed to read the file.")
        case let .invalidJSON(detail):
            format("backup.import.errorJson", "File is not valid JSON: %@", [detail])
        case let .invalidBundle(error):
            error.message(localize: localize, format: format)
        case let .previewFailed(message):
            if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                message
            } else {
                localize("backup.import.errorPreview", "Failed to preview import.")
            }
        }
    }
}

// MARK: - Button-label projections (web ternaries)

/// A localizable label key/fallback pair, with an optional count argument for the
/// `Apply N change(s)` interpolation.
public struct SettingsBackupLabel: Sendable, Equatable {
    public let key: String
    public let fallback: String
    public let count: Int?

    public init(key: String, fallback: String, count: Int? = nil) {
        self.key = key
        self.fallback = fallback
        self.count = count
    }

    /// Export button (web `isPending ? 'Exporting…' : 'Export JSON'`).
    public static func exportButton(isExporting: Bool) -> SettingsBackupLabel {
        isExporting
            ? SettingsBackupLabel(key: "backup.export.busy", fallback: "Exporting…")
            : SettingsBackupLabel(key: "backup.export.cta", fallback: "Export JSON")
    }

    /// Choose-file button (web `stage === 'parsing' ? 'Reading…' : 'Choose a file'`).
    public static func chooseButton(isParsing: Bool) -> SettingsBackupLabel {
        isParsing
            ? SettingsBackupLabel(key: "backup.import.parsing", fallback: "Reading…")
            : SettingsBackupLabel(key: "backup.import.choose", fallback: "Choose a file")
    }

    /// Apply button (web `isPending ? 'Applying…' : total>0 ? 'Apply N…' : 'Nothing…'`).
    public static func applyButton(isApplying: Bool, total: Int) -> SettingsBackupLabel {
        if isApplying {
            return SettingsBackupLabel(key: "backup.import.applying", fallback: "Applying…")
        }
        if total > 0 {
            return SettingsBackupLabel(key: "backup.import.applyCount", fallback: "Apply %lld change(s)", count: total)
        }
        return SettingsBackupLabel(key: "backup.import.applyNoChanges", fallback: "Nothing to apply")
    }
}

// MARK: - Section diff rows (web `SectionDiffList`)

/// One row of the per-section diff list (web `SectionDiffList` `<li>`). `counts` is the
/// section's result, or `nil` when the section is absent from the response (web em-dash).
public struct SettingsSectionDiffRow: Sendable, Equatable, Identifiable {
    public let key: SettingsBundleSectionKey
    public let labelKey: String
    public let labelFallback: String
    public let counts: SettingsImportSectionResult?

    public var id: String {
        key.wireKey
    }

    public init(key: SettingsBundleSectionKey, counts: SettingsImportSectionResult?) {
        self.key = key
        labelKey = key.labelKey
        labelFallback = key.labelFallback
        self.counts = counts
    }

    /// The monospaced `+added ~updated =skipped` chip (web `Code`), or `nil` when absent.
    public var codeText: String? {
        guard let counts else { return nil }
        return "+\(counts.added) ~\(counts.updated) =\(counts.skipped)"
    }

    /// Projects one row per bundle section in web order (web `SETTINGS_BUNDLE_SECTION_KEYS`).
    public static func rows(from result: SettingsImportResult) -> [SettingsSectionDiffRow] {
        SettingsBundleSectionKey.allCases.map { key in
            SettingsSectionDiffRow(key: key, counts: result.sections[key])
        }
    }
}

// MARK: - Toast content (web `useToast`)

/// The transient feedback tone — the port of web `toast.success` / `toast.error` plus a
/// neutral tone for the native offline branch.
public enum SettingsBackupTone: Sendable, Equatable {
    case success
    case danger
    case neutral
}

/// One resolved toast — the native counterpart of web `useToast()` feedback. The model
/// publishes the latest toast; the view renders it and clears it after a delay (or on
/// dismiss). `kind` drives tests + the icon; `title`/`message` are already localized.
public struct SettingsBackupToast: Sendable, Equatable, Identifiable {
    public enum Kind: Sendable, Equatable {
        case exportSucceeded
        case exportOffline
        case exportFailed
        case importApplied
        case importOffline
        case importFailed
    }

    public let id: UUID
    public let kind: Kind
    public let tone: SettingsBackupTone
    public let title: String
    public let message: String
    public let systemImage: String

    public init(
        kind: Kind,
        tone: SettingsBackupTone,
        title: String,
        message: String,
        systemImage: String,
        id: UUID = UUID()
    ) {
        self.kind = kind
        self.tone = tone
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.id = id
    }

    /// Export success (web `toast.success('Settings exported', 'Saved to your downloads…')`).
    public static func exportSucceeded(localize: (String, String) -> String) -> SettingsBackupToast {
        SettingsBackupToast(
            kind: .exportSucceeded,
            tone: .success,
            title: localize("backup.export.successTitle", "Settings exported"),
            message: localize("backup.export.successDetail", "Saved to your downloads folder."),
            systemImage: "checkmark.circle.fill"
        )
    }

    /// Import applied (web `toast.success('Settings imported', '{{a}} added, …skipped.')`).
    public static func importApplied(
        summary: SettingsImportSummary,
        localize: (String, String) -> String,
        format: (String, String, [CVarArg]) -> String
    ) -> SettingsBackupToast {
        SettingsBackupToast(
            kind: .importApplied,
            tone: .success,
            title: localize("backup.import.appliedTitle", "Settings imported"),
            message: format(
                "backup.import.appliedDetail",
                "%lld added, %lld updated, %lld skipped.",
                [summary.added, summary.updated, summary.skipped]
            ),
            systemImage: "checkmark.circle.fill"
        )
    }

    /// Export transport failure surfaced as offline (native branch).
    public static func exportOffline(localize: (String, String) -> String) -> SettingsBackupToast {
        offline(
            kind: .exportOffline,
            title: localize("backup.export.errorTitle", "Couldn’t export settings"),
            localize: localize
        )
    }

    /// Export error (web `useMutationToast` 'Failed to export settings').
    public static func exportFailed(
        message: String,
        localize: (String, String) -> String,
        format _: (String, String, [CVarArg]) -> String
    ) -> SettingsBackupToast {
        failed(
            kind: .exportFailed,
            title: localize("backup.export.errorTitle", "Couldn’t export settings"),
            message: message,
            fallback: localize("backup.export.errorDetail", "Failed to export settings")
        )
    }

    /// Apply transport failure surfaced as offline (native branch).
    public static func importOffline(localize: (String, String) -> String) -> SettingsBackupToast {
        offline(
            kind: .importOffline,
            title: localize("backup.import.errorTitle", "Couldn’t import settings"),
            localize: localize
        )
    }

    /// Apply error (web `useMutationToast` 'Failed to apply import').
    public static func importFailed(
        message: String,
        localize: (String, String) -> String
    ) -> SettingsBackupToast {
        failed(
            kind: .importFailed,
            title: localize("backup.import.errorTitle", "Couldn’t import settings"),
            message: message,
            fallback: localize("backup.import.applyError", "Failed to apply import")
        )
    }

    private static func offline(
        kind: Kind,
        title: String,
        localize: (String, String) -> String
    ) -> SettingsBackupToast {
        SettingsBackupToast(
            kind: kind,
            tone: .neutral,
            title: title,
            message: localize(
                "backup.offline",
                "You appear to be offline. Try again when you’re reconnected."
            ),
            systemImage: "wifi.slash"
        )
    }

    private static func failed(
        kind: Kind,
        title: String,
        message: String,
        fallback: String
    ) -> SettingsBackupToast {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return SettingsBackupToast(
            kind: kind,
            tone: .danger,
            title: title,
            message: trimmed.isEmpty ? fallback : trimmed,
            systemImage: "exclamationmark.triangle.fill"
        )
    }
}

// MARK: - Preview header (web `Previewing {{name}} ({{size}} bytes)`)

/// Pure builders for the dry-run preview header copy (web `backup.import.previewHeader`).
public enum SettingsImportPreviewHeader {
    /// The grouped byte count (web `fmtInt`). Locale-injected for deterministic tests.
    public static func formattedSize(_ bytes: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: bytes)) ?? String(bytes)
    }

    /// `Previewing {{name}} ({{size}} bytes)` (web `backup.import.previewHeader`).
    public static func text(
        name: String,
        sizeBytes: Int,
        locale: Locale = .current,
        format: (String, String, [CVarArg]) -> String
    ) -> String {
        format(
            "backup.import.previewHeader",
            "Previewing %@ (%@ bytes)",
            [name, formattedSize(sizeBytes, locale: locale)]
        )
    }

    /// `{{a}} added, {{u}} updated, {{s}} unchanged` (web `backup.import.summary`).
    public static func summaryLine(
        _ summary: SettingsImportSummary,
        format: (String, String, [CVarArg]) -> String
    ) -> String {
        format(
            "backup.import.summary",
            "%lld added, %lld updated, %lld unchanged",
            [summary.added, summary.updated, summary.skipped]
        )
    }
}

// MARK: - Accessibility builders + automation identifiers (web `data-testid`)

/// Builds the VoiceOver strings + stable identifiers for the surface. Pure + public so the
/// spoken content / automation IDs can be unit-tested without rendering the view.
public enum SettingsExportImportAccessibility {
    public static let rootTestID = "settings-export-import"
    public static let exportTestID = "settings-export-button"
    public static let dropzoneTestID = "settings-import-dropzone"
    public static let fileInputTestID = "settings-import-file-input"
    public static let errorTestID = "settings-import-error"
    public static let previewTestID = "settings-import-preview"
    public static let applyTestID = "settings-import-apply"
    public static let appliedTestID = "settings-import-applied"
    public static let sectionListTestID = "settings-import-section-list"

    /// The surface's spoken container label (web panel landmark).
    public static func surfaceLabel(localize: (String, String) -> String) -> String {
        localize("backup.title", "Backup & Restore")
    }

    /// The Export button's spoken label (web button name "Export JSON").
    public static func exportLabel(localize: (String, String) -> String) -> String {
        localize("backup.export.cta", "Export JSON")
    }

    /// The dropzone's spoken label (web file intake affordance).
    public static func dropzoneLabel(localize: (String, String) -> String) -> String {
        localize("backup.import.dropPrompt", "Drag a JSON bundle here, or")
    }
}

//
//  SettingsExportImport.Seams.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The in-memory + controllable backup sources (previews/tests — the view never performs
//  I/O), the DEBUG preview seed seam, and the P1/S10 i18n facade for the settings
//  backup/restore surface.
//

import Foundation

// MARK: - In-memory source (previews + tests)

/// Deterministic export + import source. Returns canned results (or thrown
/// `SettingsBackupError`s), optionally after a delay so in-flight states can be observed,
/// and counts each call so the success/guard paths can be asserted.
@MainActor
public final class InMemorySettingsBackupSource: SettingsBackupExporting, SettingsBackupImporting {
    public enum ExportResult: Sendable {
        case success(ExportedSettingsBundle)
        case failure(SettingsBackupError)
    }

    public enum ImportResult: Sendable {
        case success(SettingsImportResult)
        case failure(SettingsBackupError)
    }

    public private(set) var exportCount = 0
    public private(set) var dryRunCount = 0
    public private(set) var applyCount = 0

    private let exportResult: ExportResult
    private let dryRunResult: ImportResult
    private let applyResult: ImportResult
    private let delay: Duration?

    public init(
        exportResult: ExportResult = .success(ExportedSettingsBundle(filename: "teslasync-settings.json")),
        dryRunResult: ImportResult = .success(InMemorySettingsBackupSource.sampleDryRun),
        applyResult: ImportResult = .success(InMemorySettingsBackupSource.sampleApplied),
        delay: Duration? = nil
    ) {
        self.exportResult = exportResult
        self.dryRunResult = dryRunResult
        self.applyResult = applyResult
        self.delay = delay
    }

    public func exportSettings() async throws -> ExportedSettingsBundle {
        exportCount += 1
        try await sleepIfNeeded()
        switch exportResult {
        case let .success(value): return value
        case let .failure(error): throw error
        }
    }

    public func dryRun(_: SettingsBundle) async throws -> SettingsImportResult {
        dryRunCount += 1
        try await sleepIfNeeded()
        switch dryRunResult {
        case let .success(value): return value
        case let .failure(error): throw error
        }
    }

    public func apply(_: SettingsBundle) async throws -> SettingsImportResult {
        applyCount += 1
        try await sleepIfNeeded()
        switch applyResult {
        case let .success(value): return value
        case let .failure(error): throw error
        }
    }

    private func sleepIfNeeded() async throws {
        if let delay {
            try? await Task.sleep(for: delay)
        }
    }

    /// A representative dry-run result with changes across all four sections.
    public static let sampleDryRun = SettingsImportResult(
        dryRun: true,
        sections: [
            .settings: SettingsImportSectionResult(added: 0, updated: 1, skipped: 4),
            .alertRules: SettingsImportSectionResult(added: 3, updated: 1, skipped: 2),
            .geofences: SettingsImportSectionResult(added: 2, updated: 0, skipped: 1),
            .quietHours: SettingsImportSectionResult(added: 1, updated: 0, skipped: 0)
        ]
    )

    /// The applied counterpart of `sampleDryRun`.
    public static let sampleApplied = SettingsImportResult(
        dryRun: false,
        sections: [
            .settings: SettingsImportSectionResult(added: 0, updated: 1, skipped: 4),
            .alertRules: SettingsImportSectionResult(added: 3, updated: 1, skipped: 2),
            .geofences: SettingsImportSectionResult(added: 2, updated: 0, skipped: 1),
            .quietHours: SettingsImportSectionResult(added: 1, updated: 0, skipped: 0)
        ]
    )
}

// MARK: - Controllable source (deterministic in-flight tests)

/// Import + export source whose completion is driven by the test, so the in-flight
/// (`exporting` / `parsing` / `applyInFlight`) states can be asserted deterministically.
@MainActor
public final class ControllableSettingsBackupSource: SettingsBackupExporting, SettingsBackupImporting {
    public private(set) var dryRunCount = 0
    public private(set) var applyCount = 0
    public private(set) var exportCount = 0

    private var exportContinuation: CheckedContinuation<ExportedSettingsBundle, Error>?
    private var dryRunContinuation: CheckedContinuation<SettingsImportResult, Error>?
    private var applyContinuation: CheckedContinuation<SettingsImportResult, Error>?

    public init() {}

    public func exportSettings() async throws -> ExportedSettingsBundle {
        exportCount += 1
        return try await withCheckedThrowingContinuation { continuation in
            self.exportContinuation = continuation
        }
    }

    public func dryRun(_: SettingsBundle) async throws -> SettingsImportResult {
        dryRunCount += 1
        return try await withCheckedThrowingContinuation { continuation in
            self.dryRunContinuation = continuation
        }
    }

    public func apply(_: SettingsBundle) async throws -> SettingsImportResult {
        applyCount += 1
        return try await withCheckedThrowingContinuation { continuation in
            self.applyContinuation = continuation
        }
    }

    /// Resolves the in-flight export with a saved-bundle confirmation.
    public func completeExport(
        _ result: ExportedSettingsBundle = ExportedSettingsBundle(filename: "teslasync-settings.json")
    ) {
        exportContinuation?.resume(returning: result)
        exportContinuation = nil
    }

    /// Fails the in-flight export with a classified error.
    public func failExport(_ error: SettingsBackupError) {
        exportContinuation?.resume(throwing: error)
        exportContinuation = nil
    }

    /// Resolves the in-flight dry-run with a result.
    public func completeDryRun(_ result: SettingsImportResult = InMemorySettingsBackupSource.sampleDryRun) {
        dryRunContinuation?.resume(returning: result)
        dryRunContinuation = nil
    }

    /// Fails the in-flight dry-run with a classified error.
    public func failDryRun(_ error: SettingsBackupError) {
        dryRunContinuation?.resume(throwing: error)
        dryRunContinuation = nil
    }

    /// Resolves the in-flight apply with a result.
    public func completeApply(_ result: SettingsImportResult = InMemorySettingsBackupSource.sampleApplied) {
        applyContinuation?.resume(returning: result)
        applyContinuation = nil
    }

    /// Fails the in-flight apply with a classified error.
    public func failApply(_ error: SettingsBackupError) {
        applyContinuation?.resume(throwing: error)
        applyContinuation = nil
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)` / `toast(text)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "SettingsExportImport" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. The web source strings are
/// preserved verbatim so a shared catalog resolves identically across web and native.
public enum SettingsExportImportStrings {
    public static let table = "SettingsExportImport"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a printf-style interpolated string (web template literals / `{{var}}`).
    /// Numeric placeholders use `%lld`; string placeholders use `%@`. // parity:allow ui
    public static func format(_ key: String, _ fallbackFormat: String, _ arguments: [CVarArg]) -> String {
        String(format: string(key, fallbackFormat), arguments: arguments)
    }
}

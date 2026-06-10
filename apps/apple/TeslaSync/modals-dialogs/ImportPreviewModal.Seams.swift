//
//  ImportPreviewModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The dependency seams the ImportPreviewModal view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract (`view.opened`), the P1/S10 i18n facade
//  (web `useTranslation('dashboard')`), and the confirm-action seam (web `onConfirm(dashboard)` — the
//  parent applies the imported dashboard). No networking lives in any default; the modal performs
//  only local validation, so its sole side effect is handing the validated dashboard to the host.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol ImportPreviewModalTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogImportPreviewModalTelemetry: ImportPreviewModalTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ImportPreviewModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum ImportPreviewStrings {
    public static let table = "ImportPreviewModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Confirm action seam (web `onConfirm(dashboard)`)

/// The single command the modal drives — applying the validated dashboard import (web `onConfirm`).
/// The default logs the intent without persistence so previews render safely; the app injects an
/// adapter that drives the real dashboard-apply mutation.
public protocol ImportPreviewConfirmAction: Sendable {
    func confirm(_ dashboard: ImportPreviewDashboard)
}

/// `os.Logger`-backed default that records the confirm intent without persistence.
public struct OSLogImportPreviewConfirmAction: ImportPreviewConfirmAction {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "dashboard-import")
    }

    public func confirm(_ dashboard: ImportPreviewDashboard) {
        logger.info("dashboard-import.confirm widgets=\(dashboard.widgets.count, privacy: .public)")
    }
}

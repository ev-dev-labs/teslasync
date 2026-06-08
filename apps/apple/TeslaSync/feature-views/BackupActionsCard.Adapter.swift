//
//  BackupActionsCard.Adapter.swift
//  TeslaSync — P4 feature view · 0241 · BackupActionsCard (Apple)
//
//  The testable projection core for the backup-status action card — the SwiftUI
//  parity of features/system/components/status/BackupActionsCard.tsx. The web
//  component wraps a backup-status `DefList` (passed as `children`) and adds a
//  "Run quick backup now" mutation button plus a "Manage backups & restore" link;
//  the mutation's outcome is surfaced through the app `useToast`, and on success it
//  invalidates the `backup-runs` + `system-status/backup-stats` queries.
//
//  Everything here is pure + dependency-free (Foundation only, no SwiftUI, no view
//  state) so the projections can be unit-tested without a seam, a bundle, or a
//  rendered view: the wrapped-rows phase, the run-button label projection (web
//  `isPending ? 'Starting…' : 'Run quick backup now'`), the settled mutation
//  outcome, the toast content projection (web `toast.success` / `toast.error`,
//  including the 401/403 admin-permission branch), and the accessibility builders.
//

import Foundation

// MARK: - Wrapped backup-status rows (web `children` DefList)

/// One backup-status row the parent renders into the card — the native data form of
/// a web `DefList` `{ label, value }` row. The labels/values are already resolved by
/// the parent (web `t(...)` + `formatBytes`/`formatDateTime`), so they are rendered
/// verbatim here; this surface owns no i18n key for them.
public struct BackupStatusRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

/// The phase of the wrapped backup-status section. The web component receives the
/// rows as already-rendered `children`; the native surface accepts the parent's
/// query lifecycle so every state renders (skeleton / rows / empty / error) instead
/// of a blank box. `ready([])` is the resolved-but-empty case.
public enum BackupStatusContent: Sendable, Equatable {
    case loading
    case ready([BackupStatusRow])
    case failed(message: String)

    /// The rows when resolved, else an empty array (safe to iterate).
    public var rows: [BackupStatusRow] {
        if case let .ready(rows) = self { return rows }
        return []
    }

    /// Whether the section resolved with no rows (web empty `children`).
    public var isEmpty: Bool {
        if case let .ready(rows) = self { return rows.isEmpty }
        return false
    }
}

// MARK: - Run-button label (web `isPending ? 'Starting…' : 'Run quick backup now'`)

/// The label key/fallback pair shown on the run button, mirroring the web ternary on
/// the mutation's `isPending`.
public struct QuickBackupButtonLabel: Equatable {
    public let key: String
    public let fallback: String

    public init(key: String, fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    /// `Starting…` while the quick-backup mutation is in flight, else the run label.
    public static func project(isRunning: Bool) -> QuickBackupButtonLabel {
        isRunning
            ? QuickBackupButtonLabel(key: "backup.actions.button.starting", fallback: "Starting…")
            : QuickBackupButtonLabel(key: "backup.actions.button.run", fallback: "Run quick backup now")
    }
}

// MARK: - Settled mutation outcome (web `mutation` onSuccess / onError)

/// The settled outcome of the quick-backup mutation, mirroring the shapes the web
/// `onSuccess` / `onError` collapse to: a started run, the 401/403 admin-permission
/// branch, the transport failure the native app surfaces as `offline`, and any other
/// server/validation error (web `Backup failed: ${msg}`).
public enum QuickBackupOutcome: Sendable, Equatable {
    case succeeded
    case permissionDenied
    case offline
    case failed(message: String)
}

// MARK: - Toast content (web `useToast` — success / error)

/// The transient feedback tone — the port of the web `toast.success` / `toast.error`
/// plus a neutral tone for the native offline branch. View-layer free (mapped to a
/// design-system color when rendered) so the projection stays Sendable + testable.
public enum BackupActionTone: Sendable, Equatable {
    case success
    case danger
    case neutral
}

/// One resolved toast — the native counterpart of the web `useToast()` feedback. The
/// model publishes the latest toast; the view renders it and clears it after a delay
/// (or on dismiss). `kind` drives tests + the icon; `message` is already localized.
public struct BackupActionToast: Sendable, Equatable, Identifiable {
    /// The outcome class the toast represents (web success vs the two error branches).
    public enum Kind: Sendable, Equatable {
        case success
        case permission
        case offline
        case failed
    }

    public let id: UUID
    public let kind: Kind
    public let tone: BackupActionTone
    public let message: String
    public let systemImage: String

    public init(
        kind: Kind,
        tone: BackupActionTone,
        message: String,
        systemImage: String,
        id: UUID = UUID()
    ) {
        self.kind = kind
        self.tone = tone
        self.message = message
        self.systemImage = systemImage
        self.id = id
    }

    /// Projects the toast for a settled outcome, resolving each web message through
    /// the `localize` (key, fallback) / `format` (key, fallbackFormat, arg) seams so
    /// the projection stays bundle-free and unit-testable. The success / permission /
    /// failed copy is preserved verbatim from the web source.
    public static func project(
        _ outcome: QuickBackupOutcome,
        localize: (String, String) -> String,
        format: (String, String, String) -> String
    ) -> BackupActionToast {
        switch outcome {
        case .succeeded:
            BackupActionToast(
                kind: .success,
                tone: .success,
                message: localize("backup.actions.toast.success", "Quick backup started"),
                systemImage: "checkmark.circle.fill"
            )
        case .permissionDenied:
            BackupActionToast(
                kind: .permission,
                tone: .danger,
                message: localize("backup.actions.toast.permission", "Quick backup requires admin permission."),
                systemImage: "lock.fill"
            )
        case .offline:
            BackupActionToast(
                kind: .offline,
                tone: .neutral,
                message: localize(
                    "backup.actions.toast.offline",
                    "You appear to be offline. Quick backup couldn’t start."
                ),
                systemImage: "wifi.slash"
            )
        case let .failed(message):
            BackupActionToast(
                kind: .failed,
                tone: .danger,
                message: format("backup.actions.toast.failed", "Backup failed: %@", message),
                systemImage: "exclamationmark.triangle.fill"
            )
        }
    }
}

// MARK: - Accessibility builders (testable seam)

/// Builds the VoiceOver strings + stable identifiers for the surface. Pure + public so
/// the spoken content / automation IDs can be unit-tested without rendering the view.
public enum BackupActionsAccessibility {
    /// The web `<Link to="/backup">` target, kept for parity + the manage-link testid.
    public static let manageRoute = "/backup"

    /// Stable automation identifiers (web `data-testid` analogues).
    public static let runTestID = "backup-actions-run"
    public static let manageTestID = "backup-actions-manage"

    /// The run button's spoken label (web button name "Run quick backup now").
    public static func runLabel(localize: (String, String) -> String) -> String {
        localize("backup.actions.button.run", "Run quick backup now")
    }

    /// The manage link's spoken label (web link name "Manage backups & restore").
    public static func manageLabel(localize: (String, String) -> String) -> String {
        localize("backup.actions.manage", "Manage backups & restore")
    }
}

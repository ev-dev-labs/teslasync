//
//  TOTPEnrollmentSection.Adapter.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The pure cached → projection core (no SwiftUI, no networking) for the TOTP
//  enrollment surface — the native port of
//  features/settings/components/TOTPEnrollmentSection.tsx. Reproduces every web
//  behavior that is logic rather than layout: the `/\D/g` six-digit code
//  sanitiser the verify input applies, the `err.code` → message switch the
//  `handleVerify` catch performs (TOTP_INVALID / TOTP_RATE_LIMITED /
//  TOTP_ENROLLMENT_EXPIRED / generic), the backup-codes `.txt` body + filename
//  the `downloadCodes` blob builds, and the three-way status branch the render
//  uses (`isLoading` / `mode === 'open'` / `activated`). Each function mirrors
//  its web counterpart so the surface behaves identically, and is unit tested
//  branch-by-branch by `TOTPEnrollmentSection.Tests`.
//

import Foundation

// MARK: - Surface identity

/// The surface slug used by the P1/S11 diagnostics `view.opened` event. Kept
/// free of SwiftUI so the model + tests reference it without the view layer.
public enum TOTPEnrollmentSurface {
    public static let slug = "TOTPEnrollmentSection"
}

// MARK: - Status payload (web `TOTPStatus` discriminated union)

/// The auth posture the status query reports (web `TOTPStatus.mode`). `open`
/// means no forward-auth header is configured upstream so per-user TOTP cannot
/// be wired (the web renders the "feature requires authenticated mode"
/// notice); `session` means it is available and `activated` then gates
/// between the "Not enrolled" and "Active" surfaces.
public enum TOTPMode: Sendable, Equatable {
    case open
    case session
}

/// The cached status the section renders (web `TOTPStatus`). For `open` the
/// activation fields are absent; for `session` they carry the credential state
/// (web `activated` / `last_used_at` / `backup_codes_remaining`).
public struct TOTPStatusData: Sendable, Equatable {
    public var mode: TOTPMode
    public var activated: Bool
    public var lastUsedAt: Date?
    public var backupCodesRemaining: Int

    public init(
        mode: TOTPMode,
        activated: Bool = false,
        lastUsedAt: Date? = nil,
        backupCodesRemaining: Int = 0
    ) {
        self.mode = mode
        self.activated = activated
        self.lastUsedAt = lastUsedAt
        self.backupCodesRemaining = backupCodesRemaining
    }
}

// MARK: - Enrollment payload (web `TOTPEnrollment`)

/// The fresh enrollment returned by the enroll mutation (web `TOTPEnrollment`).
/// The plain-text `backupCodes` are returned exactly once — the surface must
/// surface a copy/download step before the modal closes.
public struct TOTPEnrollmentData: Sendable, Equatable {
    public var secret: String
    public var otpauthURI: String
    public var qrDataURI: String
    public var backupCodes: [String]
    public var expiresAt: Date?

    public init(
        secret: String,
        otpauthURI: String,
        qrDataURI: String,
        backupCodes: [String],
        expiresAt: Date? = nil
    ) {
        self.secret = secret
        self.otpauthURI = otpauthURI
        self.qrDataURI = qrDataURI
        self.backupCodes = backupCodes
        self.expiresAt = expiresAt
    }
}

// MARK: - Verify failure (web `err.code` sentinels)

/// The distinct verify failures the web `handleVerify` catch branches over by
/// `err.code`. `generic` carries the upstream `err.message` when present (web
/// `err instanceof Error ? err.message : t('…verifyGeneric')`).
public enum TOTPVerifyError: Error, Sendable, Equatable {
    case invalidCode
    case rateLimited
    case enrollmentExpired
    case generic(String?)
}

// MARK: - Load + freshness status (P1/S8 + ADR-013)

/// The load lifecycle for the status query, mirroring the shared `LoadableState`
/// cases (web `isLoading` skeleton / resolved status / empty / failure).
public enum TOTPLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + the cached-data
/// banner so the last-known status stays visible but clearly labeled while
/// reconnecting (stale) or offline.
public enum TOTPConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Render phase (web render branches)

/// The branch the view switches over. `loading` is the in-flight skeleton (web
/// `status.isLoading`); `openMode` is the "feature requires authenticated mode"
/// notice (web `!status.data || mode === 'open'`, the resolved-empty
/// surface); `notEnrolled` / `activated` are the two `session` surfaces; `error`
/// is the no-cached-data failure (the QueryError-equivalent the Apple HIG states
/// contract requires, where the web silently collapses into the notice).
public enum TOTPStatusPhase: Sendable, Equatable {
    case loading
    case openMode
    case notEnrolled
    case activated
    case error(String)
}

/// The modal flow (web `DialogStep = 'enroll' | 'backupCodes' | 'closed'`).
public enum TOTPDialogStep: Sendable, Equatable {
    case closed
    case enroll
    case backupCodes
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TOTPEnrollmentSource`: the cached status
/// plus its load + connection status. The model turns this into the render
/// phase + freshness.
public struct TOTPEnrollmentUpdate: Sendable, Equatable {
    public var status: TOTPLoadStatus
    public var connection: TOTPConnection
    public var data: TOTPStatusData?
    public var updatedAt: Date?

    public init(
        status: TOTPLoadStatus = .loading,
        connection: TOTPConnection = .live,
        data: TOTPStatusData? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

// MARK: - Formatting sentinels

/// Non-localized formatting sentinels shared by the projection (web em-dash).
public enum TOTPFormat {
    /// The em-dash shown when a value is unknown (web `'—'`).
    public static let dash = "—"

    /// The downloaded backup-codes filename (web `'teslasync-totp-backup-codes.txt'`).
    public static let backupCodesFilename = "teslasync-totp-backup-codes.txt"
}

// MARK: - Six-digit code sanitiser (web `/\D/g` + `.slice(0, 6)`)

/// The pure six-digit code handling ported from the web verify input. The web
/// `onChange` does `value.replace(/\D/g, '').slice(0, 6)` and `handleVerify`
/// re-strips then checks `length !== 6`; both are reproduced here so the field +
/// submit guard behave identically.
public enum TOTPCode {
    /// The number of digits a TOTP code requires (web `code.length !== 6`).
    public static let requiredLength = 6

    /// Web `value.replace(/\D/g, '').slice(0, 6)`: keep ASCII digits only, capped
    /// at six. Filtering on the scalar range `48...57` excludes non-ASCII digits
    /// (e.g. Arabic-Indic) exactly like the ASCII-only `\D`.
    public static func sanitize(_ raw: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars where (48 ... 57).contains(scalar.value) {
            scalars.append(scalar)
            if scalars.count == requiredLength { break }
        }
        return String(scalars)
    }

    /// Web `handleVerify` length guard (`code.length !== 6`): the count of ASCII
    /// digits is exactly six. Counts the raw digits (no cap) so a 7-digit value is
    /// incomplete, matching the un-capped `replace(/\D/g, '')` in the web guard.
    public static func isComplete(_ raw: String) -> Bool {
        raw.unicodeScalars.count { (48 ... 57).contains($0.value) } == requiredLength
    }
}

// MARK: - Backup-codes file (web `downloadCodes` blob)

/// The pure backup-codes `.txt` body builder ported from the web `downloadCodes`.
/// The web blob is `${header}\n\n${codes.join('\n')}\n`; this reproduces it byte
/// for byte so the native ShareLink download matches the browser download.
public enum TOTPBackupCodesFile {
    /// Web `` `${header}\n\n${revealedCodes.join('\n')}\n` ``. An empty code set
    /// yields just the header block (the web early-returns, so the view guards
    /// the affordance; the body builder stays total for testability).
    public static func contents(codes: [String], header: String) -> String {
        let joined = codes.joined(separator: "\n")
        return "\(header)\n\n\(joined)\n"
    }
}

// MARK: - Verify-error message (web `handleVerify` catch switch)

/// Maps a `TOTPVerifyError` to the inline message the web `handleVerify` catch
/// renders, via the P1/S10 `localize` facade (web `t(key, default)`).
public enum TOTPVerifyErrorMapper {
    public static func message(
        for error: TOTPVerifyError,
        localize: (String, String) -> String
    ) -> String {
        switch error {
        case .invalidCode:
            localize("totp.errors.invalidCode", "Code did not match. Try the next one.")
        case .rateLimited:
            localize(
                "totp.errors.rateLimited",
                "Too many incorrect attempts. Try again in 15 minutes."
            )
        case .enrollmentExpired:
            localize("totp.errors.enrollmentExpired", "Enrollment expired. Close and start over.")
        case let .generic(message):
            message ?? localize("totp.errors.verifyGeneric", "Verification failed.")
        }
    }

    /// Web `handleVerify` short-circuit when the field is incomplete
    /// (`code.length !== 6 → t('totp.errors.codeLength')`).
    public static func incompleteMessage(localize: (String, String) -> String) -> String {
        localize("totp.errors.codeLength", "Enter all 6 digits.")
    }
}

// MARK: - Resolved status view-model (the activated panel's two fields)

/// The activated panel's resolved fields (web "Last used" + "Backup codes
/// remaining"). Strings are already localized / formatted.
public struct TOTPStatusViewModel: Sendable, Equatable {
    public let lastUsedText: String
    public let backupCodesRemaining: Int

    public init(lastUsedText: String, backupCodesRemaining: Int) {
        self.lastUsedText = lastUsedText
        self.backupCodesRemaining = backupCodesRemaining
    }
}

// MARK: - Projection (web render branch resolution)

/// Resolves the cached status snapshot into the render phase + the activated
/// panel's fields. An absent status reproduces the web's
/// `!status.data || mode === 'open'` open-mode fallback so the section never
/// renders blank.
public enum TOTPStatusProjection {
    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and renders a surface otherwise; once a status is known it stays
    /// visible (cached values persist behind refresh / errors). With no cached
    /// status the surface falls back to the open-mode notice (resolved /
    /// empty) or the error state (failed).
    public static func resolvePhase(_ update: TOTPEnrollmentUpdate) -> TOTPStatusPhase {
        switch update.status {
        case .loading:
            update.data.map(phase(for:)) ?? .loading
        case .empty:
            .openMode
        case .loaded:
            update.data.map(phase(for:)) ?? .openMode
        case let .failed(message):
            update.data.map(phase(for:)) ?? .error(message)
        }
    }

    /// The phase for a resolved status (web `mode === 'open'` / `activated`).
    public static func phase(for data: TOTPStatusData) -> TOTPStatusPhase {
        switch data.mode {
        case .open:
            .openMode
        case .session:
            data.activated ? .activated : .notEnrolled
        }
    }

    /// The activated panel's resolved fields (web `last_used_at` →
    /// `formatDateTime` / `'Never'`, and `backup_codes_remaining ?? 0`).
    public static func statusViewModel(
        _ data: TOTPStatusData?,
        localize: (String, String) -> String,
        formatDateTime: (Date) -> String
    ) -> TOTPStatusViewModel {
        let lastUsed = data?.activated == true ? data?.lastUsedAt : nil
        let remaining = data?.activated == true ? (data?.backupCodesRemaining ?? 0) : 0
        let lastUsedText = lastUsed.map(formatDateTime)
            ?? localize("totp.lastUsed.never", "Never")
        return TOTPStatusViewModel(lastUsedText: lastUsedText, backupCodesRemaining: remaining)
    }
}

// MARK: - Accessibility summaries

/// Composed VoiceOver summaries for the status header + the activated panel, so
/// each surface reads as one coherent element rather than disjoint labels.
public enum TOTPAccessibility {
    /// The status header summary (title + the Active / Not-enrolled pill).
    public static func headerSummary(
        phase: TOTPStatusPhase,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("totp.title", "Two-factor authentication")
        let state: String = switch phase {
        case .activated:
            localize("totp.status.active", "Active")
        case .notEnrolled, .openMode, .loading, .error:
            localize("totp.status.notEnrolled", "Not enrolled")
        }
        return "\(title): \(state)"
    }

    /// The activated panel summary (last used + backup-codes remaining).
    public static func activatedSummary(
        _ model: TOTPStatusViewModel,
        localize: (String, String) -> String
    ) -> String {
        let lastUsed = localize("totp.lastUsed.label", "Last used")
        let remaining = localize("totp.backupCodesRemaining.label", "Backup codes remaining")
        return "\(lastUsed): \(model.lastUsedText). \(remaining): \(model.backupCodesRemaining)"
    }
}

// MARK: - Default date formatting

/// The default `formatDateTime` (web `useDateFormat().formatDateTime`) — a
/// medium-date + short-time formatter. Injected as a closure so tests stay
/// deterministic regardless of host locale / timezone.
public enum TOTPDateFormatting {
    public nonisolated(unsafe) static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    public static func format(_ date: Date) -> String {
        formatter.string(from: date)
    }
}

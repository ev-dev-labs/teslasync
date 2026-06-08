//
//  UserImpersonateButton.Adapter.swift
//  TeslaSync — P4 feature view · 0050 · UserImpersonateButton (Apple)
//
//  The testable projection core for the admin "Impersonate" control — the SwiftUI
//  parity of features/admin/components/UserImpersonateButton.tsx. Holds the
//  impersonation status value, the availability gate (web parent's
//  `useImpersonationStatus().data?.mode !== 'open'` + `disabled` prop), the button
//  label projection (web `isPending ? 'Starting…' : 'Impersonate'`), the freshness
//  chip projection, the ConfirmDialog content projection (subject interpolation,
//  web `t('…', { subject })`), and the VoiceOver builders. All pure +
//  dependency-free so the projections can be unit-tested without a seam, a bundle,
//  or a rendered view.
//

import Foundation

// MARK: - Impersonation status value (web `useImpersonationStatus().data`)

/// Install impersonation mode. `open` installs expose no proxy subjects, so the
/// web parent hides the button (`mode !== 'open'`); the native surface renders a
/// friendly unavailable note instead of vanishing.
public enum ImpersonationMode: Sendable, Equatable {
    case open
    case restricted
}

/// The impersonation status the control gates on. `activeSubject` is the subject of
/// the session currently in effect (web global `ImpersonationBanner` driver); when
/// non-nil a new session cannot be started from a row.
public struct ImpersonationStatus: Sendable, Equatable {
    public let mode: ImpersonationMode
    public let activeSubject: String?

    public init(mode: ImpersonationMode, activeSubject: String? = nil) {
        self.mode = mode
        self.activeSubject = activeSubject
    }
}

// MARK: - Status load phase (cache-then-network projection, ADR-013)

/// The settled load phase of the gating status. Mirrors the web query lifecycle
/// (`isLoading` / `data` / `error`) plus an explicit `empty` for a resolved-but-
/// absent payload so the surface never renders a blank box.
public enum ImpersonationStatusPhase: Sendable, Equatable {
    case loading
    case loaded(ImpersonationStatus)
    case empty
    case failed(message: String)

    /// The status value when one is available (fresh or cached).
    public var status: ImpersonationStatus? {
        if case let .loaded(status) = self { return status }
        return nil
    }
}

// MARK: - Freshness / connectivity (mirrors LiveConnectionState, ADR-013)

/// Live-state freshness for the gating status, layered on top of the load phase.
public enum ImpersonationConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Availability gate (web parent gate + `disabled` prop)

/// Whether the row can start an impersonation session, and why not when it can't.
/// Projected from the status (`mode` / `activeSubject`) and the parent-owned
/// `disabled` flag, in the same precedence the web composition implies.
public enum ImpersonationAvailability: Sendable, Equatable {
    /// A session can be started for this subject (web: enabled button).
    case available
    /// Open-access install — impersonation is disabled platform-wide (web: hidden).
    case openMode
    /// A session is already active for someone (web: parent passes `disabled`).
    case alreadyActive(subject: String)
    /// The parent disabled this row (e.g. it is the current admin's own account).
    case disabledByParent

    /// Projects availability from the gating status and the parent `disabled` prop.
    /// Precedence: open-mode → already-active → parent-disabled → available.
    public static func project(
        status: ImpersonationStatus,
        disabledByParent: Bool
    ) -> ImpersonationAvailability {
        if status.mode == .open {
            return .openMode
        }
        if let active = status.activeSubject {
            return .alreadyActive(subject: active)
        }
        if disabledByParent {
            return .disabledByParent
        }
        return .available
    }

    /// Whether a confirm-then-start flow may be initiated (web `!disabled`).
    public var canStart: Bool {
        if case .available = self { return true }
        return false
    }
}

// MARK: - Button label projection (web `isPending ? 'Starting…' : 'Impersonate'`)

/// The label key/fallback pair shown on the action button, mirroring the web
/// ternary on the mutation's `isPending`.
public struct ImpersonateButtonLabel: Equatable {
    public let key: String
    public let fallback: String

    public init(key: String, fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    /// `Starting…` while the start mutation is in flight, else `Impersonate`.
    public static func project(isStarting: Bool) -> ImpersonateButtonLabel {
        isStarting
            ? ImpersonateButtonLabel(key: "impersonation.button.starting", fallback: "Starting…")
            : ImpersonateButtonLabel(key: "impersonation.button.start", fallback: "Impersonate")
    }
}

// MARK: - Freshness chip projection (native chrome for the live-state contract)

/// The freshness chip shown when the gating status is stale or offline.
public struct ImpersonationConnectionChip: Equatable {
    public let tone: TSTone
    public let labelKey: String
    public let labelFallback: String

    public init(tone: TSTone, labelKey: String, labelFallback: String) {
        self.tone = tone
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }

    public static func project(_ connection: ImpersonationConnection) -> ImpersonationConnectionChip {
        switch connection {
        case .live:
            ImpersonationConnectionChip(
                tone: .success,
                labelKey: "impersonation.freshness.live",
                labelFallback: "Live"
            )
        case .stale:
            ImpersonationConnectionChip(
                tone: .warning,
                labelKey: "impersonation.freshness.stale",
                labelFallback: "Stale"
            )
        case .offline:
            ImpersonationConnectionChip(
                tone: .neutral,
                labelKey: "impersonation.freshness.offline",
                labelFallback: "Offline"
            )
        }
    }
}

// MARK: - Unavailable-note projection (web hidden-in-open-mode → friendly note)

/// The friendly note shown in place of an actionable button when the row cannot
/// start a session (open-mode / already-active / parent-disabled). Never a blank
/// surface — the web hides; the native surface explains.
public struct ImpersonationUnavailableNote: Equatable {
    public let messageKey: String
    public let messageFallback: String
    public let systemImage: String

    public init(messageKey: String, messageFallback: String, systemImage: String) {
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.systemImage = systemImage
    }

    /// The note for an availability reason, or `nil` when the row is actionable.
    public static func project(_ availability: ImpersonationAvailability) -> ImpersonationUnavailableNote? {
        switch availability {
        case .available:
            nil
        case .openMode:
            ImpersonationUnavailableNote(
                messageKey: "impersonation.unavailable.openMode",
                messageFallback: "Impersonation is disabled in open-access mode.",
                systemImage: "lock.fill"
            )
        case .alreadyActive:
            ImpersonationUnavailableNote(
                messageKey: "impersonation.unavailable.active",
                messageFallback: "An impersonation session is already active.",
                systemImage: "person.fill.checkmark"
            )
        case .disabledByParent:
            ImpersonationUnavailableNote(
                messageKey: "impersonation.unavailable.disabled",
                messageFallback: "Impersonation isn’t available for this account.",
                systemImage: "person.fill.xmark"
            )
        }
    }
}

// MARK: - ConfirmDialog content (web `ConfirmDialog` props, subject-interpolated)

/// The resolved confirmation-dialog content (web `ConfirmDialog`: title, message,
/// confirm/cancel labels). The message and aria label interpolate the subject the
/// same way the web `t(key, default, { subject })` does, via `%@`.
public struct ImpersonateConfirmContent: Equatable {
    public let title: String
    public let message: String
    public let confirmLabel: String
    public let cancelLabel: String

    public init(title: String, message: String, confirmLabel: String, cancelLabel: String) {
        self.title = title
        self.message = message
        self.confirmLabel = confirmLabel
        self.cancelLabel = cancelLabel
    }

    /// Builds the dialog content, resolving each web key through `localize`
    /// (key, fallback) and `format` (key, fallbackFormat, subject) seams so the
    /// projection stays bundle-free and unit-testable.
    public static func build(
        subject: String,
        localize: (String, String) -> String,
        format: (String, String, String) -> String
    ) -> ImpersonateConfirmContent {
        ImpersonateConfirmContent(
            title: localize("impersonation.confirm.title", "Start impersonation session?"),
            message: format(
                "impersonation.confirm.message",
                "You will see TeslaSync as %@ for up to 15 minutes. The action is logged to the audit log. "
                    + "End the session from the banner when you are done.",
                subject
            ),
            confirmLabel: localize("impersonation.confirm.confirm", "Start impersonation"),
            cancelLabel: localize("impersonation.confirm.cancel", "Cancel")
        )
    }
}

// MARK: - Accessibility builders (testable seam)

/// Builds the VoiceOver strings for the surface. Pure + public so the spoken
/// content can be unit-tested without rendering the view.
public enum ImpersonateAccessibility {
    /// The button's spoken label (web `aria-label="Impersonate {{subject}}"`).
    public static func buttonLabel(subject: String, format: (String, String, String) -> String) -> String {
        format("impersonation.button.aria", "Impersonate %@", subject)
    }

    /// The stable automation identifier (web `data-testid`).
    public static func testID(subject: String) -> String {
        "user-impersonate-button-\(subject)"
    }
}

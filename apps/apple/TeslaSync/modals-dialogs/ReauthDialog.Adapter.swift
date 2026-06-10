//
//  ReauthDialog.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  The testable projection core for the step-up reauth dialog — the faithful port of
//  components/feedback/ReauthDialog.tsx. The web source is a `Modal` wrapping a form that runs in one
//  of two modes resolved from the auth install: `credential` (forward-auth — a Password tab plus, when
//  enrolled, an Authenticator tab, POSTed to mint a sudo token) and `confirm` (open-mode — a
//  typed-confirmation field that resolves locally with no token). Everything here is pure and
//  dependency-free (Foundation only) so the projection — phase resolution, the tab catalog, the TOTP
//  sanitiser (web `replace(/\D/g,'').slice(0,8)`), the typed-confirmation guard, the submit body
//  assembly, the field-required validation, and the server-error → message mapping — can be
//  unit-tested without a store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `DialogMode` ('credential' | 'confirm')        → `ReauthMode`.
//    • `activeTab` ('password' | 'totp')              → `ReauthMethod`.
//    • `SudoCredential { mode, token, expiresAt }`    → `ReauthCredential`.
//    • `SudoSubmitBody { password?, totp_code? }`     → `ReauthSubmitBody`.
//    • `onSubmitCredential` resolve / throw(code)     → `ReauthSubmitOutcome`.
//    • `TYPED_CONFIRMATION_TOKEN = 'CONFIRM'`         → `ReauthProjection.typedConfirmationToken`.
//    • `handleSubmit` guards + error branches         → `ReauthProjection` pure helpers.
//    • The web only ever shows the form; `resolvePhase` widens that into the prompt-required
//      loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so
/// the projection's unit tests can reach it.
public enum ReauthSurface {
    public static let slug = "ReauthDialog"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the reauth challenge context (the active challenge + the
/// resolved auth mode + the TOTP tab availability). The web reads these synchronously from hooks; the
/// native surface models the load lifecycle here so every state renders.
public enum ReauthLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the dialog
/// clearly labels when the resolved auth mode may be momentarily out of date during a proxy flip.
public enum ReauthConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface should render at the top level. The web only ever shows the form when a challenge
/// is active; the loading + empty + error envelopes are added so the first-resolve, no-challenge, and
/// mode-resolution-failure cases never render a blank panel.
public enum ReauthPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Mode + method (web `DialogMode` / `activeTab`)

/// The mode the dialog operates in — the native parity of the web `DialogMode`. Forward-auth installs
/// require a credential; open-mode installs only need a typed confirmation.
public enum ReauthMode: String, Sendable, Equatable {
    case credential
    case confirm
}

/// The selected credential method — the native parity of the web `activeTab` union. `password` is
/// always available; `totp` appears only when the Authenticator tab is offered.
public enum ReauthMethod: String, Sendable, Equatable, Identifiable, CaseIterable {
    case password
    case totp

    public var id: String {
        rawValue
    }
}

// MARK: - Challenge context + credential payloads

/// The challenge context a source resolves: the API path that triggered the step-up (web `path`), the
/// resolved auth mode (web `useSessionMonitor` → 'open' ? confirm : credential), and whether the TOTP
/// tab is offered (web `totpTabAvailable`). The native surface models this as loadable so the dialog
/// can show loading / empty / error before the form.
public struct ReauthChallengeContext: Sendable, Equatable {
    public let path: String
    public let mode: ReauthMode
    public let totpTabAvailable: Bool

    public init(path: String, mode: ReauthMode, totpTabAvailable: Bool) {
        self.path = path
        self.mode = mode
        self.totpTabAvailable = totpTabAvailable
    }
}

/// The validated credential handed back on a successful submission — the native parity of the web
/// `SudoCredential { mode, token, expiresAt }`. `open` mode carries no token (the confirm flow), while
/// `session` mode carries the minted sudo token + expiry.
public struct ReauthCredential: Sendable, Equatable {
    /// The credential mode the server (or the confirm flow) resolved to.
    public enum Mode: String, Sendable, Equatable {
        case session
        case open
    }

    public let mode: Mode
    public let token: String?
    public let expiresAt: String?

    public init(mode: Mode, token: String? = nil, expiresAt: String? = nil) {
        self.mode = mode
        self.token = token
        self.expiresAt = expiresAt
    }
}

/// The body submitted to the credential service — the native parity of the web `SudoSubmitBody`. A
/// password submission carries `password`; a TOTP submission carries `totpCode` (web `totp_code`).
public struct ReauthSubmitBody: Sendable, Equatable {
    public let password: String?
    public let totpCode: String?

    public init(password: String? = nil, totpCode: String? = nil) {
        self.password = password
        self.totpCode = totpCode
    }
}

/// The result of a credential submission — the native parity of the web `onSubmitCredential` promise
/// resolving with a `SudoCredential` or throwing an `Error & { code }`.
public enum ReauthSubmitOutcome: Sendable, Equatable {
    case success(ReauthCredential)
    case failure(code: String?, message: String)
}

/// The server error codes the dialog branches on (web `err.code`).
public enum ReauthErrorCode {
    public static let notConfigured = "REAUTH_NOT_CONFIGURED"
    public static let invalidCredential = "INVALID_CREDENTIAL"
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: phase resolution, the tab catalog, the
/// TOTP sanitiser, the typed-confirmation guard, the submit body assembly, the field-required
/// validation, the server-error → message mapping, and the mode-driven copy (title / body / submit /
/// confirm-field label). All copy resolves through an injected localizer so it stays bundle-free.
public enum ReauthProjection {
    /// The literal a user types to confirm a destructive open-mode action (web
    /// `TYPED_CONFIRMATION_TOKEN`).
    public static let typedConfirmationToken = "CONFIRM"

    /// The maximum TOTP length the field accepts (web `.slice(0, 8)`).
    public static let totpMaxLength = 8

    /// Resolves the render phase. Loading shows only before the challenge resolves; a resolved
    /// no-challenge state shows the empty envelope; a mode-resolution failure with no cached context
    /// shows the error state; once a challenge is on hand the form stays on screen (freshness shown by
    /// the chip / banner).
    public static func resolvePhase(
        status: ReauthLoadStatus,
        context: ReauthChallengeContext?
    ) -> ReauthPhase {
        switch status {
        case .loading:
            context == nil ? .loading : .content
        case .loaded:
            context == nil ? .empty : .content
        case let .failed(message):
            context == nil ? .error(message) : .content
        }
    }

    /// The credential methods to offer — the web `credentialTabs`: password is always present; totp is
    /// appended only when the Authenticator tab is available.
    public static func methods(totpTabAvailable: Bool) -> [ReauthMethod] {
        totpTabAvailable ? [.password, .totp] : [.password]
    }

    /// Sanitises a raw TOTP entry to ASCII digits, capped at `totpMaxLength` — the verbatim port of the
    /// web `value.replace(/\D/g, '').slice(0, 8)`.
    public static func sanitizeTOTP(_ raw: String) -> String {
        String(raw.filter { $0.isASCII && $0.isNumber }.prefix(totpMaxLength))
    }

    /// Whether the typed confirmation matches (web `confirmText.trim() === TYPED_CONFIRMATION_TOKEN`).
    public static func confirmMatches(_ text: String) -> Bool {
        text.reauthTrimmed == typedConfirmationToken
    }

    /// Assembles the submit body for the active method — the web `activeTab === 'password' ? { password
    /// } : { totp_code: totp }`.
    public static func credentialBody(method: ReauthMethod, password: String, totp: String) -> ReauthSubmitBody {
        switch method {
        case .password:
            ReauthSubmitBody(password: password)
        case .totp:
            ReauthSubmitBody(totpCode: totp)
        }
    }

    /// The empty-field validation message, or `nil` when the active method's field is non-empty — the
    /// web `if (password.trim() === '')` / `if (totp.trim() === '')` guards.
    public static func credentialFieldError(
        method: ReauthMethod,
        password: String,
        totp: String,
        localize: (String, String) -> String
    ) -> String? {
        switch method {
        case .password:
            guard password.reauthTrimmed.isEmpty else { return nil }
            return localize("sudo.errors.passwordRequired", "Enter your password to continue.")
        case .totp:
            guard totp.reauthTrimmed.isEmpty else { return nil }
            return localize("sudo.errors.totpRequired", "Enter the 6-digit code from your authenticator.")
        }
    }

    /// Maps a failed submission to the message the dialog shows — the web catch branch: the
    /// not-configured hint, the method-specific invalid-credential message, else the server message or
    /// the unknown fallback.
    public static func submitErrorMessage(
        code: String?,
        message: String,
        method: ReauthMethod,
        localize: (String, String) -> String
    ) -> String {
        switch code {
        case ReauthErrorCode.notConfigured:
            let lead = "Step-up reauth is not configured on this server. "
            let tail = "Ask your administrator to set TESLASYNC_SUDO_PASSWORD or TESLASYNC_SUDO_TOTP_SECRET."
            return localize("sudo.errors.notConfigured", lead + tail)
        case ReauthErrorCode.invalidCredential:
            return method == .password
                ? localize("sudo.errors.invalidPassword", "Password did not match.")
                : localize("sudo.errors.invalidTotp", "Authenticator code was rejected.")
        default:
            let trimmed = message.reauthTrimmed
            return trimmed.isEmpty ? localize("sudo.errors.unknown", "Reauthentication failed.") : trimmed
        }
    }

    /// The typed-confirmation mismatch message with the token substituted (web
    /// `t('sudo.errors.typedConfirmationMismatch', …, { token })`).
    public static func typedConfirmationMismatchMessage(localize: (String, String) -> String) -> String {
        let template = localize("sudo.errors.typedConfirmationMismatch", "Type {{token}} exactly to confirm.")
        return substituteToken(template)
    }

    /// The dialog title for the mode (web `dialogTitle`).
    public static func title(mode: ReauthMode, localize: (String, String) -> String) -> String {
        switch mode {
        case .confirm:
            localize("sudo.openMode.title", "Confirm sensitive action")
        case .credential:
            localize("sudo.title", "Confirm your identity")
        }
    }

    /// The body copy under the title for the mode (web modal body paragraph).
    public static func bodyText(mode: ReauthMode, localize: (String, String) -> String) -> String {
        switch mode {
        case .confirm:
            let template = localize(
                "sudo.openMode.body",
                "This is a destructive action. Type {{token}} to continue."
            )
            return substituteToken(template)
        case .credential:
            let lead = "For your security, please re-enter your password or "
            let tail = "authenticator code before this action runs."
            return localize("sudo.description", lead + tail)
        }
    }

    /// The submit-button title for the mode (web `openMode.submit` / `submit`).
    public static func submitTitle(mode: ReauthMode, localize: (String, String) -> String) -> String {
        switch mode {
        case .confirm:
            localize("sudo.openMode.submit", "Continue")
        case .credential:
            localize("sudo.submit", "Confirm")
        }
    }

    /// The typed-confirmation field label with the token substituted (web `typedConfirmationLabel`).
    public static func confirmFieldLabel(localize: (String, String) -> String) -> String {
        let template = localize("sudo.typedConfirmationLabel", "Type {{token}} to confirm")
        return substituteToken(template)
    }

    /// The credential helper line (web `HelperText`).
    public static func helperText(localize: (String, String) -> String) -> String {
        let lead = "Your reauth lasts 5 minutes; "
        let tail = "rapid follow-up actions will not re-prompt."
        return localize("sudo.helper", lead + tail)
    }

    /// The display label for a credential method tab (web `sudo.tabs.*`).
    public static func methodLabel(_ method: ReauthMethod, localize: (String, String) -> String) -> String {
        switch method {
        case .password:
            localize("sudo.tabs.password", "Password")
        case .totp:
            localize("sudo.tabs.totp", "Authenticator")
        }
    }

    /// The field label for the active credential input (web `passwordLabel` / `totpLabel`).
    public static func fieldLabel(_ method: ReauthMethod, localize: (String, String) -> String) -> String {
        switch method {
        case .password:
            localize("sudo.passwordLabel", "Password")
        case .totp:
            localize("sudo.totpLabel", "Authenticator code")
        }
    }

    // MARK: Internals

    /// Substitutes the i18next `{{token}}` interpolation marker with the confirmation token.
    private static func substituteToken(_ template: String) -> String {
        template.replacingOccurrences(of: "{{token}}", with: typedConfirmationToken)
    }
}

// MARK: - Small helpers

extension String {
    /// Whitespace/newline-trimmed copy (web `String.prototype.trim`).
    var reauthTrimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

//
//  UserCell.Adapter.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  The testable, dependency-light projection core for the shared UserCell primitive — the SwiftUI
//  parity of `components/data-display/UserCell.tsx`. Everything here is pure (Foundation only): the
//  user input value, the surface descriptor (the native mirror of the web `UserCellProps`), the
//  verbatim port of the web display-name priority (name → email local-part → id → "Unknown user"),
//  the empty-vs-populated decision, the resolved view-state, the projection, the surface metadata,
//  and the accessibility builder. No SwiftUI, no store, no rendered view, so each piece is unit
//  tested in isolation against the web reference.
//
//  Parity note: the web UserCell is a drop-in table cell for user-attributed columns (audit-log
//  "actor", feedback-queue "reporter", notification-log "delivered to"). It renders the shared
//  Avatar alongside the display name, with an optional muted email line beneath, and an em-dash
//  when the user carries no identifying signal. It composes the Avatar surface (0076) for the
//  glyph/initials/image disc, so this core only owns the cell's own derivations; the avatar's
//  colour / initials machinery stays in `Avatar.Adapter.swift`.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity resolver.
public typealias UserCellResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - User input (web `UserCellUser`)

/// One user the cell attributes a row to — the native mirror of the web `UserCellUser`. Every
/// field is optional (the web fields are `string | null | undefined`); a user with no name, email,
/// or id renders the em-dash empty cell.
public struct UserCellUser: Sendable, Equatable {
    public var id: String?
    public var name: String?
    public var email: String?
    public var avatarURL: String?

    public init(
        id: String? = nil,
        name: String? = nil,
        email: String? = nil,
        avatarURL: String? = nil
    ) {
        self.id = id
        self.name = name
        self.email = email
        self.avatarURL = avatarURL
    }
}

// MARK: - Input descriptor (the surface inputs — web component props)

/// One coalesced snapshot of the cell's inputs — the native mirror of the web `UserCellProps`
/// (`user`, `showEmail`, `size`; the web `className` is a styling concern with no native analogue).
/// The P1/S8 source emits this; the view binds the model over it. The cell performs no fetch of its
/// own — the only "fetch" is the avatar's optional remote image, owned by the composed Avatar.
public struct UserCellDescriptor: Sendable, Equatable {
    public var user: UserCellUser?
    public var showEmail: Bool
    public var size: AvatarSize

    public init(
        user: UserCellUser? = nil,
        showEmail: Bool = false,
        size: AvatarSize = .sm
    ) {
        self.user = user
        self.showEmail = showEmail
        self.size = size
    }
}

// MARK: - Identity derivation (verbatim port of the web display-name priority)

/// The pure identity derivations — the JavaScript truthiness rules the web cell relies on, the
/// email local-part split, and the display-name priority chain. Verbatim ports of the web
/// expressions so the same user resolves to the same label on web + Apple.
public enum UserCellIdentity {
    /// Whether a string is "falsy" in the JavaScript sense the web empty-check uses (`!value`):
    /// `nil` or the empty string. A whitespace-only string is NOT falsy (it is a non-empty string),
    /// matching the web `!user.name` test which runs on the untrimmed value.
    public static func isFalsy(_ value: String?) -> Bool {
        (value ?? "").isEmpty
    }

    /// The portion of an email address before the first `@` — the web `email.split('@')[0]`. An
    /// address with no `@` yields the whole string; one beginning with `@` yields the empty string.
    public static func emailLocalPart(_ email: String) -> String {
        String(email.prefix { $0 != "@" })
    }

    /// Whether the cell has no identifying signal and renders the em-dash — the web
    /// `!user || (!user.name && !user.email && !user.id)`, evaluated on the untrimmed values.
    public static func isEmpty(_ user: UserCellUser?) -> Bool {
        guard let user else { return true }
        return isFalsy(user.name) && isFalsy(user.email) && isFalsy(user.id)
    }

    /// The visible display name — the verbatim port of the web priority chain
    /// `name.trim() || email-local-part || id || t('avatar.unknown')`. The name is trimmed first;
    /// the email local-part and the id are used only when non-empty; otherwise the localised
    /// "Unknown user" word is returned.
    public static func displayName(for user: UserCellUser, unknownWord: String) -> String {
        let trimmedName = (user.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedName.isEmpty { return trimmedName }
        if let email = user.email, !email.isEmpty {
            let localPart = emailLocalPart(email)
            if !localPart.isEmpty { return localPart }
        }
        if let identifier = user.id, !identifier.isEmpty { return identifier }
        return unknownWord
    }
}

// MARK: - Resolved populated cell (web populated branch inputs)

/// The resolved, view-ready content for a populated cell — every decision pre-computed so the view
/// is a pure function of this value. `avatarUserID` / `avatarURL` feed the composed Avatar (web
/// `userId={user.id} src={user.avatarUrl}`); `displayName` is the computed visible label and the
/// avatar's name seed; `email` is the optional muted line beneath, present only when `showEmail`
/// is set and the address is non-empty (web `showEmail && user.email`).
public struct UserCellPopulated: Sendable, Equatable {
    public let displayName: String
    public let avatarUserID: String?
    public let avatarURL: String?
    public let email: String?
    public let size: AvatarSize

    public init(
        displayName: String,
        avatarUserID: String?,
        avatarURL: String?,
        email: String?,
        size: AvatarSize
    ) {
        self.displayName = displayName
        self.avatarUserID = avatarUserID
        self.avatarURL = avatarURL
        self.email = email
        self.size = size
    }
}

// MARK: - Resolved view-state (web render branches)

/// The resolved cell state — the two render branches the web component produces: the em-dash empty
/// cell (no identifying signal) and the populated cell (avatar + name + optional email). The view
/// renders both; neither is a hidden / blank surface.
public enum UserCellResolved: Sendable, Equatable {
    /// No identifying signal — the web em-dash empty cell.
    case empty
    /// Avatar + display name + optional email — the web populated cell.
    case populated(UserCellPopulated)
}

// MARK: - Projection (descriptor → resolved view-state)

/// Pure projection from the input descriptor to the resolved view-state — the native port of the
/// web component body (the empty-check, the display-name priority, and the `showEmail` gate). The
/// view is a pure function of this value; every branch is unit tested. The localised "Unknown user"
/// word is passed in so the core stays bundle-free.
public enum UserCellProjection {
    /// The em-dash glyph the empty cell renders (web textual em-dash).
    public static let emptyGlyph = "—"

    public static func resolve(_ descriptor: UserCellDescriptor, unknownWord: String) -> UserCellResolved {
        guard let user = descriptor.user, !UserCellIdentity.isEmpty(user) else {
            return .empty
        }
        let displayName = UserCellIdentity.displayName(for: user, unknownWord: unknownWord)
        let email: String? = {
            guard descriptor.showEmail, let address = user.email, !address.isEmpty else { return nil }
            return address
        }()
        return .populated(UserCellPopulated(
            displayName: displayName,
            avatarUserID: user.id,
            avatarURL: user.avatarURL,
            email: email,
            size: descriptor.size
        ))
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// The static identity of the surface — the P1/S11 diagnostics slug emitted with `view.opened`.
public enum UserCellMeta {
    /// The diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "UserCell"
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the cell's VoiceOver strings from the already-resolved content, so the spoken content is
/// asserted without rendering the view. The populated cell is one element whose label is the
/// display name and whose value is the email line (when shown); the empty cell speaks the em-dash.
public enum UserCellAccessibility {
    /// The spoken label for a populated cell — the display name (the same visible label, and the
    /// avatar's identity, folded into one announcement so the name is not voiced twice).
    public static func label(for populated: UserCellPopulated) -> String {
        populated.displayName
    }

    /// The spoken value for a populated cell — the email line when shown, else empty (no value).
    public static func value(for populated: UserCellPopulated) -> String {
        populated.email ?? ""
    }
}

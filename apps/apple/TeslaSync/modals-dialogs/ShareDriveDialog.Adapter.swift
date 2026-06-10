//
//  ShareDriveDialog.Adapter.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The testable, dependency-free projection core for the drive-sharing dialog — the faithful port of
//  features/driving/components/ShareDriveDialog.tsx and the `ShareToken` / `CreateShareRequest`
//  wire types (web/src/types/sharing.ts) it binds to. The web source is a `Modal` wrapping a create
//  form (title `Input`, two `Toggle`s, an expiry `Select`, a "Generate Link" button) that POSTs through
//  `useCreateShareLink`, swaps to a success/result panel (the `${origin}/s/${token}` URL + Copy / open /
//  "Create another link"), and lists the drive's existing `useShareLinks` rows (title, views, expiry
//  status, copy, revoke via `useRevokeShareLink`). Everything here is pure Foundation so the enums, the
//  `getPayload` request builder (`title || undefined`, `Number(expiryDays) || undefined`), the share-URL
//  composition, the per-row expiry computation, and the links phase resolution all unit-test without a
//  store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • create payload (`title || undefined`,            → `ShareDriveProjection.createInput(...)`.
//      `Number(expiryDays) || undefined`)
//    • `${window.location.origin}/s/${token}`           → `ShareDriveURLBuilding` seam (origin + token).
//    • row `isExpired = expires_at ? new Date(...) <    → `ShareDriveProjection.expiryState(_:now:)`.
//      new Date() : false` + Expired/Expires/No expiry
//    • `existingShares ?? []` + `sharesLoading`         → `ShareDriveProjection.resolveLinksPhase(...)`
//      (loading / empty / error+retry / content), so the list area never renders a blank box.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum ShareDriveSurface {
    public static let slug = "ShareDriveDialog"
}

// MARK: - Load status / links phase / freshness

/// The bound source's load status for the drive's existing share links (web `useShareLinks` query
/// lifecycle). The web reads `existingShares` + `isLoading`; the native surface models the loadable
/// list here so every prompt-required state renders.
public enum ShareLinksLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the dialog
/// labels when the listed links may be out of date.
public enum ShareDriveConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the "Active Share Links" section renders. The web simply hides the section when there are no
/// rows; the native surface widens that into the prompt-required loading / empty / error envelopes so
/// the section is never a hidden or blank box.
public enum ShareLinksPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Expiry options (web `Select` values '7' | '30' | '90' | '0')

/// The link-expiry choices (web `<Select>` options). Each carries its web option `value` (the day
/// count, `0` == Never), its i18n key + English fallback, and the request's `expires_in_days` mapping
/// (`Number(expiryDays) || undefined` → `never` sends `nil`).
public enum ShareExpiry: String, Sendable, Equatable, CaseIterable, Identifiable {
    case days7
    case days30
    case days90
    case never

    public var id: String {
        rawValue
    }

    /// The web `<option value>` string (`'7' | '30' | '90' | '0'`).
    public var optionValue: String {
        switch self {
        case .days7: "7"
        case .days30: "30"
        case .days90: "90"
        case .never: "0"
        }
    }

    /// The request's `expires_in_days` (web `Number(expiryDays) || undefined` — `0` → `nil`).
    public var expiresInDays: Int? {
        switch self {
        case .days7: 7
        case .days30: 30
        case .days90: 90
        case .never: nil
        }
    }

    /// The web i18n key for this option's label.
    public var labelKey: String {
        switch self {
        case .days7: "share.expiry7d"
        case .days30: "share.expiry30d"
        case .days90: "share.expiry90d"
        case .never: "share.expiryNever"
        }
    }

    /// The web English fallback for this option's label.
    public var labelFallback: String {
        switch self {
        case .days7: "7 days"
        case .days30: "30 days"
        case .days90: "90 days"
        case .never: "Never"
        }
    }
}

// MARK: - Per-row expiry status (web `isExpired` ternary)

/// One share link's expiry status (web `isExpired ? 'Expired' : expires_at ? 'Expires {date}' : 'No
/// expiry'`). The active case carries the expiry instant so the view can format it through the date
/// facade.
public enum ShareExpiryState: Sendable, Equatable {
    case expired
    case active(Date)
    case none
}

// MARK: - Share link (web `ShareToken`)

/// A drive's existing share link — the native projection of the `ShareToken` wire row (web
/// `web/src/types/sharing.ts`). Carries only what the dialog renders: the id, the public token, the
/// optional title, the view tally, and the parsed expiry instant (the source parses the ISO
/// `expires_at` at the boundary so the core stays date-typed and bundle-free).
public struct ShareLink: Sendable, Equatable, Identifiable {
    public let id: Int
    public let token: String
    public let title: String?
    public let views: Int
    public let expiresAt: Date?

    public init(id: Int, token: String, title: String?, views: Int, expiresAt: Date?) {
        self.id = id
        self.token = token
        self.title = title
        self.views = views
        self.expiresAt = expiresAt
    }
}

/// A presentation row for one share link: the identity + title + tally carried through, the resolved
/// expiry status (web `isExpired` ternary), and the composed public URL (web `${origin}/s/${token}`)
/// the row's copy button writes to the clipboard.
public struct ShareLinkRow: Sendable, Equatable, Identifiable {
    public let id: Int
    public let token: String
    public let title: String?
    public let views: Int
    public let expiry: ShareExpiryState
    public let shareURL: String

    public init(
        id: Int,
        token: String,
        title: String?,
        views: Int,
        expiry: ShareExpiryState,
        shareURL: String
    ) {
        self.id = id
        self.token = token
        self.title = title
        self.views = views
        self.expiry = expiry
        self.shareURL = shareURL
    }

    /// Whether the row should fall back to the "Untitled share" copy (web `share.title ?? 'Untitled
    /// share'`): a nil or whitespace-only title.
    public var isUntitled: Bool {
        (title?.trimmed.isEmpty ?? true)
    }
}

// MARK: - Create request (web `CreateShareRequest`)

/// The validated create payload the "Generate Link" button submits — the native parity of the web
/// `{ title, include_speed, include_telemetry, expires_in_days }` body handed to `useCreateShareLink`.
public struct CreateShareInput: Sendable, Equatable {
    public let title: String?
    public let includeSpeed: Bool
    public let includeTelemetry: Bool
    public let expiresInDays: Int?

    public init(title: String?, includeSpeed: Bool, includeTelemetry: Bool, expiresInDays: Int?) {
        self.title = title
        self.includeSpeed = includeSpeed
        self.includeTelemetry = includeTelemetry
        self.expiresInDays = expiresInDays
    }
}

// MARK: - Command outcomes (web mutation `onSuccess` / `onError`)

/// The create mutation result (web `createShare.mutateAsync` resolve → the new token, reject → the
/// error message). Success carries the token the model composes into the result panel's share URL.
public enum ShareCreateOutcome: Sendable, Equatable {
    case success(token: String)
    case failure(String)
}

/// The revoke mutation result (web `revokeShare.mutateAsync` resolve / reject). The token is echoed
/// back so the model can clear that row's in-flight state; success triggers a list refetch (web
/// `invalidateQueries`), failure surfaces an inline message.
public enum ShareRevokeOutcome: Sendable, Equatable {
    case success(token: String)
    case failure(token: String, message: String)
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: the links-section phase resolution,
/// the per-row expiry status, the create-request builder, and the presentation-row projection.
public enum ShareDriveProjection {
    /// Resolves the "Active Share Links" section phase. Loading shows only before the first list
    /// resolves; a resolved-but-empty list shows the friendly empty state; a non-empty list shows the
    /// rows; a failure with no cached rows shows the error+retry state, while a failure with cached
    /// rows keeps the list on screen (the inline error is surfaced separately).
    public static func resolveLinksPhase(
        status: ShareLinksLoadStatus,
        links: [ShareLink]
    ) -> ShareLinksPhase {
        switch status {
        case .loading:
            links.isEmpty ? .loading : .content
        case .loaded:
            links.isEmpty ? .empty : .content
        case let .failed(message):
            links.isEmpty ? .error(message) : .content
        }
    }

    /// One link's expiry status (web `isExpired = expires_at ? new Date(expires_at) < new Date() :
    /// false`, then the Expired / Expires{date} / No expiry ternary).
    public static func expiryState(_ expiresAt: Date?, now: Date) -> ShareExpiryState {
        guard let expiresAt else { return .none }
        return expiresAt < now ? .expired : .active(expiresAt)
    }

    /// The web `handleCreate` request body: `title || undefined` (only an empty string becomes nil,
    /// matching JS truthiness) and `expires_in_days: Number(expiryDays) || undefined`.
    public static func createInput(
        title: String,
        includeSpeed: Bool,
        includeTelemetry: Bool,
        expiry: ShareExpiry
    ) -> CreateShareInput {
        CreateShareInput(
            title: title.isEmpty ? nil : title,
            includeSpeed: includeSpeed,
            includeTelemetry: includeTelemetry,
            expiresInDays: expiry.expiresInDays
        )
    }

    /// Projects the loaded links into presentation rows: the expiry status per `now` and the public
    /// share URL per `buildURL` (web `${window.location.origin}/s/${share.token}`).
    public static func rows(
        from links: [ShareLink],
        now: Date,
        buildURL: (String) -> String
    ) -> [ShareLinkRow] {
        links.map { link in
            ShareLinkRow(
                id: link.id,
                token: link.token,
                title: link.title,
                views: link.views,
                expiry: expiryState(link.expiresAt, now: now),
                shareURL: buildURL(link.token)
            )
        }
    }
}

// MARK: - Small helpers

extension String {
    /// Whitespace/newline-trimmed copy.
    var trimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

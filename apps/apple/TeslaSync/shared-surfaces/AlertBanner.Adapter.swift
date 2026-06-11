//
//  AlertBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  The testable, dependency-light core for the AlertBanner shared surface — the SwiftUI parity of
//  `components/feedback/AlertBanner.tsx`. Everything here is pure (Foundation only): the variant
//  axis (web `'info' | 'success' | 'warning' | 'danger'`) and its SF Symbol, the connectivity axis
//  (the documented `OfflineBanner` / `LiveStaleDataBanner` consumers), the mutation-toast event (the
//  documented `useMutationToast` `success` / `error` calls), the controlled `AlertBannerNotice` (the
//  web props: variant + optional icon + optional title + message + dismissability), its two
//  documented bridges, the resolved `AlertBannerContent`, and the VoiceOver label builder. No store,
//  no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `AlertBanner` is a fully-controlled presentational banner — the caller
//  supplies the `variant`, the optional `title`, the `children` message, the optional `icon`, and
//  the optional `onClose`. It has NO `t()` calls of its own (the surface is "anonymous"). This 0113
//  SHARED SURFACE is the higher-level host that drives that banner. `AlertBannerNotice` reproduces
//  the web props 1:1; `AlertBannerNotice.from(mutation:)` bridges the documented `useMutationToast`
//  bus (`success(title)` / `error(err, title)`), and `AlertBannerNotice.connectivity(for:)` bridges
//  the documented `OfflineBanner` / `LiveStaleDataBanner` consumers. The variant→tint and the
//  dual-tinted title+message are applied at the view boundary (P1/S9 tokens), never here.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias AlertBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Variant (web `'info' | 'success' | 'warning' | 'danger'`)

/// The banner variant — the native mirror of the web `AlertBanner` `variant` union and its
/// `alertVariantMap`. The tint is applied at the view boundary (P1/S9 tokens); this enum only owns
/// the variant identity + the default SF Symbol so both are asserted without rendering.
public enum AlertBannerVariant: String, Sendable, Equatable, CaseIterable {
    case info
    case success
    case warning
    case danger

    /// The SF Symbol that names the variant when the caller supplies no explicit `icon` — the
    /// native parity of the web caller's optional `icon` prop.
    public var defaultSymbolName: String {
        switch self {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Connectivity (web `OfflineBanner` / `LiveStaleDataBanner` consumers)

/// The freshness of the live pipe the host renders over — the native mirror of the documented
/// `OfflineBanner` (browser offline) and `LiveStaleDataBanner` (live feed disconnected ≥ 2 min)
/// consumers. `live` shows neither the connectivity banner nor the freshness chip.
public enum AlertBannerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Mutation toast (web `useMutationToast`)

/// Which `useMutationToast` call produced the event — `success(title)` or `error(err, title)`.
public enum AlertBannerMutationKind: String, Sendable, Equatable, CaseIterable {
    case success
    case error
}

/// One coalesced mutation-toast event — the native parity of a `useMutationToast` `success` /
/// `error` call. `title` is the already-translated message the caller passed (web
/// `t(key, fallback)`); `detail` is the error's `message` shown as the secondary line (web
/// `err instanceof Error ? err.message : …`), absent for `success`.
public struct AlertBannerMutation: Sendable, Equatable {
    public let kind: AlertBannerMutationKind
    public let title: String
    public let detail: String?

    public init(kind: AlertBannerMutationKind, title: String, detail: String? = nil) {
        self.kind = kind
        self.title = title
        self.detail = detail
    }
}

// MARK: - Banner text (verbatim caller content vs facade-resolved copy)

/// One line of banner text. `verbatim` carries an already-resolved runtime string (the web `title`
/// prop / `children` — for the host, the mutation-toast title + `err.message`); `localized` carries
/// a (key, English fallback) pair the view resolves through the P1/S10 facade (the connectivity
/// consumers' copy). Keeping the projection in terms of this enum means it stays pure and tests
/// assert the keys directly.
public enum AlertBannerText: Sendable, Equatable {
    case verbatim(String)
    case localized(key: String, fallback: String)

    /// Resolves the line to a display string: a `verbatim` value is returned as-is (the caller
    /// already localised it, web parity for the `title` prop / `children`); a `localized` line is
    /// resolved through the supplied facade (web `t(key, fallback)`). Pure, so it is asserted with
    /// an identity resolver.
    public func resolve(_ resolver: AlertBannerResolve) -> String {
        switch self {
        case let .verbatim(value): value
        case let .localized(key, fallback): resolver(key, fallback)
        }
    }
}

// MARK: - Notice (the controlled web props: variant + icon? + title? + message + onClose?)

/// The controlled banner the host wants to show — the native parity of the web `AlertBanner` props
/// (`variant`, optional `icon`, optional `title`, `children` message, and whether `onClose` is
/// offered). The host builds one directly (a raw `<AlertBanner variant=… title=…>…</>`), from a
/// mutation toast (`from(mutation:)`), or from the connectivity axis (`connectivity(for:)`).
public struct AlertBannerNotice: Sendable, Equatable {
    public let variant: AlertBannerVariant
    public let symbolName: String?
    public let title: AlertBannerText?
    public let message: AlertBannerText
    public let dismissable: Bool

    public init(
        variant: AlertBannerVariant,
        symbolName: String? = nil,
        title: AlertBannerText? = nil,
        message: AlertBannerText,
        dismissable: Bool = false
    ) {
        self.variant = variant
        self.symbolName = symbolName
        self.title = title
        self.message = message
        self.dismissable = dismissable
    }

    /// The resolved render value — fills the icon from the variant default when the caller supplied
    /// none (web optional `icon`) and gates the trailing dismiss on the host handler (web `onClose`
    /// must be wired AND the notice must be dismissible).
    public func content(canDismiss: Bool) -> AlertBannerContent {
        AlertBannerContent(
            variant: variant,
            symbolName: symbolName ?? variant.defaultSymbolName,
            title: title,
            message: message,
            showDismiss: dismissable && canDismiss
        )
    }

    /// Bridges a `useMutationToast` event to a notice. `success` → the `success` variant with the
    /// toast title as the single message line (web `success(title)` is one line). `error` → the
    /// `danger` variant; when the error carries a `message` the toast title becomes the emphasised
    /// title line and the detail becomes the secondary message (web "title + err.message"),
    /// otherwise the title is the single line. Mutation banners are dismissible (web `onClose`).
    public static func from(mutation: AlertBannerMutation) -> AlertBannerNotice {
        let variant: AlertBannerVariant = mutation.kind == .success ? .success : .danger
        let hasDetail = !(mutation.detail ?? "").isEmpty
        return AlertBannerNotice(
            variant: variant,
            symbolName: nil,
            title: hasDetail ? .verbatim(mutation.title) : nil,
            message: hasDetail ? .verbatim(mutation.detail ?? "") : .verbatim(mutation.title),
            dismissable: true
        )
    }

    /// Bridges the connectivity axis to a notice. `offline` reproduces the web `OfflineBanner`
    /// (`pwa.offline.*`); `stale` reproduces the web `LiveStaleDataBanner` (`live.staleBanner.*`).
    /// Both are `warning` and non-dismissible (they clear when the pipe recovers). `live` → `nil`.
    public static func connectivity(for connection: AlertBannerConnection) -> AlertBannerNotice? {
        switch connection {
        case .live:
            nil
        case .stale:
            AlertBannerNotice(
                variant: .warning,
                symbolName: "clock.badge.exclamationmark",
                title: .localized(key: "live.staleBanner.title", fallback: "Live data unavailable"),
                message: .localized(
                    key: "live.staleBanner.message",
                    fallback: "The live data connection has been offline for more than 2 minutes. "
                        + "Values on this page may be stale until the connection is restored."
                ),
                dismissable: false
            )
        case .offline:
            AlertBannerNotice(
                variant: .warning,
                symbolName: "wifi.slash",
                title: .localized(key: "pwa.offline.title", fallback: "You're offline"),
                message: .localized(
                    key: "pwa.offline.banner",
                    fallback: "Showing cached data. New requests will retry when you reconnect."
                ),
                dismissable: false
            )
        }
    }
}

// MARK: - Resolved banner content (the `.alert` payload)

/// The fully-derived banner — the data render of the surface, reproducing the web `AlertBanner`
/// composition: the variant, its resolved icon, the optional emphasised title line, the required
/// message line, and whether the trailing dismiss (web `onClose`) is shown. A pure value so the
/// view is a function of it and snapshot tests assert it directly.
public struct AlertBannerContent: Sendable, Equatable {
    public let variant: AlertBannerVariant
    public let symbolName: String
    public let title: AlertBannerText?
    public let message: AlertBannerText
    public let showDismiss: Bool

    public init(
        variant: AlertBannerVariant,
        symbolName: String,
        title: AlertBannerText?,
        message: AlertBannerText,
        showDismiss: Bool
    ) {
        self.variant = variant
        self.symbolName = symbolName
        self.title = title
        self.message = message
        self.showDismiss = showDismiss
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's combined VoiceOver label from already-resolved parts, so the spoken content
/// is asserted without rendering the view. Reads the title (when present) then the message as one
/// sentence; parts already ending in terminal punctuation are joined with a single space so the
/// sentence never doubles a period.
public enum AlertBannerAccessibility {
    public static func label(title: String?, message: String) -> String {
        var parts: [String] = []
        if let title, !title.isEmpty {
            parts.append(title)
        }
        if !message.isEmpty {
            parts.append(message)
        }
        return parts.reduce(into: "") { accumulated, part in
            guard !accumulated.isEmpty else {
                accumulated = part
                return
            }
            let endsWithTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            accumulated += (endsWithTerminal ? " " : ". ") + part
        }
    }
}

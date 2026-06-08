//
//  NotificationChannelsView.Adapter.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The pure, testable projection core for the NotificationChannelsView surface — the
//  SwiftUI parity of web/src/features/notifications/components/NotificationChannelsView.tsx.
//  No SwiftUI and no I/O lives here: the channel-type catalog (web `CHANNEL_TYPES`),
//  the form-config extraction + secret masking (web `channelToFormConfig`), the save
//  payload normalisation (web `buildChannelPayload`), the name validation, the stats
//  projection, and the VoiceOver summaries are all decided here so the XCTest suite can
//  cover every web branch without a rendering host (the same approach the sibling
//  feature views use).
//
//  The web `t(key, default)` keys are preserved verbatim so a shared catalog resolves
//  identically across web and native. The web hardcodes the channel/field labels in
//  `CHANNEL_TYPES`; the native HIG contract requires every visible string to resolve
//  through the P1/S10 facade, so each label is given a stable key with the web English
//  as its fallback. Field example/prompt text is technical sample data (URLs,
//  hostnames) carried verbatim, matching the web.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the view
/// holds no hardcoded literals. Keys live in the "NotificationChannelsView" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum NotifChannelsStrings {
    public static let table = "NotificationChannelsView"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{name}}` / template literal).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Channel field (web `CHANNEL_TYPES[].fields[]`)

/// One provider-specific configuration field — the port of a web channel-type field
/// (`{ key, label, example, input type }`). `secure` maps the web `type: 'password'` to a
/// masked input; `example` is the web field's sample text (rendered verbatim).
public struct NotificationChannelField: Equatable, Sendable, Identifiable {
    public let key: String
    public let labelKey: String
    public let labelFallback: String
    public let example: String
    public let secure: Bool

    public var id: String {
        key
    }

    public init(key: String, labelKey: String, labelFallback: String, example: String, secure: Bool = false) {
        self.key = key
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.example = example
        self.secure = secure
    }
}

// MARK: - Channel kind (web `CHANNEL_TYPES`)

/// The notification channel provider — the port of the web `NotifChannelKind`
/// union + its `CHANNEL_TYPES` metadata (label, icon, brand colour, field set). The
/// brand colour is mapped to a token-driven categorical palette index (ADR-006:
/// semantic, not literal) so no raw hex enters the surface.
public enum NotifChannelKind: String, Equatable, Sendable, CaseIterable, Identifiable {
    case discord
    case slack
    case telegram
    case email
    case webhook
    case ntfy
    case pushover

    public var id: String {
        rawValue
    }

    /// Web `getChannelMeta(kind)` fallback is the `webhook` entry (index 4).
    public static func from(_ raw: String) -> NotifChannelKind {
        NotifChannelKind(rawValue: raw) ?? .webhook
    }

    public var labelKey: String {
        "notifications.channels.kind.\(rawValue)"
    }

    /// English fallback — the web `CHANNEL_TYPES[].label`.
    public var labelFallback: String {
        switch self {
        case .discord: "Discord"
        case .slack: "Slack"
        case .telegram: "Telegram"
        case .email: "Email"
        case .webhook: "Webhook"
        case .ntfy: "ntfy"
        case .pushover: "Pushover"
        }
    }

    /// SF Symbol parity for the web lucide icon.
    public var systemImage: String {
        switch self {
        case .discord: "number"
        case .slack: "message.fill"
        case .telegram: "paperplane.fill"
        case .email: "envelope.fill"
        case .webhook: "link"
        case .ntfy: "megaphone.fill"
        case .pushover: "iphone"
        }
    }

    /// Index into the token categorical palette (`TSChartPalette`) — a distinct,
    /// theme-aware brand tint per provider without a literal hex.
    public var paletteIndex: Int {
        switch self {
        case .discord: 0
        case .slack: 1
        case .telegram: 2
        case .email: 3
        case .webhook: 4
        case .ntfy: 5
        case .pushover: 6
        }
    }

    /// The ordered configuration fields — the port of the web `CHANNEL_TYPES[].fields`.
    public var fields: [NotificationChannelField] {
        NotificationChannelCatalog.fields(for: self)
    }
}

// MARK: - Field catalog (web `CHANNEL_TYPES[].fields` + `FIELD_HELP`)

/// The per-kind field definitions, factored out of the enum for readability. Mirrors
/// the web `CHANNEL_TYPES` field arrays verbatim (key order preserved).
public enum NotificationChannelCatalog {
    public static func fields(for kind: NotifChannelKind) -> [NotificationChannelField] {
        switch kind {
        case .discord, .slack:
            [webhookURLField]
        case .telegram:
            [
                field("bot_token", "Bot Token", "123456:ABC-...", secure: true),
                field("chat_id", "Chat ID", "-1001234567890")
            ]
        case .email:
            [
                field("smtp_host", "SMTP Host", "smtp.gmail.com"),
                field("smtp_port", "SMTP Port", "587"),
                field("smtp_username", "SMTP Username", "alerts@example.com"),
                field("smtp_password", "SMTP Password", "••••••••", secure: true),
                field("from_address", "From Address", "alerts@example.com"),
                field("to_addresses", "Recipients (comma-separated)", "you@example.com,ops@example.com")
            ]
        case .webhook:
            [
                field("url", "URL", "https://example.com/webhook"),
                field("method", "HTTP Method", "POST"),
                field("headers", "Headers (JSON)", "{\"Authorization\": \"Bearer ...\"}"),
                field("body_template", "Body Template", "{\"text\": \"{{message}}\"}")
            ]
        case .ntfy:
            [
                field("server_url", "Server URL", "https://ntfy.sh"),
                field("topic", "Topic", "teslasync")
            ]
        case .pushover:
            [
                field("user_key", "User Key", "u1v2w3...", secure: true),
                field("app_token", "App Token", "a1b2c3...", secure: true)
            ]
        }
    }

    private static let webhookURLField = field("webhook_url", "Webhook URL", "https://discord.com/api/webhooks/...")

    private static func field(
        _ key: String,
        _ fallback: String,
        _ example: String,
        secure: Bool = false
    ) -> NotificationChannelField {
        NotificationChannelField(
            key: key,
            labelKey: "notifications.channels.field.\(key)",
            labelFallback: fallback,
            example: example,
            secure: secure
        )
    }
}

// MARK: - Secret masking (web `k.includes('token'|'key'|'password')`)

/// Decides whether a config value is a secret that must be masked in the card preview
/// — the port of the web `k.includes('token') || k.includes('key') || k.includes('password')`.
public enum ChannelSecret {
    public static let mask = "••••••••"

    public static func isSecret(_ key: String) -> Bool {
        let lower = key.lowercased()
        return lower.contains("token") || lower.contains("key") || lower.contains("password")
    }

    /// The card-preview display value: the mask for secrets, else the raw value.
    public static func display(key: String, value: String) -> String {
        isSecret(key) ? mask : value
    }
}

// MARK: - Config entry + channel data (web `channelToFormConfig`)

/// One ordered key/value pair of a channel's saved configuration — the port of a
/// `channelToFormConfig(ch)` entry. Order is preserved so the card preview shows the
/// same first-three fields the web `.slice(0, 3)` does.
public struct ChannelConfigEntry: Equatable, Sendable, Identifiable {
    public let key: String
    public let value: String

    public var id: String {
        key
    }

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }

    /// The masked display value for the card preview.
    public var displayValue: String {
        ChannelSecret.display(key: key, value: value)
    }
}

/// One configured notification channel — the native projection of the web
/// `NotificationChannel` (the subset this surface renders: identity, kind, name,
/// enabled flag, and the ordered config used for the masked preview + edit form).
public struct NotificationChannelData: Equatable, Sendable, Identifiable {
    public let id: Int64
    public let kind: NotifChannelKind
    public let name: String
    public let enabled: Bool
    public let config: [ChannelConfigEntry]

    public init(
        id: Int64,
        kind: NotifChannelKind,
        name: String,
        enabled: Bool,
        config: [ChannelConfigEntry] = []
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.enabled = enabled
        self.config = config
    }

    /// Web `Object.entries(channelToFormConfig(ch)).slice(0, 3)`.
    public var configPreview: [ChannelConfigEntry] {
        Array(config.prefix(3))
    }

    /// The raw config as a keyed map, for seeding the edit form (web `channelToFormConfig`).
    public var configMap: [String: String] {
        Dictionary(config.map { ($0.key, $0.value) }, uniquingKeysWith: { _, last in last })
    }
}

// MARK: - Stats (web `useNotificationStats`)

/// The notification delivery stats — the native projection of the web
/// `NotificationStats` fields this surface reads (`sent`, `failed`, `pending`,
/// `enabled_channels`, `total_channels`).
public struct NotifChannelStats: Equatable, Sendable {
    public let sent: Int
    public let failed: Int
    public let pending: Int
    public let enabledChannels: Int
    public let totalChannels: Int

    public init(sent: Int, failed: Int, pending: Int, enabledChannels: Int, totalChannels: Int) {
        self.sent = sent
        self.failed = failed
        self.pending = pending
        self.enabledChannels = enabledChannels
        self.totalChannels = totalChannels
    }

    /// Web `${stats.enabled_channels}/${stats.total_channels}`.
    public var activeChannelsText: String {
        "\(enabledChannels)/\(totalChannels)"
    }
}

// MARK: - Test result (web `useTestChannel` → `{ success, error? }`)

/// The result of a channel connection test — the port of the web mutation payload
/// `{ success: boolean; error?: string }`.
public struct ChannelTestResult: Equatable, Sendable {
    public let success: Bool
    public let error: String?

    public init(success: Bool, error: String? = nil) {
        self.success = success
        self.error = error
    }
}

// MARK: - Save payload (web `NotificationChannelInput` / `buildChannelPayload`)

/// The normalised save payload for a channel — the native port of the web
/// `buildChannelPayload` output. `id` is present only for an edit (web `isEdit`).
public struct NotificationChannelInput: Equatable, Sendable {
    public let id: Int64?
    public let kind: NotifChannelKind
    public let name: String
    public let enabled: Bool
    public let config: [ChannelConfigEntry]

    public init(
        id: Int64?,
        kind: NotifChannelKind,
        name: String,
        enabled: Bool,
        config: [ChannelConfigEntry]
    ) {
        self.id = id
        self.kind = kind
        self.name = name
        self.enabled = enabled
        self.config = config
    }
}

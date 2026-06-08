//
//  NotificationChannelsView.Builder.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The pure save-payload builder (web `buildChannelPayload`), the name validation
//  (web `if (!name.trim())`), and the VoiceOver summary builders for the
//  NotificationChannelsView surface. Factored out of the adapter so each file stays
//  within the lint length budget. No SwiftUI and no I/O — every branch is unit tested.
//

import Foundation

// MARK: - Payload builder (web `buildChannelPayload`)

/// Normalises raw form values into a save payload — the port of the web
/// `buildChannelPayload`: the SMTP port coercion (invalid ⇒ 587), the recipients
/// comma-split, the webhook method allowlist (⇒ POST), the headers JSON guard (⇒ `{}`),
/// and the ntfy/pushover defaults.
public enum ChannelPayloadBuilder {
    public static func build(
        kind: NotifChannelKind,
        name: String,
        enabled: Bool,
        rawConfig: [String: String],
        id: Int64?
    ) -> NotificationChannelInput {
        NotificationChannelInput(
            id: id,
            kind: kind,
            name: name,
            enabled: enabled,
            config: entries(kind: kind, rawConfig: rawConfig)
        )
    }

    private static func entries(
        kind: NotifChannelKind,
        rawConfig: [String: String]
    ) -> [ChannelConfigEntry] {
        kind.fields.map { field in
            ChannelConfigEntry(key: field.key, value: normalize(field.key, rawConfig[field.key] ?? "", kind: kind))
        }
    }

    private static func normalize(_ key: String, _ value: String, kind: NotifChannelKind) -> String {
        switch (kind, key) {
        case (.email, "smtp_port"): String(smtpPort(value))
        case (.email, "to_addresses"): recipients(value).joined(separator: ",")
        case (.webhook, "method"): safeMethod(value)
        case (.webhook, "headers"): safeHeaders(value)
        case (.ntfy, "server_url"): value.isEmpty ? "https://ntfy.sh" : value
        default: value
        }
    }

    /// Web `Number.isFinite(port) ? port : 587`.
    public static func smtpPort(_ raw: String) -> Int {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if let port = Int(trimmed) { return port }
        return 587
    }

    /// Web `(config.to_addresses ?? '').split(',').map(trim).filter(Boolean)`.
    public static func recipients(_ raw: String) -> [String] {
        raw.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    /// Web `safeMethod`: GET/PUT pass through (uppercased), everything else ⇒ POST.
    public static func safeMethod(_ raw: String) -> String {
        let upper = raw.trimmingCharacters(in: .whitespaces).uppercased()
        return (upper == "GET" || upper == "PUT") ? upper : "POST"
    }

    /// Web headers guard: valid JSON object passes through, otherwise `{}`.
    public static func safeHeaders(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return "{}" }
        let parsed = try? JSONSerialization.jsonObject(with: data)
        return parsed is [String: Any] ? trimmed : "{}"
    }
}

// MARK: - Validation (web `if (!name.trim())`)

/// The form validation — the port of the web `if (!name.trim()) setFormError(…)`.
public enum ChannelFormValidation {
    /// Returns the error key/fallback when the name is blank, else `nil` (valid).
    public static func nameError(_ name: String) -> (key: String, fallback: String)? {
        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? ("notifications.channels.nameRequired", "Name is required")
            : nil
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Pure VoiceOver string builders so the surface announces coherent elements and the
/// tests can assert label presence without a rendering host.
public enum NotificationChannelsAccessibility {
    /// A combined channel-card summary: name, provider, status.
    public static func channelLabel(name: String, kind: String, status: String) -> String {
        [name, kind, status].joined(separator: ", ")
    }

    /// A stat tile summary: "label, value".
    public static func statLabel(label: String, value: String) -> String {
        "\(label), \(value)"
    }
}

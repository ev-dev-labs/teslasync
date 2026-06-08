//
//  ClientUtilitiesSection.Adapter.swift
//  TeslaSync — P4 feature view · 0003 · ClientUtilitiesSection (Apple)
//
//  The testable projection core for the developer-utilities catalog surface: the
//  canonical tool registry (parity port of the web `useToolList`), the per-tool
//  tint catalog (parity with the web `ICON_COLOR_MAP`), the search filter (web
//  `filtered`), the single-open accordion toggle (web `expandedId` logic), and the
//  VoiceOver summary builders. Everything here is pure + dependency-free so the
//  adapter can be unit-tested without a store, a bundle, or a rendered view.
//

import SwiftUI

// MARK: - Tool tint (port of the web `ICON_COLOR_MAP`)

/// The five accent tints a tool card can carry, mirroring the web
/// `ICON_COLOR_MAP` keys (`cyan` / `green` / `purple` / `amber` / `red`). The
/// `color` hexes reproduce the web neon palette so the icon boxes read identically
/// on both apps; `name` keeps a stable token the registry + tests assert against.
public enum ToolTint: String, Sendable, CaseIterable {
    case cyan
    case green
    case purple
    case amber
    case red

    /// Web neon-hex parity for the icon-box tint (matches the dark-theme tokens).
    public var color: Color {
        switch self {
        case .cyan: Color(red: 0.000, green: 0.941, blue: 1.000) // #00f0ff
        case .green: Color(red: 0.063, green: 0.725, blue: 0.506) // #10b981
        case .purple: Color(red: 0.545, green: 0.361, blue: 0.965) // #8b5cf6
        case .amber: Color(red: 0.961, green: 0.620, blue: 0.043) // #f59e0b
        case .red: Color(red: 0.937, green: 0.267, blue: 0.267) // #ef4444
        }
    }
}

// MARK: - Tool descriptor (port of the web `ToolEntry`)

/// One developer-utility entry — the native port of the web `ToolEntry`. It
/// carries the i18n keys (resolved at the display boundary, never inlined) plus
/// the SF Symbol + tint so the view can render the card without re-deriving
/// anything. `Component` has no analogue here: the individual tools are their own
/// surfaces (separate prompts), hosted by the section through an injected content
/// provider (see `ClientUtilitiesSection`).
public struct ToolDescriptor: Identifiable, Equatable, Sendable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String
    public let systemImage: String
    public let tint: ToolTint

    public init(
        id: String,
        nameKey: String,
        nameFallback: String,
        descriptionKey: String,
        descriptionFallback: String,
        systemImage: String,
        tint: ToolTint
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.systemImage = systemImage
        self.tint = tint
    }

    /// The localized display name (web `tool.name`), resolved through the facade.
    public func localizedName(_ localize: (String, String) -> String) -> String {
        localize(nameKey, nameFallback)
    }

    /// The localized description (web `tool.desc`), resolved through the facade.
    public func localizedDescription(_ localize: (String, String) -> String) -> String {
        localize(descriptionKey, descriptionFallback)
    }
}

// MARK: - Canonical catalog (port of the web `useToolList`)

/// The canonical developer-utilities registry — the native port of the web
/// `useToolList` memo. Ids, i18n keys, and ordering are kept in lock-step with the
/// web source so the catalog, the strings table, and the tests stay aligned. The
/// SF Symbols are the HIG-native equivalents of the web lucide glyphs; the tints
/// reproduce the web per-tool `color`.
public enum ClientUtilitiesCatalog {
    /// The 15 tools, in the exact web order.
    public static let defaultTools: [ToolDescriptor] = [
        ToolDescriptor(
            id: "vin", nameKey: "Vin Decoder", nameFallback: "Vin Decoder",
            descriptionKey: "Vin Decoder Desc", descriptionFallback: "Vin Decoder Desc",
            systemImage: "car.fill", tint: .cyan
        ),
        ToolDescriptor(
            id: "jwt", nameKey: "Jwt Decoder", nameFallback: "Jwt Decoder",
            descriptionKey: "Jwt Decoder Desc", descriptionFallback: "Jwt Decoder Desc",
            systemImage: "key.fill", tint: .purple
        ),
        ToolDescriptor(
            id: "timestamp", nameKey: "Timestamp", nameFallback: "Timestamp",
            descriptionKey: "Timestamp Desc", descriptionFallback: "Timestamp Desc",
            systemImage: "clock.fill", tint: .green
        ),
        ToolDescriptor(
            id: "base64", nameKey: "devtools.utils.base64", nameFallback: "Base64",
            descriptionKey: "devtools.utils.base64Desc", descriptionFallback: "Base64Desc",
            systemImage: "curlybraces", tint: .amber
        ),
        ToolDescriptor(
            id: "url", nameKey: "Url Encoder", nameFallback: "Url Encoder",
            descriptionKey: "Url Encoder Desc", descriptionFallback: "Url Encoder Desc",
            systemImage: "link", tint: .cyan
        ),
        ToolDescriptor(
            id: "json", nameKey: "Json Formatter", nameFallback: "Json Formatter",
            descriptionKey: "Json Formatter Desc", descriptionFallback: "Json Formatter Desc",
            systemImage: "curlybraces", tint: .green
        ),
        ToolDescriptor(
            id: "uuid", nameKey: "Uuid Generator", nameFallback: "Uuid Generator",
            descriptionKey: "Uuid Generator Desc", descriptionFallback: "Uuid Generator Desc",
            systemImage: "barcode", tint: .purple
        ),
        ToolDescriptor(
            id: "hash", nameKey: "Hash Calculator", nameFallback: "Hash Calculator",
            descriptionKey: "Hash Calculator Desc", descriptionFallback: "Hash Calculator Desc",
            systemImage: "number", tint: .red
        ),
        ToolDescriptor(
            id: "bytes", nameKey: "Byte Size", nameFallback: "Byte Size",
            descriptionKey: "Byte Size Desc", descriptionFallback: "Byte Size Desc",
            systemImage: "internaldrive.fill", tint: .cyan
        ),
        ToolDescriptor(
            id: "color", nameKey: "Color Converter", nameFallback: "Color Converter",
            descriptionKey: "Color Converter Desc", descriptionFallback: "Color Converter Desc",
            systemImage: "paintpalette.fill", tint: .purple
        ),
        ToolDescriptor(
            id: "cron", nameKey: "Cron Parser", nameFallback: "Cron Parser",
            descriptionKey: "Cron Parser Desc", descriptionFallback: "Cron Parser Desc",
            systemImage: "timer", tint: .green
        ),
        ToolDescriptor(
            id: "http", nameKey: "Http Status", nameFallback: "Http Status",
            descriptionKey: "Http Status Desc", descriptionFallback: "Http Status Desc",
            systemImage: "network", tint: .amber
        ),
        ToolDescriptor(
            id: "tesla-api", nameKey: "Tesla Api Ref", nameFallback: "Tesla Api Ref",
            descriptionKey: "Tesla Api Ref Desc", descriptionFallback: "Tesla Api Ref Desc",
            systemImage: "book.fill", tint: .cyan
        ),
        ToolDescriptor(
            id: "regex", nameKey: "Regex Tester", nameFallback: "Regex Tester",
            descriptionKey: "Regex Tester Desc", descriptionFallback: "Regex Tester Desc",
            systemImage: "asterisk", tint: .red
        ),
        ToolDescriptor(
            id: "unix-perm", nameKey: "Unix Perm", nameFallback: "Unix Perm",
            descriptionKey: "Unix Perm Desc", descriptionFallback: "Unix Perm Desc",
            systemImage: "lock.fill", tint: .green
        )
    ]
}

// MARK: - Search filter (port of the web `filtered` memo)

/// The catalog search filter — the native port of the web `filtered` computation.
/// An empty/whitespace query returns every tool; otherwise it keeps tools whose
/// localized name OR description contains the query (case-insensitive), matching
/// the web `tool.name.toLowerCase().includes(q) || tool.desc...`.
public enum ToolFilter {
    public static func filter(
        _ tools: [ToolDescriptor],
        query: String,
        localize: (String, String) -> String
    ) -> [ToolDescriptor] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return tools }
        let needle = trimmed.lowercased()
        return tools.filter { tool in
            tool.localizedName(localize).lowercased().contains(needle)
                || tool.localizedDescription(localize).lowercased().contains(needle)
        }
    }
}

// MARK: - Single-open accordion (port of the web `setExpandedId` toggle)

/// The single-open accordion toggle — the native port of the web
/// `setExpandedId((prev) => prev === tool.id ? null : tool.id)`: tapping the open
/// card closes it, tapping a closed card opens it (and implicitly closes the prior
/// one). Pure so the interaction can be unit-tested without a view.
public enum ToolDisclosure {
    public static func toggled(current: String?, selecting id: String) -> String? {
        current == id ? nil : id
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the surface. Pure + public so the spoken
/// content can be unit-tested without rendering the view.
public enum ClientUtilitiesAccessibility {
    /// The spoken label for a tool card: its name, then its expanded/collapsed
    /// state, then the description — so VoiceOver announces the disclosure intent.
    public static func cardSummary(
        for tool: ToolDescriptor,
        expanded: Bool,
        localize: (String, String) -> String
    ) -> String {
        let state = expanded
            ? localize("devtools.clientUtilities.expanded", "Expanded")
            : localize("devtools.clientUtilities.collapsed", "Collapsed")
        return "\(tool.localizedName(localize)). \(state). \(tool.localizedDescription(localize))"
    }
}

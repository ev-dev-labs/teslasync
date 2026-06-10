//
//  globalShortcuts.Adapter.swift
//  TeslaSync — P4 misc surface · 0002 · globalShortcuts (Apple)
//
//  The testable projection core for the global keyboard-shortcut registry — the
//  SwiftUI parity of `lib/globalShortcuts.tsx`. Everything here is pure +
//  dependency-light (Foundation only, for the `Go to %@` interpolation): the key-token
//  model, the shortcut definition, the canonical catalog (the verbatim port of the web
//  `defs` useMemo), the group projection, and the VoiceOver summary. No store, no
//  bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `GlobalShortcuts` component pours three families of entries into
//  a single registry (`useShortcut(defs)`) so the cheat-sheet has one source of truth:
//    1. four universal app keys — `Ctrl+K`, `/`, `?`, `Esc` (group "Actions");
//    2. every `GOTO_SHORTCUTS` entry — the `g then <letter>` navigation table
//       (group "Navigation (press g then…)");
//    3. every `commandRegistry` entry that declares a `shortcut` hint — `T`, `?`, `E`
//       (group "Commands").
//  This core reproduces that exact set, order, ids, key tokens, and group titles. The
//  component renders nothing on the web (`return null`); the native parity surface
//  presents the same registry as the keyboard-shortcuts reference, so the grouping the
//  web cheat-sheet performs at read time lives here as a pure projection.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the catalog binds against — the native shape of the web
/// `useTranslation` `t(key, fallback)` call. Kept as a plain closure so the pure core
/// has no dependency on a bundle: the production app passes the P1/S10 facade, while
/// tests pass the identity-fallback resolver.
public typealias GlobalShortcutsResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Scope (web `ShortcutScope`)

/// Where a shortcut is visible in the cheat-sheet — the native mirror of the web
/// `ShortcutScope`. Every entry `globalShortcuts.tsx` registers is `global`; the other
/// cases are carried for parity with the source shape and future route-scoped entries.
public enum GlobalShortcutScope: String, Sendable, Equatable, CaseIterable {
    case global
    case route
    case page
}

// MARK: - Group kind (the three web groups, in render order)

/// The cheat-sheet group an entry renders under — the native mirror of the three web
/// group titles. `order` preserves the web composition sequence (universals, then the
/// `g`-navigation table, then the palette commands) so the projection is deterministic.
public enum GlobalShortcutGroupKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case actions
    case navigation
    case commands

    public var id: String {
        rawValue
    }

    /// The render position of the group (web array order).
    public var order: Int {
        switch self {
        case .actions: 0
        case .navigation: 1
        case .commands: 2
        }
    }

    /// The i18n key + English fallback for the group header (web
    /// `t('shortcuts.groups.*', …)`).
    public var titleKey: (key: String, fallback: String) {
        switch self {
        case .actions:
            ("shortcuts.groups.actions", "Actions")
        case .navigation:
            ("shortcuts.groups.navigation", "Navigation (press g then…)")
        case .commands:
            ("shortcuts.groups.commands", "Commands")
        }
    }
}

// MARK: - Key token (web `<kbd>` chip)

/// One key chip — the native mirror of a single web `keys[]` token rendered as its own
/// `<kbd>`. `display` is the verbatim chip glyph (kept exactly as the web source emits
/// it — `Ctrl`, `K`, `/`, `?`, `Esc`, `g`, `d`, `T`, `E`); `spoken` is the VoiceOver
/// pronunciation so the chips are announced as words rather than punctuation.
public struct ShortcutKeyToken: Sendable, Equatable {
    public let display: String
    public let spoken: String

    public init(display: String, spoken: String) {
        self.display = display
        self.spoken = spoken
    }

    /// Maps a raw web key token to its chip glyph + VoiceOver pronunciation. The glyph
    /// is preserved verbatim for parity; only the spoken form is humanised.
    public static func from(_ raw: String) -> ShortcutKeyToken {
        ShortcutKeyToken(display: raw, spoken: spokenName(for: raw))
    }

    /// The VoiceOver pronunciation for named modifiers and punctuation — looked up so
    /// the spoken form stays a single low-complexity table rather than a long switch.
    static let spokenNames: [String: String] = [
        "Ctrl": "Control", "⌃": "Control",
        "Cmd": "Command", "⌘": "Command",
        "Shift": "Shift", "⇧": "Shift",
        "Alt": "Option", "Option": "Option", "⌥": "Option",
        "Esc": "Escape", "Escape": "Escape",
        "Enter": "Return", "Return": "Return", "↵": "Return",
        "Space": "Space",
        "Tab": "Tab",
        "/": "Slash",
        "?": "Question mark",
        "←": "Left arrow",
        "→": "Right arrow",
        "↑": "Up arrow",
        "↓": "Down arrow"
    ]

    /// The VoiceOver pronunciation for a raw token. Named modifiers and punctuation are
    /// spelled out via `spokenNames`; a bare single letter is spoken upper-cased
    /// ("g" → "G"); anything else is read verbatim.
    static func spokenName(for raw: String) -> String {
        if let mapped = spokenNames[raw] {
            return mapped
        }
        if raw.count == 1, let scalar = raw.unicodeScalars.first, CharacterSet.letters.contains(scalar) {
            return raw.uppercased()
        }
        return raw
    }
}

// MARK: - Shortcut definition (web `ShortcutDefinition`, the cheat-sheet subset)

/// One registered shortcut — the native mirror of the web `ShortcutDefinition` fields
/// the cheat-sheet consumes (`id`, `keys`, `description`, `group`, `scope`). The
/// listener-only fields (`match`/`handler`/`priority`) are intentionally omitted: this
/// surface is the informational cheat-sheet, exactly as `globalShortcuts.tsx` registers
/// its entries informationally.
public struct GlobalShortcutDefinition: Sendable, Equatable, Identifiable {
    public let id: String
    public let keys: [String]
    public let description: String
    public let group: GlobalShortcutGroupKind
    public let scope: GlobalShortcutScope

    public init(
        id: String,
        keys: [String],
        description: String,
        group: GlobalShortcutGroupKind,
        scope: GlobalShortcutScope = .global
    ) {
        self.id = id
        self.keys = keys
        self.description = description
        self.group = group
        self.scope = scope
    }

    /// The key chips for this entry (web `keys.map(k => <kbd>{k}</kbd>)`).
    public var tokens: [ShortcutKeyToken] {
        keys.map(ShortcutKeyToken.from)
    }
}

// MARK: - Resolved group (web cheat-sheet section)

/// A rendered cheat-sheet section — a group title plus its ordered rows. The native
/// mirror of the web cheat-sheet's per-group block (the grouping the web modal performs
/// at read time over the registry snapshot).
public struct GlobalShortcutGroup: Sendable, Equatable, Identifiable {
    public let kind: GlobalShortcutGroupKind
    public let title: String
    public let rows: [GlobalShortcutDefinition]

    public init(kind: GlobalShortcutGroupKind, title: String, rows: [GlobalShortcutDefinition]) {
        self.kind = kind
        self.title = title
        self.rows = rows
    }

    public var id: String {
        kind.id
    }
}

// MARK: - Canonical catalog (the verbatim port of the web `defs` useMemo)

/// The static navigation + command tables the web source reads from `GOTO_SHORTCUTS`
/// and `commandRegistry`, plus the four universals. Pure data so the catalog can be
/// asserted against the web source entry-for-entry.
public enum GlobalShortcutsCatalog {
    /// One `g then <letter>` navigation target — the native mirror of a `GOTO_SHORTCUTS`
    /// entry. `labelKey`/`labelFallback` localise the destination name interpolated into
    /// the `Go to %@` description (web `target.label`).
    public struct NavTarget: Sendable, Equatable {
        public let key: String
        public let labelKey: String
        public let labelFallback: String
    }

    /// One palette command that advertises a `shortcut` hint — the native mirror of a
    /// `commandRegistry` entry the web `.filter(c => c.shortcut)` keeps.
    public struct PaletteCommand: Sendable, Equatable {
        public let commandID: String
        public let shortcut: String
        public let labelKey: String
        public let labelFallback: String
    }

    /// One universal app key — the four entries the web source hard-codes.
    struct Universal {
        let id: String
        let keys: [String]
        let descriptionKey: String
        let descriptionFallback: String
    }

    /// The four universal app keys (web `universals`), in source order.
    static let universals: [Universal] = [
        Universal(
            id: "global.palette.ctrlk", keys: ["Ctrl", "K"],
            descriptionKey: "shortcuts.openPalette", descriptionFallback: "Open command palette"
        ),
        Universal(
            id: "global.palette.slash", keys: ["/"],
            descriptionKey: "shortcuts.openPaletteAlt", descriptionFallback: "Open command palette"
        ),
        Universal(
            id: "global.shortcuts.help", keys: ["?"],
            descriptionKey: "shortcuts.openShortcuts", descriptionFallback: "Show keyboard shortcuts"
        ),
        Universal(
            id: "global.shortcuts.escape", keys: ["Esc"],
            descriptionKey: "shortcuts.close", descriptionFallback: "Close modal / cancel"
        )
    ]

    /// The `GOTO_SHORTCUTS` navigation table, in source order (`d, v, c, r, t, b, a, e,
    /// s, n, l, o, x, i`). The labels mirror the web `target.label` values.
    public static let navTargets: [NavTarget] = [
        NavTarget(key: "d", labelKey: "shortcuts.nav.dashboard", labelFallback: "Dashboard"),
        NavTarget(key: "v", labelKey: "shortcuts.nav.vehicles", labelFallback: "Vehicles"),
        NavTarget(key: "c", labelKey: "shortcuts.nav.charging", labelFallback: "Charging"),
        NavTarget(key: "r", labelKey: "shortcuts.nav.drives", labelFallback: "Drives"),
        NavTarget(key: "t", labelKey: "shortcuts.nav.trips", labelFallback: "Trips"),
        NavTarget(key: "b", labelKey: "shortcuts.nav.battery", labelFallback: "Battery & Energy"),
        NavTarget(key: "a", labelKey: "shortcuts.nav.analytics", labelFallback: "Analytics"),
        NavTarget(key: "e", labelKey: "shortcuts.nav.efficiency", labelFallback: "Efficiency"),
        NavTarget(key: "s", labelKey: "shortcuts.nav.settings", labelFallback: "Settings"),
        NavTarget(key: "n", labelKey: "shortcuts.nav.notifications", labelFallback: "Notifications"),
        NavTarget(key: "l", labelKey: "shortcuts.nav.liveSignals", labelFallback: "Live Signals"),
        NavTarget(key: "o", labelKey: "shortcuts.nav.automations", labelFallback: "Automations"),
        NavTarget(key: "x", labelKey: "shortcuts.nav.commands", labelFallback: "Commands"),
        NavTarget(key: "i", labelKey: "shortcuts.nav.climate", labelFallback: "Climate")
    ]

    /// The `commandRegistry` entries that declare a `shortcut`, in source order. The
    /// label keys/fallbacks are carried verbatim from the registry definitions.
    public static let paletteCommands: [PaletteCommand] = [
        PaletteCommand(
            commandID: "pref.themePicker", shortcut: "T",
            labelKey: "palette.cmd.themePicker", labelFallback: "Open theme picker"
        ),
        PaletteCommand(
            commandID: "action.shortcuts", shortcut: "?",
            labelKey: "palette.cmd.shortcuts", labelFallback: "Show keyboard shortcuts"
        ),
        PaletteCommand(
            commandID: "action.dashboard.edit", shortcut: "E",
            labelKey: "palette.cmd.dashboardEdit", labelFallback: "Edit dashboard layout"
        )
    ]

    /// The full registry the web `defs` useMemo produces: universals, then navigation,
    /// then palette commands — in that exact order, with the web ids and key tokens.
    /// `resolve` localises every description (web `t(key, fallback)`).
    public static func canonicalDefinitions(resolve: GlobalShortcutsResolve) -> [GlobalShortcutDefinition] {
        universalDefinitions(resolve: resolve)
            + navigationDefinitions(resolve: resolve)
            + commandDefinitions(resolve: resolve)
    }

    /// The four universal entries (web `universals`).
    public static func universalDefinitions(resolve: GlobalShortcutsResolve) -> [GlobalShortcutDefinition] {
        universals.map { universal in
            GlobalShortcutDefinition(
                id: universal.id,
                keys: universal.keys,
                description: resolve(universal.descriptionKey, universal.descriptionFallback),
                group: .actions
            )
        }
    }

    /// The 14 `g then <letter>` entries (web `navigation`). Each description is the
    /// localised `Go to %@` template with the destination name substituted.
    public static func navigationDefinitions(resolve: GlobalShortcutsResolve) -> [GlobalShortcutDefinition] {
        let template = resolve("shortcuts.goto", "Go to %@")
        return navTargets.map { target in
            let label = resolve(target.labelKey, target.labelFallback)
            return GlobalShortcutDefinition(
                id: "global.goto.\(target.key)",
                keys: ["g", target.key],
                description: GlobalShortcutsFormat.interpolate(template: template, label: label),
                group: .navigation
            )
        }
    }

    /// The palette command entries (web `palette`).
    public static func commandDefinitions(resolve: GlobalShortcutsResolve) -> [GlobalShortcutDefinition] {
        paletteCommands.map { command in
            GlobalShortcutDefinition(
                id: "global.palette.cmd.\(command.commandID)",
                keys: [command.shortcut],
                description: resolve(command.labelKey, command.labelFallback),
                group: .commands
            )
        }
    }
}

// MARK: - Description interpolation (web `t('shortcuts.goto', 'Go to {{label}}', { label })`)

/// Reproduces the web `{{label}}` interpolation for the `Go to …` description. The
/// native template uses `%@`; this also tolerates a literal `{{label}}` token (so the
/// raw web string can be reused unchanged) and falls back to appending the label when
/// neither token is present, so the destination name is never dropped.
public enum GlobalShortcutsFormat {
    public static func interpolate(template: String, label: String) -> String {
        if template.contains("{{label}}") {
            return template.replacingOccurrences(of: "{{label}}", with: label)
        }
        if template.contains("%@") {
            return String(format: template, label)
        }
        return "\(template) \(label)"
    }
}

// MARK: - Grouping (web cheat-sheet read-time grouping)

/// Folds a flat definition list into ordered cheat-sheet sections. Empty groups are
/// dropped (the web modal renders only non-empty groups), and the sections come out in
/// the canonical group order regardless of the input ordering, so the surface is stable.
public enum GlobalShortcutsGrouping {
    public static func groups(
        from definitions: [GlobalShortcutDefinition],
        resolve: GlobalShortcutsResolve
    ) -> [GlobalShortcutGroup] {
        GlobalShortcutGroupKind.allCases
            .sorted { $0.order < $1.order }
            .compactMap { kind in
                let rows = definitions.filter { $0.group == kind }
                guard !rows.isEmpty else { return nil }
                let title = resolve(kind.titleKey.key, kind.titleKey.fallback)
                return GlobalShortcutGroup(kind: kind, title: title, rows: rows)
            }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver string for a shortcut row from already-localised parts, so the
/// spoken content is asserted without rendering the view. Mirrors the web row: the
/// description is read, then the key combination is spelled out word-by-word.
public enum GlobalShortcutsAccessibility {
    /// The spoken key combination — each token's pronunciation joined by spaces
    /// ("Control K", "g D").
    public static func spokenKeys(_ tokens: [ShortcutKeyToken]) -> String {
        tokens.map(\.spoken).joined(separator: " ")
    }

    /// The composed row label: "{description}, {shortcutWord} {spoken keys}". When the
    /// row has no keys the shortcut clause is dropped.
    public static func rowLabel(description: String, shortcutWord: String, tokens: [ShortcutKeyToken]) -> String {
        let spoken = spokenKeys(tokens)
        guard !spoken.isEmpty else { return description }
        return "\(description), \(shortcutWord) \(spoken)"
    }
}

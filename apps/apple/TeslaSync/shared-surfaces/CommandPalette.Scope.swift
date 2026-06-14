//
//  CommandPalette.Scope.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The command-palette prefix-parsing core — the SwiftUI-free port of `web/src/lib/palettePrefix.ts`. Typing a
//  single recognized character at the start of the search box locks the palette to one scope (the muscle
//  memory of VS Code / Raycast / Linear):
//    `>` → commands   `/` → pages   `@` → vehicles   `:` → settings
//  The prefix must be the very first character; one optional space after it is consumed. This file owns the
//  canonical scope table (prefix ↔ scope ↔ display metadata), the `parsePrefix` parser, the scope-membership
//  test the filter uses, and the footer hint list — the single source of truth, exactly like the web module.
//  Pure (Foundation only) so every rule is unit-testable in isolation.
//

import Foundation

// MARK: - PaletteScope (web `PaletteScope`)

/// The palette scopes a prefix can lock the list to — the native peer of the web `PaletteScope`. The raw
/// values match the corresponding ``PaletteItemKind`` raw values so the membership test stays a simple
/// kind comparison.
public enum PaletteScope: String, Sendable, Equatable, CaseIterable {
    case command
    case navigate
    case vehicleSwitch = "vehicle-switch"
    case registry
}

// MARK: - PaletteScopeMeta (web `PaletteScopeMeta`)

/// Per-scope display metadata — the native peer of the web `PaletteScopeMeta`. The parser owns the prefix →
/// scope mapping, so this table is the single source of truth for the chip + empty state + hint copy.
public struct PaletteScopeMeta: Sendable, Equatable {
    /// The single-character trigger (web `prefix`).
    public let prefix: String
    /// The human-readable scope name + i18n fallback (web `label`).
    public let label: String
    /// The placeholder shown while this scope is active (web `placeholder`). // parity:allow ui
    public let placeholder: String // parity:allow ui
    /// The item kinds that belong to this scope (web `types`).
    public let kinds: [PaletteItemKind]

    public init(prefix: String, label: String, placeholder: String, kinds: [PaletteItemKind]) { // parity:allow ui
        self.prefix = prefix
        self.label = label
        self.placeholder = placeholder // parity:allow ui
        self.kinds = kinds
    }
}

// MARK: - PaletteParsedPrefix (web `ParsedPrefix`)

/// The parsed result of a raw input — the native peer of the web `ParsedPrefix`: the active scope (or `nil`
/// when the user hasn't typed a recognized prefix) and the remaining search term.
public struct PaletteParsedPrefix: Sendable, Equatable {
    public let scope: PaletteScope?
    public let term: String

    public init(scope: PaletteScope?, term: String) {
        self.scope = scope
        self.term = term
    }
}

// MARK: - PaletteScopeHint (web `PaletteScopeHint`)

/// One footer hint chip — the native peer of the web `PaletteScopeHint`, kept data-driven off the scope table.
public struct PaletteScopeHint: Sendable, Equatable, Identifiable {
    public let scope: PaletteScope
    public let prefix: String
    public let label: String

    public var id: String {
        scope.rawValue
    }

    public init(scope: PaletteScope, prefix: String, label: String) {
        self.scope = scope
        self.prefix = prefix
        self.label = label
    }
}

// MARK: - PaletteScopes (the web module's exported surface)

/// The canonical prefix → scope table + parser + membership test + hint list — the native peer of the web
/// `palettePrefix.ts` exports. The table order is the order the footer hint strip renders.
public enum PaletteScopes {
    /// The canonical scope table (web `PALETTE_SCOPE_TABLE`), in display order.
    public static let table: [(scope: PaletteScope, meta: PaletteScopeMeta)] = [
        (.command, PaletteScopeMeta(
            prefix: ">",
            label: "Commands",
            placeholder: "Search commands…", // parity:allow ui
            kinds: [.command]
        )),
        (.navigate, PaletteScopeMeta(
            prefix: "/",
            label: "Pages",
            placeholder: "Search pages…", // parity:allow ui
            kinds: [.navigate]
        )),
        (.vehicleSwitch, PaletteScopeMeta(
            prefix: "@",
            label: "Vehicles",
            placeholder: "Switch vehicle…", // parity:allow ui
            kinds: [.vehicleSwitch]
        )),
        (.registry, PaletteScopeMeta(
            prefix: ":",
            label: "Settings",
            placeholder: "Search settings…", // parity:allow ui
            kinds: [.registry]
        ))
    ]

    /// Look up the scope metadata (web `getScopeMeta`).
    public static func meta(for scope: PaletteScope) -> PaletteScopeMeta {
        table.first { $0.scope == scope }?.meta
            ?? PaletteScopeMeta(prefix: "", label: scope.rawValue, placeholder: "", kinds: []) // parity:allow ui
    }

    /// Parse a raw palette input into `{ scope, term }` — the verbatim port of the web `parsePrefix`. The
    /// prefix MUST be the very first character (mid-string `>` / `/` are search text); one optional space
    /// immediately after the prefix is consumed; an unknown leading character yields the whole input as the
    /// term; an empty input yields no scope and an empty term.
    public static func parsePrefix(_ input: String) -> PaletteParsedPrefix {
        guard let head = input.first else { return PaletteParsedPrefix(scope: nil, term: "") }
        guard let scope = table.first(where: { $0.meta.prefix == String(head) })?.scope else {
            return PaletteParsedPrefix(scope: nil, term: input)
        }
        var rest = String(input.dropFirst())
        if rest.first == " " { rest = String(rest.dropFirst()) }
        return PaletteParsedPrefix(scope: scope, term: rest)
    }

    /// Whether an item kind belongs to the active scope — the verbatim port of the web `itemMatchesScope`. A
    /// `nil` scope passes everything.
    public static func itemMatchesScope(_ kind: PaletteItemKind, scope: PaletteScope?) -> Bool {
        guard let scope else { return true }
        return meta(for: scope).kinds.contains(kind)
    }

    /// The footer hint chips (web `PALETTE_SCOPE_HINTS`), in table order.
    public static let hints: [PaletteScopeHint] = table.map { entry in
        PaletteScopeHint(scope: entry.scope, prefix: entry.meta.prefix, label: entry.meta.label)
    }
}

//
//  AlertStudioPage.Templates.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The curated `ruleTemplates` table (web `const ruleTemplates: RuleTemplate[]`), the
//  derived `templateCategories` + `signalCatalog` (web `buildSignalCatalog`), and the
//  severity → token mapping the template cards + rule rows tint with (web
//  `severityTokens` / `@/lib/tokens`). Pure data + derivations — no SwiftUI, no I/O.
//
//  The web `icon: ElementType` lucide glyphs map to SF Symbols here; the template
//  names + messages are the verbatim English the `.strings` catalog keys (built from
//  `templateKey(name)`) fall back to, so a shared catalog resolves identically.
//

import Foundation

// MARK: - Curated templates (web `ruleTemplates`)

public enum AlertStudioTemplates {
    /// The 47 curated rule templates, in the web table's exact order. The category
    /// glyphs are the SF-Symbol ports of the web lucide icons.
    public static let all: [RuleTemplate] = battery + charging + driving + security
        + climate + tirePressure + location + safety + motor + software + media + powershare

    /// Web `templateCategories = [...new Set(ruleTemplates.map(t => t.category))].sort()`.
    public static let categories: [String] = Array(Set(all.map(\.category))).sorted()

    /// Web `signalCatalog = buildSignalCatalog(ruleTemplates)`.
    public static let signalCatalog: [SignalDefinition] = AlertStudioAdapter.buildSignalCatalog(all)

    /// Web `signalCatalogByName` — the catalog keyed by signal name for O(1) lookup.
    public static let signalCatalogByName: [String: SignalDefinition] = Dictionary(
        signalCatalog.map { ($0.name, $0) },
        uniquingKeysWith: { first, _ in first }
    )
}

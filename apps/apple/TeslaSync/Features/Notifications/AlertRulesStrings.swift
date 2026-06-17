//
//  AlertRulesStrings.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/AlertRules (Apple) — i18n seam
//
//  Resolves the page's visible strings from the app `Localizable.xcstrings`
//  catalog so no user-facing prose is hardcoded (ADR-014). The web i18n keys are
//  kept verbatim at the call sites (`alertRules.title`, `alertRules.col.name`, …)
//  and folded onto the catalog's `translation.`-namespaced entries here — the same
//  convention the sibling Driving Dynamics page uses. The English `fallback`
//  mirrors the `web/.../AlertRulesPage` `t(key, default)` second argument so
//  preview / test bundles (where the catalog is absent) still render the web copy.
//

import Foundation
import SwiftUI

/// Localized-string façade for the Alert Rules page. Call sites pass the web i18n
/// key (no `translation.` prefix) and the English fallback verbatim.
enum ARStrings {
    /// The catalog namespace every Alert Rules key folds onto.
    private static let namespace = "translation."

    /// Resolves `key` (web name) to a localized `String` with the web fallback.
    static func text(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(namespace + key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves `key` (web name) into a `LocalizedStringKey` for the shared
    /// components that localize their own arguments (titles, empty-state copy).
    static func key(_ key: String) -> LocalizedStringKey {
        LocalizedStringKey(namespace + key)
    }

    /// The pluralized item noun (web `itemNoun = { one: t('alertRules.noun.one'),
    /// other: t('alertRules.noun.other') }`). `count == 1` → singular.
    static func noun(_ count: Int) -> String {
        count == 1
            ? text("alertRules.noun.one", "rule")
            : text("alertRules.noun.other", "rules")
    }

    /// Per-row checkbox a11y label (web `t('alertRules.selectRule', { name })`).
    static func selectRule(name: String) -> String {
        String(format: text("alertRules.selectRule", "Select rule %1$@"), name)
    }

    /// Rename affordance a11y label (web `t('editableText.rename.alertRule', { name })`).
    static func renameRule(name: String) -> String {
        String(format: text("editableText.rename.alertRule", "Rename alert rule %1$@"), name)
    }
}

//
//  SmartChargeStrings.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — i18n seam
//
//  Resolves the page's visible strings from the app `Localizable.xcstrings`
//  catalog so no user-facing prose is hardcoded (ADR-014). The web keys are kept
//  verbatim at the call sites (`chargePlanner.optimize`, `chargePlanner.history`,
//  …) and folded onto the catalog's `translation.`-namespaced entries here, the
//  same convention the sibling feature views use. The English `fallback` mirrors
//  `web/src/features/charging/pages/SmartChargePage.tsx` defaults so preview /
//  test bundles (where the table is absent) still render deterministic copy.
//

import Foundation
import SwiftUI

/// Localized-string façade for the Smart Charge page. Call sites pass the web
/// i18n key (no `translation.` prefix) and the English fallback verbatim.
enum SmartChargeStrings {
    /// The catalog namespace every Smart Charge key folds onto.
    private static let namespace = "translation."

    /// Resolves `key` (web name) to a localized `String` with the web fallback.
    static func text(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(namespace + key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves `key` (web name) into a `LocalizedStringKey` for the shared
    /// components that localize their own arguments (titles, button labels).
    static func key(_ key: String) -> LocalizedStringKey {
        LocalizedStringKey(namespace + key)
    }

    /// Interpolates the `windowInfo` template (`Optimal window: %@ — %@`).
    static func windowInfo(start: String, end: String) -> String {
        let template = text("chargePlanner.windowInfo", "Optimal window: %1$@ — %2$@")
        return String(format: template, start, end)
    }
}

//
//  DDynStrings.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — i18n seam
//
//  Resolves the page's visible strings from the app `Localizable.xcstrings`
//  catalog so no user-facing prose is hardcoded (ADR-014). The web i18n keys are
//  kept verbatim at the call sites (`dynamics.title`, `dynamics.liveMotor`, …) and
//  folded onto the catalog's `translation.`-namespaced entries here — the same
//  convention the sibling Smart Charge page uses. The English `fallback` mirrors
//  `web/src/features/driving/.../DrivingDynamicsPage` defaults so preview / test
//  bundles (where the catalog is absent) still render deterministic copy.
//

import Foundation
import SwiftUI

/// Localized-string façade for the Driving Dynamics page. Call sites pass the web
/// i18n key (no `translation.` prefix) and the English fallback verbatim.
enum DDynStrings {
    /// The catalog namespace every Driving Dynamics key folds onto.
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

    /// Interpolates the coach `drivesAnalyzed` template (catalog `%1$@ drives analyzed`).
    static func drivesAnalyzed(_ count: Int) -> String {
        let template = text("dynamics.coach.drivesAnalyzed", "%1$@ drives analyzed")
        return String(format: template, "\(count)")
    }

    /// Localized label for a coach style chip (web `t('dynamics.coach.style.<key>', key)`).
    static func styleLabel(_ style: CoachStyle) -> String {
        switch style {
        case .efficient: text("dynamics.coach.style.efficient", "Efficient")
        case .moderate: text("dynamics.coach.style.moderate", "Moderate")
        case .aggressive: text("dynamics.coach.style.aggressive", "Aggressive")
        }
    }
}

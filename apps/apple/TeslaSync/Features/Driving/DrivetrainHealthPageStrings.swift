import Foundation
import SwiftUI

/// Localized-string façade for the Drivetrain Health page. Resolves every visible literal from the app
/// `Localizable.xcstrings` catalog so no user-facing prose is hardcoded (ADR-014). The web i18n keys are
/// kept verbatim at the call sites (`drivetrain.title`, `drivetrain.tempGauges`, …) and folded onto the
/// catalog's `translation.`-namespaced entries here — the same convention the sibling feature surfaces
/// use, since the catalog stores the web `drivetrain.*` keys under `translation.drivetrain.*`. The
/// English `fallback` mirrors `DrivetrainHealthPage.tsx` defaults so preview / test bundles (where the
/// table is absent) still render deterministic copy.
enum DrivetrainHealthPageStrings {
    /// The catalog namespace every Drivetrain Health key folds onto.
    private static let namespace = "translation."

    /// Resolves `key` (web name) to a localized `String` with the web fallback.
    static func text(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(namespace + key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves `key` (web name) into a `LocalizedStringKey` for the shared components that localize
    /// their own arguments (titles, labels, captions).
    static func key(_ key: String) -> LocalizedStringKey {
        LocalizedStringKey(namespace + key)
    }
}

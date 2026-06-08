//
//  TemplateGallery.State.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  The surface's render envelope, binding seam, and localization / accessibility
//  facades — split out of TemplateGallery.Model.swift to keep each file focused.
//  Holds the catalog binding error + the injectable ``TemplateGalleryCatalogSource``
//  (P1/S8), the four-case ``TemplateGalleryPhase`` (so every state renders), the
//  P1/S10 ``TemplateGalleryStrings`` facade, and the VoiceOver phrasing. All pure
//  and host-free.
//

import Foundation
import SwiftUI

// MARK: - Catalog source (P1/S8 binding seam)

/// A failure projecting the catalog — carries a localizable message so the
/// `failed` phase renders a real error surface with a retry affordance.
public struct TemplateGalleryCatalogError: Error, Equatable, Sendable {
    public let messageKey: String
    public let messageFallback: String

    public init(messageKey: String, messageFallback: String) {
        self.messageKey = messageKey
        self.messageFallback = messageFallback
    }
}

/// The injectable catalog source (P1/S8-style binding seam). The web imports the
/// preset catalog statically; here the same data is provided behind a protocol
/// so the view depends on an abstraction (dependency inversion) — production
/// binds the bundled canonical catalog, while tests/previews can inject empty,
/// failing, or partial catalogs to exercise every phase. There is no networking:
/// the bundled catalog is available offline by construction.
public protocol TemplateGalleryCatalogSource: Sendable {
    func loadCatalog() -> Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError>
}

// MARK: - Phase (every state renders — no hidden surfaces)

/// The full render envelope for the surface. The web source only ever resolves
/// to `loaded` / `empty` (its catalog is a synchronous client-seed import), but
/// modelling the loading + failed branches keeps the prompt's "every state must
/// render" guarantee honest: each case maps to a concrete, non-blank surface.
public enum TemplateGalleryPhase: Equatable, Sendable {
    /// A catalog resolution is in flight (only reachable via a deferred source).
    case loading
    /// The catalog resolved with at least one template.
    case loaded([TemplateGalleryTemplate])
    /// The catalog resolved but is empty — renders a friendly empty state.
    case empty
    /// The catalog failed to resolve — renders an error state with retry.
    case failed(messageKey: String, messageFallback: String)

    /// The resolved templates, or `[]` for any non-loaded phase.
    public var templates: [TemplateGalleryTemplate] {
        if case let .loaded(templates) = self { return templates }
        return []
    }

    /// Finds a template by id within the loaded set (web `DASHBOARD_PRESETS.find`).
    public func template(id: String?) -> TemplateGalleryTemplate? {
        guard let id else { return nil }
        return templates.first { $0.id == id }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with a web-style English fallback, so
/// the view holds no hardcoded literals. Keys + fallbacks mirror the web
/// `useTranslation('dashboard')` calls one-for-one (e.g. `templates.title`,
/// `common.back`, `templates.${id}.name`). Entries live in the "TemplateGallery"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum TemplateGalleryStrings {
    public static let table = "TemplateGallery"

    /// Resolves a key to a `String` (web `t(key, fallback)`).
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a key to a verbatim `Text` for rendering (the table is not the
    /// main table, so `LocalizedStringKey` cannot be used directly).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The widget-count line (web `t('templates.widgetCount', '{{count}} widgets', { count })`).
    public static func widgetCount(_ count: Int) -> String {
        String(format: string("templates.widgetCount", "%lld widgets"), count)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver phrasing for the surface. Kept pure + injectable so the
/// a11y contract can be asserted without rendering.
public enum TemplateGalleryAccessibility {
    /// Spoken label for a template card: "<name>, <n> widgets".
    public static func cardLabel(
        name: String,
        widgetCount: Int,
        localize: (String, String) -> String = TemplateGalleryStrings.string
    ) -> String {
        let format = localize("templates.card.a11y", "%1$@, %2$lld widgets")
        return String(format: format, name, widgetCount)
    }

    /// Spoken label for the "Blank" card: title + description, so VoiceOver reads
    /// the whole affordance as one element.
    public static func blankLabel(
        localize: (String, String) -> String = TemplateGalleryStrings.string
    ) -> String {
        let title = localize("templates.blank", "Blank Dashboard")
        let desc = localize("templates.blank.desc", "Start from scratch and add widgets manually")
        return "\(title). \(desc)"
    }

    /// Spoken label for a category-icon chip, so VoiceOver names the category
    /// instead of reading a decorative glyph.
    public static func categoryLabel(
        _ category: TemplateGalleryCategory,
        localize: (String, String) -> String = TemplateGalleryStrings.string
    ) -> String {
        localize("templates.category.\(category.rawValue)", category.rawValue.capitalized)
    }

    /// Spoken summary for the mini-grid preview, which is otherwise decorative.
    public static func gridLabel(
        widgetCount: Int,
        localize: (String, String) -> String = TemplateGalleryStrings.string
    ) -> String {
        let format = localize("templates.grid.a11y", "Layout preview, %1$lld widgets")
        return String(format: format, widgetCount)
    }
}

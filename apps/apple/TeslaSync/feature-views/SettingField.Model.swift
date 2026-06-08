//
//  SettingField.Model.swift
//  TeslaSync — P4 feature view · 0213 · SettingField (Apple)
//
//  The testable core for the `SettingField` surface — the SwiftUI parity of
//  features/settings/components/SettingField.tsx. The web component is a pure
//  presentational leaf (it fetches nothing): a labelled wrapper with an optional inline
//  `<HelpIcon>` and arbitrary `children`. So there is no store, no projection of remote
//  data, and no loading/error/stale/offline lifecycle here — those belong to whatever
//  control the caller embeds, exactly as on the web. What IS modelled is the one piece
//  of branching logic the web source carries: the `<HelpIcon>` content/aria resolution
//  and its "render nothing when there is no help text" rule. That logic is factored into
//  a pure, dependency-free projection (``SettingFieldHelpProjection``) so every branch is
//  unit tested without a rendering host.
//
//  i18n note: the help text and the icon's accessibility label resolve through the P1/S10
//  facade (``SettingFieldStrings``); the Swift sources hold no English literals. The
//  caller-supplied `i18nKey` is resolved against the app's global catalog (the native
//  analogue of the web global `t()`); the native-only accessibility chrome
//  (`a11y.helpFor`, `help.tooltip.iconLabel`) lives in the per-surface "SettingField"
//  table.
//

import Foundation

// MARK: - Surface identity (P1/S11)

/// Stable, non-identifying identity for the `SettingField` feature view. The slug is the
/// value emitted with the P1/S11 `view.opened` diagnostics contract and is referenced by
/// both the view and its tests so the two never drift.
public enum SettingFieldSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "SettingField"

    /// Reports the surface becoming visible. This is the exact code path the view runs
    /// from its `.task`, factored out so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any SettingFieldTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Help model (web `SettingFieldHelp`)

/// The optional inline help attached to a field's label — the native mirror of the web
/// `SettingFieldHelp` interface (`i18nKey` / `content` / `for`).
public struct SettingFieldHelp: Equatable, Sendable {
    /// i18n key for the help text (preferred over plain `content`); web `i18nKey`.
    public var i18nKey: String?
    /// Plain-text fallback when the key is missing or for one-offs; web `content`.
    public var content: String?
    /// The id of the field the help is attached to; web `for`. Surfaces in the trigger's
    /// accessibility label as "Help for {field}" and seeds the describing element id.
    public var fieldID: String?

    public init(i18nKey: String? = nil, content: String? = nil, fieldID: String? = nil) {
        self.i18nKey = i18nKey
        self.content = content
        self.fieldID = fieldID
    }
}

// MARK: - Help projection (web `<HelpIcon>` resolution)

/// The pure, `Equatable` projection of a ``SettingFieldHelp`` into the structural
/// decisions the help trigger renders: whether it appears at all (web `if (!text) return
/// null`), the resolved help text, its accessibility label (web `aria-label`), and the
/// id of the describing element (web `aria-describedby = "{for}-help"`). Keeping these in
/// a value type lets the XCTest suite cover every branch and the accessibility policy
/// without a snapshot host.
public struct SettingFieldHelpProjection: Equatable, Sendable {
    /// Whether the help trigger renders. Mirrors the web `if (!text) return null`: false
    /// when there is no key and no (non-empty) content, or when the resolved text is empty.
    public let rendersTrigger: Bool
    /// The resolved help text shown in the popover/tooltip (web `text`).
    public let helpText: String
    /// The trigger's accessibility label (web `aria-label`): "Help for {field}" when a
    /// field id is present, otherwise the generic "More info".
    public let accessibilityLabel: String
    /// The id of the element that describes the field (web `"{for}-help"`); `nil` when no
    /// field id was supplied.
    public let describedByID: String?

    public init(
        rendersTrigger: Bool,
        helpText: String,
        accessibilityLabel: String,
        describedByID: String?
    ) {
        self.rendersTrigger = rendersTrigger
        self.helpText = helpText
        self.accessibilityLabel = accessibilityLabel
        self.describedByID = describedByID
    }
}

/// Resolves a ``SettingFieldHelp`` into a ``SettingFieldHelpProjection``, reproducing the
/// web `<HelpIcon>` logic exactly. Pure: the two string resolvers are injected (defaulting
/// to the real P1/S10 facade) so tests assert every branch deterministically.
public enum SettingFieldHelpResolver {
    /// - Parameters:
    ///   - help: the optional help descriptor (web `help` prop).
    ///   - translate: resolves a caller-supplied `i18nKey` against the app's global
    ///     catalog with a fallback (web `t(i18nKey, { defaultValue })`).
    ///   - chrome: resolves the native accessibility chrome keys against the per-surface
    ///     table with their English fallbacks.
    public static func resolve(
        _ help: SettingFieldHelp?,
        translate: (_ key: String, _ fallback: String) -> String = SettingFieldStrings.app,
        chrome: (_ key: String, _ fallback: String) -> String = SettingFieldStrings.chrome
    ) -> SettingFieldHelpProjection {
        guard let help else {
            return SettingFieldHelpProjection(
                rendersTrigger: false, helpText: "", accessibilityLabel: "", describedByID: nil
            )
        }

        // web: text = i18nKey ? t(i18nKey, { defaultValue: content ?? '' }) : (content ?? '')
        let fallback = help.content ?? ""
        let text: String = if let key = help.i18nKey, !key.isEmpty {
            translate(key, fallback)
        } else {
            fallback
        }

        // web: an empty/whitespace `for` is falsy → generic label + no describedby.
        let field = help.fieldID.flatMap { $0.isEmpty ? nil : $0 }
        let describedByID = field.map { "\($0)-help" }
        let accessibilityLabel = field
            .map { String(format: chrome("a11y.helpFor", "Help for %@"), $0) }
            ?? chrome("help.tooltip.iconLabel", "More info")

        return SettingFieldHelpProjection(
            rendersTrigger: !text.isEmpty,
            helpText: text,
            accessibilityLabel: accessibilityLabel,
            describedByID: describedByID
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the views hold
/// no hardcoded literals. The accessibility chrome lives in the per-surface "SettingField"
/// table (folded into the app `Localizable.xcstrings` at integration time); a
/// caller-supplied help `i18nKey` is resolved against the app's global catalog, mirroring
/// the web global `t()`.
public enum SettingFieldStrings {
    /// The per-surface table holding this surface's native accessibility chrome.
    public static let table = "SettingField"

    /// Resolves a native-chrome key from the per-surface table with an English fallback.
    public static func chrome(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a caller-supplied help `i18nKey` from the app's global catalog with the
    /// caller's plain-text `content` as the fallback (web `t(i18nKey, { defaultValue })`).
    public static func app(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }
}

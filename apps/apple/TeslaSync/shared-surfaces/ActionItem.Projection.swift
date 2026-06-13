//
//  ActionItem.Projection.swift
//  TeslaSync — P4 shared surface · 0196 · ActionItem (Apple)
//
//  The pure projection from the props to the view-ready model the SwiftUI body renders — the native port
//  of the web `ActionItem` + `ActionCTA` render bodies. The web component collapses its props into a
//  fixed set of layout decisions: the severity (which picks the glyph + colours the chrome), the title +
//  optional description text, and — from the `cta`'s `to` / `external` / `onClick` — whether a trailing
//  CTA renders and as which wrapper (internal route / external link / action button). This projection
//  bakes every one of those decisions into an ``ActionItemProjection`` the view consumes as a pure
//  function; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``ActionItemProjector/resolve(input:severityWord:)`` takes the structural props a host already holds
//  (the severity / title / description / cta) and derives the rendered layout decisions — no networking,
//  no clock, no SwiftUI — plus the composed VoiceOver label (the accessible parity of the colour-encoded
//  severity, which a sighted user perceives but a VoiceOver user cannot). The localized severity word +
//  the CTA hints are resolved in the @Observable model (ActionItem.Model.swift), which owns the i18n
//  facade, and injected here so the projector stays Foundation-only + facade-agnostic for tests.
//

import Foundation

// MARK: - ActionItemCTAProjection (web `ActionCTA` render output)

/// The resolved CTA — everything the trailing affordance needs as a pure value: the label, the wrapper
/// kind, the optional `href` (web `to`, meaningful only for the link kinds), and the derived a11y traits.
/// Absent when the source passes no CTA (or a CTA the web `ActionCTA` resolves to `null`); the view then
/// renders only the icon + title + description.
public struct ActionItemCTAProjection: Sendable, Equatable {
    /// The CTA button label (web `cta.label`).
    public let label: String
    /// The wrapper kind — route / externalLink / action (web `<Link>` / `<a>` / `<button>`).
    public let kind: ActionItemCTAKind
    /// The link target, surfaced for accessibility + tests (web `cta.to`); `nil` for the action kind.
    public let href: String?

    /// Whether VoiceOver should announce the CTA as a link (web `<Link>` / `<a>`).
    public var accessibilityIsLink: Bool {
        kind.isLink
    }

    /// Whether activating the CTA leaves the app (web `external` → `target="_blank"`).
    public var opensExternally: Bool {
        kind.opensExternally
    }

    public init(label: String, kind: ActionItemCTAKind, href: String?) {
        self.label = label
        self.kind = kind
        self.href = href
    }
}

// MARK: - ActionItemProjection (web `ActionItem` render output)

/// The resolved, view-ready layout decisions — the native bundle of everything the web `ActionItem`
/// render body decides from its props. The view is a pure function of this value: it tints the chrome by
/// `severity`, shows the `iconSystemName` glyph, renders the `title` (and the `description` iff present),
/// and renders the trailing `cta` affordance iff present. `accessibilityLabel` is the composed VoiceOver
/// label that names the severity (the accessible parity of the web's colour-only severity signal).
public struct ActionItemProjection: Sendable, Equatable {
    /// The severity tier driving the glyph + chrome tint (web `severity`).
    public let severity: ActionSeverity
    /// The leading SF Symbol for the severity (web lucide glyph).
    public let iconSystemName: String
    /// The primary task line, passed through for rendering (web `title`).
    public let title: String
    /// The optional sub-line, passed through for rendering (web `description`); `nil` renders no line.
    public let description: String?
    /// The resolved trailing CTA (web `ActionCTA` output); `nil` renders no affordance.
    public let cta: ActionItemCTAProjection?
    /// The composed VoiceOver label for the info group — "{severity}: {title}" (+ ". {description}").
    public let accessibilityLabel: String

    /// Whether the description sub-line renders (web `description != null`).
    public var showsDescription: Bool {
        description != nil
    }

    /// Whether the trailing CTA renders (web `cta != null` and `ActionCTA` did not resolve to `null`).
    public var showsCTA: Bool {
        cta != nil
    }

    public init(
        severity: ActionSeverity,
        iconSystemName: String,
        title: String,
        description: String?,
        cta: ActionItemCTAProjection?,
        accessibilityLabel: String
    ) {
        self.severity = severity
        self.iconSystemName = iconSystemName
        self.title = title
        self.description = description
        self.cta = cta
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - ActionItemProjector (web `ActionItem` + `ActionCTA` render bodies)

/// Pure projection to the view-ready layout decisions — the verbatim port of the web `ActionItem` +
/// `ActionCTA` render bodies. Kept as a pure function over the caller-owned structural props so every
/// branch (each severity, description present / absent, each CTA kind, the CTA-null case) is unit tested
/// without an @Observable model or a view.
public enum ActionItemProjector {
    /// Resolves the layout decisions exactly like the web component. `severityWord` resolves the
    /// localized severity word (injected so the projector stays Foundation-only + facade-agnostic for
    /// tests):
    ///   • `severity` picks the glyph (``ActionSeverity/iconSystemName``) + drives the chrome tint.
    ///   • `title` / `description` pass through (the description renders iff non-`nil`).
    ///   • `cta` resolves to an ``ActionItemCTAProjection`` via ``resolveCTA(_:)``, or `nil` (no
    ///     affordance) — the native peer of the web `ActionCTA` returning an element or `null`.
    ///   • `accessibilityLabel` names the severity then the title (and the description when present), so
    ///     VoiceOver conveys the severity the colour encodes for a sighted user.
    public static func resolve(
        input: ActionItemInput,
        severityWord: (ActionSeverity) -> String
    ) -> ActionItemProjection {
        ActionItemProjection(
            severity: input.severity,
            iconSystemName: input.severity.iconSystemName,
            title: input.title,
            description: input.description,
            cta: resolveCTA(input.cta),
            accessibilityLabel: accessibilityLabel(
                severity: severityWord(input.severity),
                title: input.title,
                description: input.description
            )
        )
    }

    /// Resolves the trailing CTA — the verbatim port of the web `ActionCTA`: a `route` / `externalLink`
    /// carries its `href` (web `cta.to`), an `action` drops it (web `onClick` has no `to`), and a `nil`
    /// input renders nothing (web `cta == null`, or a `cta` with neither `to` nor `onClick`, for which
    /// `ActionCTA` returns `null`).
    public static func resolveCTA(_ cta: ActionItemCTAInput?) -> ActionItemCTAProjection? {
        guard let cta else { return nil }
        return ActionItemCTAProjection(
            label: cta.label,
            kind: cta.kind,
            href: cta.kind.isLink ? cta.href : nil
        )
    }

    /// Composes the VoiceOver label as "{severity}: {title}" (plus ". {description}" when a description
    /// is present) — the same shape the sibling `InlineCalloutProjector.accessibilityLabel` uses.
    /// Announcing the severity is the accessible parity of the web's colour-only severity signal; the
    /// leading glyph and the CTA chevron are decorative (web `aria-hidden`).
    static func accessibilityLabel(severity: String, title: String, description: String?) -> String {
        var label = "\(severity): \(title)"
        if let description, !description.isEmpty {
            label += ". \(description)"
        }
        return label
    }
}

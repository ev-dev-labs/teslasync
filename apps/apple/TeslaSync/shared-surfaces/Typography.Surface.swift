//
//  Typography.Surface.swift
//  TeslaSync — P4 shared surface · 0232 · Typography (Apple)
//
//  The public API of the typographic role system — the SwiftUI parity of `components/ui/Typography.tsx`.
//  (The entry file is named `Typography.Surface.swift`, not `Typography.swift`, because the app target
//  already compiles the atomic `Sources/Components/UI/Typography.swift`; Swift requires a unique file
//  basename per target, so this surface follows the established collision convention used by
//  `Tabs.Surface.swift` / `CommandPalette.Surface.swift`.)
//  ``Typography`` is the parity of the web `<Text>` (a composed `role`, or a granular `size` / `weight` /
//  `color` / `mono` composition); ``TypographyHeading`` is the parity of the web `<Heading level>` (it adds
//  the explicit VoiceOver heading rank for the level's `<h1>`…`<h4>`); and the convenience factories on
//  ``Typography`` (`pageTitle` … `code`) mirror the web `PageTitle` / `SectionTitle` / `PanelTitle` /
//  `Subhead` / `Caption` / `HelperText` / `ErrorText` / `Label` / `MetricValue` / `MetricLabel` / `Code`
//  exports 1:1. Like the web component each is driven entirely by its props (the text + the role/granular
//  options); there is no fetcher. The text is a caller-supplied, already-localized value rendered verbatim
//  (the web `children`). Each binds through ``TypographyModel`` for the once-only `view.opened` telemetry
//  (P1/S11), resolves its style via the pure ``TypographyProjector`` (P1/S8 derivation), composes the
//  token-driven chrome (P1/S9), and pushes prop changes into the holder via `.onChange` so a reused element
//  re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Typography (web `<Text>`)

/// The typographic text element — the SwiftUI parity of `components/ui/Typography.tsx`'s `<Text>`. Renders
/// caller-supplied, already-localized text in a composed ``TypographyRole`` (`Typography("…", role:)`) or a
/// granular size / weight / color / mono composition (`Typography("…", size:weight:color:mono:)`). A blank
/// string renders the friendly empty leaf rather than a bare box (native HIG). Mount it anywhere the app
/// renders body copy, captions, labels, code, or metric readouts.
public struct Typography: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        TypographySurface.slug
    }

    private let content: TypographyContent
    @State private var model: TypographyModel

    /// The composed-role initializer — the parity of `<Text variant={role}>`. Resolves the role to a
    /// complete style via ``TypographyProjector``.
    public init(
        _ text: String,
        role: TypographyRole,
        telemetry: any TypographyTelemetry = OSLogTypographyTelemetry()
    ) {
        let resolved = TypographyContent(text: text, style: TypographyProjector.style(for: role))
        content = resolved
        _model = State(initialValue: TypographyModel(content: resolved, telemetry: telemetry))
    }

    /// The granular initializer — the parity of `<Text size weight color mono>`. Starts from the body-like
    /// base and applies only the dimensions supplied; `Typography("…")` renders comfortable primary body
    /// text (the web bare `<Text>`).
    public init(
        _ text: String,
        size: TypographySize? = nil,
        weight: TypographyWeight? = nil,
        color: TypographyColor? = nil,
        mono: Bool = false,
        telemetry: any TypographyTelemetry = OSLogTypographyTelemetry()
    ) {
        let style = TypographyProjector.style(size: size, weight: weight, color: color, mono: mono)
        let resolved = TypographyContent(text: text, style: style)
        content = resolved
        _model = State(initialValue: TypographyModel(content: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded content).
    public init(model: TypographyModel) {
        content = model.content
        _model = State(initialValue: model)
    }

    public var body: some View {
        TypographyStyledText(content: model.content)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: content) { _, newContent in
                model.update(newContent)
            }
    }
}

// MARK: - Convenience factories (web `PageTitle` … `Code`)

public extension Typography {
    /// The largest heading role — web `PageTitle` (`<Heading level="page">`).
    static func pageTitle(_ text: String) -> Typography {
        Typography(text, role: .pageTitle)
    }

    /// The section heading role — web `SectionTitle` (`<Heading level="section">`).
    static func sectionTitle(_ text: String) -> Typography {
        Typography(text, role: .sectionTitle)
    }

    /// The panel / card heading role — web `PanelTitle` (`<Heading level="panel">`).
    static func panelTitle(_ text: String) -> Typography {
        Typography(text, role: .panelTitle)
    }

    /// The secondary heading role — web `Subhead` (`<Heading level="sub">`).
    static func subhead(_ text: String) -> Typography {
        Typography(text, role: .subhead)
    }

    /// De-emphasized caption text — web `Caption`.
    static func caption(_ text: String) -> Typography {
        Typography(text, role: .caption)
    }

    /// Helper text under a control — web `HelperText`.
    static func helperText(_ text: String) -> Typography {
        Typography(text, role: .helper)
    }

    /// Inline validation / error text — web `ErrorText`.
    static func errorText(_ text: String) -> Typography {
        Typography(text, role: .error)
    }

    /// Uppercased field label — web `Label`.
    static func label(_ text: String) -> Typography {
        Typography(text, role: .label)
    }

    /// Large numeric metric readout (tabular figures) — web `MetricValue`.
    static func metricValue(_ text: String) -> Typography {
        Typography(text, role: .metricValue)
    }

    /// Uppercased label under a metric — web `MetricLabel`.
    static func metricLabel(_ text: String) -> Typography {
        Typography(text, role: .metricLabel)
    }

    /// Inline monospaced code / value — web `Code`.
    static func code(_ text: String) -> Typography {
        Typography(text, role: .code)
    }
}

// MARK: - TypographyHeading (web `<Heading level>`)

/// The semantic heading — the SwiftUI parity of `components/ui/Typography.tsx`'s `<Heading level>`. Renders
/// the level's composed role (web `HEADING_ROLE[level]`) and additionally exposes the explicit VoiceOver
/// heading rank for the level's `<h1>`…`<h4>`, so assistive tech can navigate the page by heading. Prefer
/// it over the ``Typography/pageTitle(_:)`` … ``Typography/subhead(_:)`` convenience when the caller wants
/// the explicit rank (otherwise the convenience peers render identically with the `.isHeader` trait).
public struct TypographyHeading: View {
    private let text: String
    private let level: TypographyHeadingLevel
    private let telemetry: any TypographyTelemetry

    public init(
        _ text: String,
        level: TypographyHeadingLevel = .section,
        telemetry: any TypographyTelemetry = OSLogTypographyTelemetry()
    ) {
        self.text = text
        self.level = level
        self.telemetry = telemetry
    }

    public var body: some View {
        Typography(text, role: level.role, telemetry: telemetry)
            .accessibilityHeading(level.accessibilityHeadingLevel)
    }
}

extension TypographyHeadingLevel {
    /// The SwiftUI heading rank — the web `<h1>`…`<h4>` surfaced to VoiceOver.
    var accessibilityHeadingLevel: AccessibilityHeadingLevel {
        switch self {
        case .page: .h1
        case .section: .h2
        case .panel: .h3
        case .sub: .h4
        }
    }
}

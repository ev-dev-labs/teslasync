import SwiftUI

// MARK: - ToolCard

/// Native, Apple-idiomatic parity of the web `ToolCard`
/// (`features/admin/components/devtools/ToolCard.tsx`).
///
/// A presentational container: a glass panel whose header pairs an accent icon
/// chip with a title + optional description, followed by caller-supplied content
/// (the web `children`). It owns no data — exactly like the web component — so
/// the cache/loading/error/stale/offline states belong to whatever content the
/// caller embeds, not to the card itself. The one branch the web source carries
/// (the `color` → accent map with a `cyan` fallback) is reproduced by
/// ``ToolCardTint``.
///
/// On appear it emits the P1/S11 `view.opened` diagnostics event with the
/// ``ToolCardSurface/slug``.
public struct ToolCard<Content: View>: View {
    private let title: LocalizedStringKey
    private let description: LocalizedStringKey?
    private let presentation: ToolCardPresentation
    private let telemetry: any ToolCardTelemetry
    private let content: Content

    /// Designated initialiser.
    /// - Parameters:
    ///   - systemImage: SF Symbol for the accent chip (native analogue of the
    ///     web Lucide `icon` element).
    ///   - tint: the icon accent (web `color`).
    ///   - title: card title (a P1/S10 catalog key — never raw English).
    ///   - description: optional secondary line (a P1/S10 catalog key).
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    ///   - content: the embedded tool body (web `children`).
    public init(
        systemImage: String,
        tint: ToolCardTint,
        title: LocalizedStringKey,
        description: LocalizedStringKey? = nil,
        telemetry: any ToolCardTelemetry = OSLogToolCardTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.description = description
        presentation = ToolCardPresentation(
            iconSystemName: systemImage,
            tint: tint,
            hasDescription: description != nil
        )
        self.telemetry = telemetry
        self.content = content()
    }

    /// Web-parity convenience initialiser keyed off a free-form `color` string,
    /// resolved through ``ToolCardTint/init(web:)`` (unknown ⇒ `cyan`).
    public init(
        systemImage: String,
        colorName: String,
        title: LocalizedStringKey,
        description: LocalizedStringKey? = nil,
        telemetry: any ToolCardTelemetry = OSLogToolCardTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            systemImage: systemImage,
            tint: ToolCardTint(web: colorName),
            title: title,
            description: description,
            telemetry: telemetry,
            content: content
        )
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { ToolCardSurface.reportOpen(to: telemetry) }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPanelTitle(title)
                if let description {
                    TSCaption(description)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
    }

    private var iconChip: some View {
        Image(systemName: presentation.iconSystemName)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(presentation.tint.accent)
            .frame(width: 40, height: 40)
            .background(
                presentation.tint.iconBackground,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(presentation.tint.iconBorder, lineWidth: 1)
            )
            .accessibilityHidden(presentation.iconIsDecorative)
    }
}

// MARK: - Previews

#if DEBUG
    #Preview("Tints") {
        ScrollView {
            VStack(spacing: TSSpacing.lg) {
                ToolCard(
                    systemImage: "number",
                    tint: .cyan,
                    title: "toolCard.preview.title",
                    description: "toolCard.preview.description"
                ) {
                    TSText("toolCard.preview.body", variant: .small)
                }
                ToolCard(
                    systemImage: "bolt.fill",
                    tint: .green,
                    title: "toolCard.preview.title",
                    description: "toolCard.preview.description"
                ) {
                    TSText("toolCard.preview.body", variant: .small)
                }
                ToolCard(
                    systemImage: "globe",
                    tint: .purple,
                    title: "toolCard.preview.title",
                    description: "toolCard.preview.description"
                ) {
                    TSText("toolCard.preview.body", variant: .small)
                }
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Fallback · no description") {
        ToolCard(
            systemImage: "shield.fill",
            colorName: "chartreuse-not-a-real-color",
            title: "toolCard.preview.title"
        ) {
            TSText("toolCard.preview.body", variant: .small)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }
#endif

//
//  AccordionSection.swift
//  TeslaSync — P4 feature view · 0236 · AccordionSection (Apple)
//
//  Native, Apple-idiomatic parity of the web `AccordionSection`
//  (web/src/features/system/components/status/AccordionSection.tsx): a frosted, rounded
//  disclosure panel with an always-visible header (accent icon · title · description ·
//  optional badges · rotating chevron) and a bordered, fade-in body revealed on toggle.
//
//  The web header is a `role="button" tabIndex=0` div toggled by click + Enter/Space with
//  `aria-expanded`; the native header is a real `Button` (keyboard + Full Keyboard Access
//  + VoiceOver activation for free) carrying an `.accessibilityValue` (expanded/collapsed)
//  and `.accessibilityHint`. The reveal uses the shared `TSFadeIn` (web `<FadeIn>`); the
//  chevron + height animate with the standard motion token, honoring Reduce Motion.
//
//  Generic over the icon, badges, and body content (web `ReactNode` props) so the surface
//  is a faithful, reusable container. Convenience initializers cover the common shapes
//  (SF Symbol icon, no badges) without the caller spelling out empty view-builders.
//

import SwiftUI

/// The accordion section surface. Construct it with a title + description, an icon, an
/// optional badges accessory, and the collapsible body content.
public struct AccordionSection<Icon: View, Badges: View, Content: View>: View {
    private let title: String
    private let sectionDescription: String
    private let icon: Icon
    private let badges: Badges
    private let content: Content

    @State private var model: AccordionSectionModel
    @State private var isHovering = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initializer — full control over the icon, badges, and body content.
    public init(
        title: String,
        description: String,
        defaultOpen: Bool = false,
        telemetry: any AccordionSectionTelemetry = OSLogAccordionSectionTelemetry(),
        @ViewBuilder icon: () -> Icon,
        @ViewBuilder badges: () -> Badges,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        sectionDescription = description
        self.icon = icon()
        self.badges = badges()
        self.content = content()
        _model = State(initialValue: AccordionSectionModel(defaultOpen: defaultOpen, telemetry: telemetry))
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            if model.isOpen {
                AccordionSectionBody {
                    content
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.isOpen)
        .onAppear { model.start() }
    }

    // MARK: Header (web `role="button"` row)

    private var header: some View {
        Button {
            model.toggle()
        } label: {
            HStack(spacing: TSSpacing.md) {
                AccordionSectionIcon { icon }
                titleBlock
                badges
                AccordionSectionChevron(rotationDegrees: model.chevronRotationDegrees)
            }
            .padding(.horizontal, TSSpacing.xl)
            .padding(.vertical, TSSpacing.lg)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(isHovering ? Color.TS.textPrimary.opacity(0.03) : Color.clear)
        .onHover { isHovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityValue(Text(verbatim: model.accessibilityValue))
        .accessibilityHint(Text(verbatim: model.accessibilityHint))
    }

    /// Title (web `text-sm font-semibold`) over description (web `text-xs text-muted`).
    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: title)
                .font(Font.TS.body.weight(.semibold))
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: sectionDescription)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Convenience initializers

public extension AccordionSection where Badges == EmptyView {
    /// A section without a badges accessory (web `badges` omitted).
    init(
        title: String,
        description: String,
        defaultOpen: Bool = false,
        telemetry: any AccordionSectionTelemetry = OSLogAccordionSectionTelemetry(),
        @ViewBuilder icon: () -> Icon,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title: title,
            description: description,
            defaultOpen: defaultOpen,
            telemetry: telemetry,
            icon: icon,
            badges: { EmptyView() },
            content: content
        )
    }
}

public extension AccordionSection where Icon == Image, Badges == EmptyView {
    /// A section with an SF Symbol icon and no badges — the most common shape.
    init(
        title: String,
        description: String,
        systemImage: String,
        defaultOpen: Bool = false,
        telemetry: any AccordionSectionTelemetry = OSLogAccordionSectionTelemetry(),
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title: title,
            description: description,
            defaultOpen: defaultOpen,
            telemetry: telemetry,
            icon: { Image(systemName: systemImage) },
            badges: { EmptyView() },
            content: content
        )
    }
}

public extension AccordionSection where Icon == Image {
    /// A section with an SF Symbol icon and a badges accessory.
    init(
        title: String,
        description: String,
        systemImage: String,
        defaultOpen: Bool = false,
        telemetry: any AccordionSectionTelemetry = OSLogAccordionSectionTelemetry(),
        @ViewBuilder badges: () -> Badges,
        @ViewBuilder content: () -> Content
    ) {
        self.init(
            title: title,
            description: description,
            defaultOpen: defaultOpen,
            telemetry: telemetry,
            icon: { Image(systemName: systemImage) },
            badges: badges,
            content: content
        )
    }
}

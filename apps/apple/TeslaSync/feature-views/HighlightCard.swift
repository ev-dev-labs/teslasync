//
//  HighlightCard.swift
//  TeslaSync — P4 feature view · 0076 · HighlightCard (Apple)
//
//  Native, Apple-idiomatic parity of the web `HighlightCard`
//  (features/analytics/components/weekly-digest/HighlightCard.tsx).
//
//  A presentational metric card on a glass panel: an icon + label header, a large
//  value, an optional trend chip (up / down with a success / danger tint), and an
//  optional subtitle. The web `color` prop drives the accent + the glow map. It
//  owns no data — the data-bound states (loading / error / stale / offline) belong
//  to the embedding caller — so the only branches here are the ones the web source
//  carries, plus an em-dash empty value so a missing metric never renders blank.
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with the
//  ``HighlightCardSurface/slug``.
//

import SwiftUI

// MARK: - HighlightCard

public struct HighlightCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`); the canonical source.
    /// `nonisolated` because it is a compile-time constant — `View` is
    /// `@MainActor`, but the slug must be readable from any context (tests,
    /// telemetry adapters) without a main-actor hop.
    public nonisolated static let surfaceSlug = HighlightCardSurface.slug

    private let systemImage: String
    private let label: LocalizedStringKey
    private let value: String
    private let change: HighlightCardChange?
    private let subtitle: LocalizedStringKey?
    private let accent: HighlightCardAccent
    private let presentation: HighlightCardPresentation
    private let telemetry: any HighlightCardTelemetry

    /// Designated initialiser.
    /// - Parameters:
    ///   - systemImage: SF Symbol for the header (native analogue of the web
    ///     lucide `icon` element).
    ///   - label: the metric label (a caller-owned P1/S10 catalog key).
    ///   - value: the caller-formatted metric value, rendered verbatim. An empty
    ///     value renders the em-dash empty form.
    ///   - change: optional trend chip (web `change`).
    ///   - subtitle: optional secondary line (a caller-owned P1/S10 catalog key).
    ///   - accent: the colour accent + glow (web `color`).
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        systemImage: String,
        label: LocalizedStringKey,
        value: String,
        change: HighlightCardChange? = nil,
        subtitle: LocalizedStringKey? = nil,
        accent: HighlightCardAccent = .cyan,
        telemetry: any HighlightCardTelemetry = OSLogHighlightCardTelemetry()
    ) {
        self.systemImage = systemImage
        self.label = label
        self.value = value
        self.change = change
        self.subtitle = subtitle
        self.accent = accent
        presentation = HighlightCardPresentation(
            iconSystemName: systemImage,
            accent: accent,
            value: value,
            change: change,
            hasSubtitle: subtitle != nil
        )
        self.telemetry = telemetry
    }

    /// Web-parity convenience initialiser keyed off a free-form `color` string,
    /// resolved through ``HighlightCardAccent/init(web:)`` (unknown ⇒ `cyan`).
    public init(
        systemImage: String,
        label: LocalizedStringKey,
        value: String,
        colorName: String,
        change: HighlightCardChange? = nil,
        subtitle: LocalizedStringKey? = nil,
        telemetry: any HighlightCardTelemetry = OSLogHighlightCardTelemetry()
    ) {
        self.init(
            systemImage: systemImage,
            label: label,
            value: value,
            change: change,
            subtitle: subtitle,
            accent: HighlightCardAccent(web: colorName),
            telemetry: telemetry
        )
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                labelRow
                valueRow
                if let change {
                    changeRow(change)
                }
                if let subtitle {
                    TSCaption(subtitle)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .modifier(HighlightCardGlow(color: accent.glowColor))
        .task { HighlightCardSurface.reportOpen(to: telemetry) }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Sections

private extension HighlightCard {
    /// Icon + label header (web `text-sm text-[var(--text-secondary)]`).
    var labelRow: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(presentation.iconIsDecorative)
            Text(label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    /// The metric value, or the em-dash empty form (web `text-2xl font-bold`).
    @ViewBuilder
    var valueRow: some View {
        if presentation.hasValue {
            Text(verbatim: value)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        } else {
            Text(verbatim: HighlightCardAccessibility.emptyValueGlyph)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text(verbatim: HighlightCardAccessibility.emptyValueLabel))
        }
    }

    /// The trend chip (web `change.positive ? TrendingUp : TrendingDown`).
    func changeRow(_ change: HighlightCardChange) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: change.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: change.value)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
        }
        .foregroundStyle(change.tint)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: HighlightCardAccessibility.changeLabel(
                isPositive: change.isPositive,
                value: change.value
            ))
        )
    }
}

// MARK: - Glow (web `GlassPanel` glow map)

/// Applies the accent glow for `cyan/green/purple` and nothing for `amber/red`,
/// reproducing the web `glowMap`. The glow is a soft, low-opacity shadow in the
/// accent hue — the native, HIG-friendly read of the web hover box-shadow.
private struct HighlightCardGlow: ViewModifier {
    let color: Color?

    func body(content: Content) -> some View {
        if let color {
            content.shadow(color: color.opacity(0.22), radius: 14)
        } else {
            content
        }
    }
}

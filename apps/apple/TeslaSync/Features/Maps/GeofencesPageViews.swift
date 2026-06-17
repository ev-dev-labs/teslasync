//
//  GeofencesPageViews.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Shared UI + panels
//
//  The shared HIG furniture (the `GlassPanel` peer, the section header, the
//  `MetricCard` peer, badges, the staleness chip, a labelled field + icon button)
//  plus the list-side panels: the summary stat grid (web GlassPanel 1 + four
//  MetricCards), the loading skeleton (web GlassPanel 6), one geofence list card
//  (web GlassPanel 7) with its inline rename + badges + actions, the bulk-action
//  toolbar, the search/filter bar, the AI location-id picker, the page empty state
//  and the transient toast. Materials stand in for the web glass (ADR-005); every
//  color/typography value comes from the design tokens (P2); every string resolves
//  from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web GlassPanel)

/// The frosted card that stands in for the web `GlassPanel`.
struct GeofencesCard<Content: View>: View {
    var padding: CGFloat = TSSpacing.xl
    var glow: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg)
                    .stroke(glow ? Color.TS.chartSeriesPower.opacity(0.45) : Color.TS.border, lineWidth: 1)
            )
    }
}

/// Section header (web `<h3>` / panel heading) with a leading glyph.
struct GeofencesSectionHeader: View {
    let systemImage: String
    let title: String
    var tone: Color = .TS.accent

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(title))
    }
}

/// A tinted status/alert chip (web `Badge`).
struct GeofencesBadge: View {
    let text: String
    let tone: Color

    var body: some View {
        Text(text)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.14), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.30), lineWidth: 1))
            .accessibilityLabel(Text(text))
    }
}

/// A ghost icon button (web ghost `Button` with only an icon).
struct GeofencesIconButton: View {
    let systemImage: String
    let label: String
    var role: ButtonRole?
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Image(systemName: systemImage)
                .font(Font.TS.body)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.borderless)
        .foregroundStyle(role == .destructive ? Color.TS.statusDanger : Color.TS.textSecondary)
        .accessibilityLabel(Text(label))
    }
}

/// A labelled text/number field (web `Input` — label + field + optional icon /
/// hint / inline error).
struct GeofencesLabeledField: View {
    let label: String
    @Binding var text: String
    var prompt: String = ""
    var systemImage: String?
    var keyboard: GeofencesFieldKeyboard = .text
    var hint: String?
    var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                fieldBody
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(error == nil ? Color.TS.border : Color.TS.statusDanger, lineWidth: 1)
            )
            if let error {
                Text(error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
            } else if let hint {
                Text(hint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(label))
    }

    @ViewBuilder
    private var fieldBody: some View {
        TextField(prompt, text: $text)
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
        #if os(iOS)
            .keyboardType(keyboard == .decimal ? .numbersAndPunctuation : .default)
            .autocorrectionDisabled(keyboard != .text)
        #endif
    }
}

/// The keyboard hint for a labelled field (web `<input type=…>`).
enum GeofencesFieldKeyboard {
    case text
    case decimal
}

// MARK: - MetricCard (web data-display `MetricCard`)

/// One summary metric tile (web `MetricCard`): leading icon, big count, caption.
struct GeofencesMetricCard: View {
    let label: String
    let value: Int
    let systemImage: String
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(Font.TS.panel)
                .foregroundStyle(accent)
                .accessibilityHidden(true)
            Text(GeofencesFormat.integer(value))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(label): \(GeofencesFormat.integer(value))"))
    }
}

// MARK: - Staleness chip (ADR-013)

/// Subtle chip surfaced when the last successful load is older than two minutes.
struct GeofencesStalenessChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(String(localized: "common.staleData", defaultValue: "Data may be out of date"))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

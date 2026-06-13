//
//  RecentActivity.Vehicles.Views.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  The two panels composed by `VehicleRecentActivity`: the shared glass-panel shell + section
//  header (web `GlassPanel` + `section-title` + "View all"), the recent-drives panel and the
//  recent-charges panel (one reusable panel configured twice), and the activity row (web drive /
//  charge `<Link>` row: tinted IconBox + value + timestamp + duration + SoC). The freshness chip,
//  connectivity banner, and the surface-level loading / empty / error states live in
//  RecentActivity.Vehicles.States.swift. All copy resolves through the P1/S10 facade and all chrome
//  is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Palette (web value/tint colors → adaptive tokens)

/// Maps the surface's feed kinds to design-token colors + glyphs. The web uses Tailwind tints (cyan
/// for drives, emerald for charges); native uses theme-adaptive semantic tokens so light / dark /
/// high-contrast all resolve correctly.
enum VehicleRecentActivityPalette {
    /// The row IconBox tint (web drive `IconBox color="cyan"` / charge `IconBox color="green"`).
    static func kindTint(_ kind: VehicleRecentActivityKind) -> Color {
        switch kind {
        case .drive: Color.TS.accent
        case .charge: Color.TS.statusSuccess
        }
    }

    /// The row glyph (web drive `Route` / charge `Zap`).
    static func kindIcon(_ kind: VehicleRecentActivityKind) -> String {
        switch kind {
        case .drive: "road.lanes"
        case .charge: "bolt.fill"
        }
    }
}

// MARK: - Glass panel shell (web `GlassPanel className="p-6"`)

/// A glass card mirroring the web `<GlassPanel className="p-6">` — the shared shell each of the two
/// panels renders inside.
struct VehicleRecentActivityGlassPanel<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            content()
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// A tinted rounded-square glyph badge (web `IconBox color size="sm"`).
struct VehicleRecentActivityIconBox: View {
    let systemImage: String
    let tint: Color

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 32, height: 32)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(tint.opacity(0.4), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Section header (web `section-title` + "View all" link)

/// A panel's header: the tinted glyph + the localized title (web `h3.section-title`) and the
/// "View all" affordance (web `<Link>` + chevron) the host wires to navigation.
struct VehicleRecentActivitySectionHeader: View {
    let systemImage: String
    let tint: Color
    let titleKey: String
    let titleFallback: String
    let onViewAll: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            VehicleRecentActivityStrings.text(titleKey, titleFallback)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onViewAll) {
                HStack(spacing: 2) {
                    VehicleRecentActivityStrings.text("common.viewAll", "View all")
                        .font(Font.TS.caption)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                }
                .foregroundStyle(Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleRecentActivityStrings.text("common.viewAll", "View all"))
        }
    }
}

// MARK: - Activity panel (web Recent Drives / Recent Charges `GlassPanel`)

/// One activity panel — the reusable shell used for both Recent Drives and Recent Charges. Renders
/// the header over the rows, or the friendly per-panel empty (web "No drives recorded yet" /
/// "No charging sessions recorded yet"). Never a blank box.
struct VehicleRecentActivityPanel: View {
    let icon: String
    let tint: Color
    let titleKey: String
    let titleFallback: String
    let rows: [VehicleRecentActivityRow]
    let emptyKey: String
    let emptyFallback: String
    let onViewAll: () -> Void
    let onSelect: (String) -> Void

    var body: some View {
        VehicleRecentActivityGlassPanel {
            VehicleRecentActivitySectionHeader(
                systemImage: icon,
                tint: tint,
                titleKey: titleKey,
                titleFallback: titleFallback,
                onViewAll: onViewAll
            )
            if rows.isEmpty {
                VehicleRecentActivityPanelEmpty(messageKey: emptyKey, messageFallback: emptyFallback)
            } else {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(rows) { row in
                        VehicleRecentActivityRowView(row: row, onSelect: onSelect)
                    }
                }
                .accessibilityElement(children: .contain)
            }
        }
    }
}

/// One activity row: the kind-tinted IconBox + the value/timestamp + the duration/SoC, wrapped in a
/// button so the whole row deep-links (web row `<Link>`). The row is a single VoiceOver element.
struct VehicleRecentActivityRowView: View {
    let row: VehicleRecentActivityRow
    let onSelect: (String) -> Void

    private var tint: Color {
        VehicleRecentActivityPalette.kindTint(row.kind)
    }

    var body: some View {
        Button {
            onSelect(row.routeID)
        } label: {
            HStack(spacing: TSSpacing.md) {
                VehicleRecentActivityIconBox(systemImage: VehicleRecentActivityPalette.kindIcon(row.kind), tint: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: row.value)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: row.timeText)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                trailing
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VehicleRecentActivityAccessibility.rowLabel(row)))
        .accessibilityAddTraits(.isButton)
    }

    /// The right column: the duration metric (web `InlineMetric` clock + value) over the optional
    /// SoC transition (web `start% → end%`).
    private var trailing: some View {
        VStack(alignment: .trailing, spacing: 2) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock")
                    .font(.system(size: 10, weight: .regular))
                    .accessibilityHidden(true)
                Text(verbatim: row.durationText)
                    .monospacedDigit()
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
            if let socRange = row.socRange {
                Text(verbatim: socRange)
                    .font(Font.TS.label)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .fixedSize()
    }
}

/// The empty activity panel (web centered muted "No drives recorded yet" / "No charging sessions
/// recorded yet"). Never a blank box.
struct VehicleRecentActivityPanelEmpty: View {
    let messageKey: String
    let messageFallback: String

    var body: some View {
        VehicleRecentActivityStrings.text(messageKey, messageFallback)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 96)
            .accessibilityElement(children: .combine)
    }
}

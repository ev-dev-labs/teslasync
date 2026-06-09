//
//  HealthProbesSection.Views.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  Presentational chrome composed by `HealthProbesSection`: the collapsible accordion
//  shell (web `<AccordionSection>` — HeartPulse icon box + title + subtitle + trailing
//  badges + chevron), the Live / Ready dot badges + the per-card status badge (web
//  `<Badge variant size dot>` / `<Badge variant size>`), and the stale / offline
//  freshness chip + connectivity banner (the P4 live-state contract). All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here. The two probe cards live in
//  `.Sections`; the loading / empty / error states in `.States`.
//

import SwiftUI

// MARK: - Status palette (web `statusToBadgeVariant` → adaptive semantic tokens)

/// The status-tone → color mapping. The web uses badge variant classes; native uses
/// the adaptive semantic tokens so light / dark / high-contrast all resolve.
enum HealthProbesPalette {
    static func color(for tone: HealthProbeTone) -> Color {
        switch tone {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Accordion shell (web `<AccordionSection defaultOpen>`)

/// The collapsible panel shell — the native parity of the web `AccordionSection`: a
/// header row (accent HeartPulse `IconBox`, the title + description, the trailing
/// badges, a chevron that rotates on expand) over a divider-separated body. The
/// header is a single button (web `role="button"` + `aria-expanded`); the chevron +
/// reveal honor Reduce Motion. `defaultOpen` mirrors the web prop.
struct HealthProbesAccordion<Trailing: View, Content: View>: View {
    let systemImage: String
    let titleKey: String
    let titleFallback: String
    let descriptionKey: String
    let descriptionFallback: String
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    @State private var expanded: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(
        systemImage: String,
        titleKey: String,
        titleFallback: String,
        descriptionKey: String,
        descriptionFallback: String,
        defaultOpen: Bool = false,
        @ViewBuilder trailing: @escaping () -> Trailing,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.systemImage = systemImage
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        _expanded = State(initialValue: defaultOpen)
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if expanded {
                Divider().overlay(Color.TS.border)
                content()
                    .padding(TSSpacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(reduceMotion ? .identity : .opacity)
            }
        }
        .tsGlassPanel()
    }

    private var header: some View {
        Button { toggle() } label: {
            headerLabel
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityHeaderLabel))
        .accessibilityValue(Text(verbatim: expanded
                ? HealthProbesStrings.string("Expanded", "Expanded")
                : HealthProbesStrings.string("Collapsed", "Collapsed")))
        .accessibilityHint(Text(verbatim: HealthProbesStrings.string(
            "Toggle Section",
            "Double tap to expand or collapse"
        )))
        .accessibilityAddTraits(.isButton)
    }

    private var headerLabel: some View {
        HStack(spacing: TSSpacing.md) {
            TSIconBox(systemName: systemImage, tone: .accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: HealthProbesStrings.string(titleKey, titleFallback))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: HealthProbesStrings.string(descriptionKey, descriptionFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
            }
            Spacer(minLength: TSSpacing.sm)
            trailing()
            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .rotationEffect(.degrees(expanded ? 180 : 0))
        }
        .padding(TSSpacing.lg)
        .contentShape(Rectangle())
    }

    private func toggle() {
        if reduceMotion {
            expanded.toggle()
        } else {
            withAnimation(.easeInOut(duration: TSMotion.normalDuration)) { expanded.toggle() }
        }
    }

    private var accessibilityHeaderLabel: String {
        let title = HealthProbesStrings.string(titleKey, titleFallback)
        let description = HealthProbesStrings.string(descriptionKey, descriptionFallback)
        return "\(title). \(description)"
    }
}

// MARK: - Header badge (web `<Badge variant size dot>{t('Live')}</Badge>`)

/// One header probe badge — the native parity of the web `<Badge variant size dot>`: a
/// tone-tinted dot + the localized label (Live / Ready) on a tinted capsule.
struct HealthProbeHeaderBadge: View {
    let badge: HealthProbeBadge

    var body: some View {
        let color = HealthProbesPalette.color(for: badge.tone)
        let label = HealthProbesStrings.string(badge.labelKey, badge.labelKey)
        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Status badge (web `<Badge variant size>{status}</Badge>`)

/// A probe status badge — the native parity of the web `<Badge variant size>` in the
/// card header: the raw status value rendered verbatim, tinted by tone. Hidden from
/// VoiceOver because the card's combined label already includes the status.
struct HealthProbeStatusBadge: View {
    let status: String
    let tone: HealthProbeTone

    var body: some View {
        let color = HealthProbesPalette.color(for: tone)
        return Text(verbatim: status)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(color)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// A small live-state chip shown next to the badges when the bound source is not live
/// (ADR-013). The web accordion has no freshness concept; this is the prompt's "stale
/// chip" / "offline chip", invisible while live so the normal header matches the web.
struct HealthProbesFreshnessChip: View {
    let connection: HealthProbesConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
        let symbol: String
    }

    var body: some View {
        if let descriptor = Self.descriptor(for: connection) {
            HStack(spacing: 4) {
                Image(systemName: descriptor.symbol)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(descriptor.tone)
                Text(verbatim: HealthProbesStrings.string(descriptor.key, descriptor.fallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: HealthProbesStrings.string(descriptor.key, descriptor.fallback)))
        }
    }

    private static func descriptor(for connection: HealthProbesConnection) -> Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(
                tone: Color.TS.statusWarning,
                key: "Stale",
                fallback: "Stale",
                symbol: "clock.arrow.circlepath"
            )
        case .offline:
            Descriptor(
                tone: Color.TS.textMuted,
                key: "Offline",
                fallback: "Offline",
                symbol: "wifi.slash"
            )
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not
/// live, so a cached health snapshot is clearly labeled.
struct HealthProbesConnectivityBanner: View {
    let connection: HealthProbesConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "Offline Banner" : "Stale Banner"
        let fallback = offline
            ? "Offline — showing last known health probes"
            : "Reconnecting — health probes may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: HealthProbesStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

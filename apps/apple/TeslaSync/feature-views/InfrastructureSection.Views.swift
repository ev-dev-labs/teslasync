//
//  InfrastructureSection.Views.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  Presentational chrome composed by `InfrastructureSection`: the collapsible
//  accordion shell (web `<AccordionSection>` — Globe icon box + title + subtitle +
//  trailing connection badge + chevron), the Connected/Disconnected + Active/Standby
//  badges (web `<Badge>`), the card header (web `<CardHeader title action>`), the
//  key/value row (web `<KVList>` item), the database-pool metric tile (web
//  `<InlineMetric>`), and the stale / offline freshness chip + connectivity banner
//  (the P4 live-state contract). All copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9). No networking and no Tailwind ports live here. The
//  two content cards live in `.Sections`; the loading / empty / error states in
//  `.States`.
//

import SwiftUI

// MARK: - Accordion shell (web `<AccordionSection>`)

/// The collapsible panel shell — the native parity of the web `AccordionSection`: a
/// header row (cyan Globe `IconBox`, the title + description, the trailing connection
/// badge, a chevron that rotates on expand) over a divider-separated body. The header
/// is a single button (web `role="button"` + `aria-expanded`); the chevron + reveal
/// honor Reduce Motion. `defaultOpen` mirrors the web prop.
struct InfrastructureAccordion<Trailing: View, Content: View>: View {
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
        Button {
            if reduceMotion {
                expanded.toggle()
            } else {
                withAnimation(.easeInOut(duration: TSMotion.normalDuration)) { expanded.toggle() }
            }
        } label: {
            HStack(spacing: TSSpacing.md) {
                TSIconBox(systemName: systemImage, tone: .accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: InfrastructureStrings.string(titleKey, titleFallback))
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: InfrastructureStrings.string(descriptionKey, descriptionFallback))
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
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityHeaderLabel))
        .accessibilityValue(Text(verbatim: expanded
                ? InfrastructureStrings.string("Expanded", "Expanded")
                : InfrastructureStrings.string("Collapsed", "Collapsed")))
        .accessibilityHint(Text(verbatim: InfrastructureStrings.string(
            "Toggle Section",
            "Double tap to expand or collapse"
        )))
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityHeaderLabel: String {
        let title = InfrastructureStrings.string(titleKey, titleFallback)
        let description = InfrastructureStrings.string(descriptionKey, descriptionFallback)
        return "\(title). \(description)"
    }
}

// MARK: - State badge (web `<Badge variant size dot>`)

/// A small tinted pill — the native parity of the web `<Badge>`: an optional leading
/// state dot + a localized label, tinted by tone. Used for the header
/// Connected/Disconnected badge (with dot) and the Active/Standby + Connection-State
/// badges (without dot).
struct InfraStateBadge: View {
    let titleKey: String
    let fallback: String
    let tone: TSTone
    var dot: Bool = false

    var body: some View {
        let color = tone.color
        return HStack(spacing: 4) {
            if dot {
                Circle()
                    .fill(color)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            Text(verbatim: InfrastructureStrings.string(titleKey, fallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: InfrastructureStrings.string(titleKey, fallback)))
    }
}

// MARK: - Card header (web `<CardHeader title action>`)

/// A card's header row — a title with a trailing accessory (web `<CardHeader>` with an
/// `action`). The title resolves through the P1/S10 facade and renders verbatim.
struct InfraSectionCardHeader<Action: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var action: () -> Action

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: InfrastructureStrings.string(titleKey, titleFallback))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            action()
        }
    }
}

// MARK: - Key/value row (web `<KVList>` item)

/// One key/value line — the native parity of a web `<KVList>` item: a muted label on
/// the leading edge and the value view on the trailing edge.
struct InfraKVRow<Value: View>: View {
    let labelKey: String
    let labelFallback: String
    @ViewBuilder var value: () -> Value

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: InfrastructureStrings.string(labelKey, labelFallback))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            value()
        }
        .padding(.vertical, 3)
    }
}

/// A plain trailing value for an `InfraKVRow` — a primary-text string, em-dash for an
/// absent value (the projection already substitutes it).
struct InfraKVValue: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.trailing)
            .textSelection(.enabled)
    }
}

// MARK: - Database-pool metric tile (web `<InlineMetric icon value label>`)

/// One database-pool metric — the native parity of the web `<InlineMetric>`: a tinted
/// SF Symbol, the large locale-formatted value, and a muted label underneath.
struct InfraMetricTile: View {
    let stat: InfraPoolStat

    private var tone: Color {
        switch stat.metric.tone {
        case .accent: Color.TS.accent
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        }
    }

    var body: some View {
        let label = InfrastructureStrings.string(stat.metric.labelKey, stat.metric.labelKey)
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: stat.metric.symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: stat.value)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(stat.value)"))
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// A small live-state chip shown next to the connection badge when the bound source is
/// not live (ADR-013). The web accordion has no freshness concept; this is the prompt's
/// "stale chip" / "offline chip", invisible while live so the normal header matches the
/// web.
struct InfraFreshnessChip: View {
    let connection: InfraConnection

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
                Text(verbatim: InfrastructureStrings.string(descriptor.key, descriptor.fallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: InfrastructureStrings.string(descriptor.key, descriptor.fallback)))
        }
    }

    private static func descriptor(for connection: InfraConnection) -> Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "Stale", fallback: "Stale", symbol: "clock.arrow.circlepath")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "Offline", fallback: "Offline", symbol: "wifi.slash")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not
/// live, so a cached infrastructure snapshot is clearly labeled.
struct InfraConnectivityBanner: View {
    let connection: InfraConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "Offline Banner" : "Stale Banner"
        let fallback = offline
            ? "Offline — showing last known infrastructure status"
            : "Reconnecting — infrastructure status may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: InfrastructureStrings.string(key, fallback))
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

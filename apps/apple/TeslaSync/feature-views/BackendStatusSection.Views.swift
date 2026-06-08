//
//  BackendStatusSection.Views.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  Presentational chrome composed by `BackendStatusSection`: the collapsible
//  accordion shell (web `<AccordionSection>` — Server icon box + title + subtitle +
//  trailing health badge + chevron), the "okCount/total healthy" status badge
//  (web `<Badge>`), the per-component status cell (web `getStatusIcon` + colored
//  status text), the section heading helper (web `<h4>`), and the stale / offline
//  freshness chip + connectivity banner (the P4 live-state contract). All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here. The three content sections live in
//  `.Sections`; the loading / empty / error states in `.States`.
//

import SwiftUI

// MARK: - Status palette (web `statusTextClass` → adaptive semantic tokens)

/// The status-tone → color mapping. The web uses `statusTextClass` color classes;
/// native uses the adaptive semantic tokens so light / dark / high-contrast all
/// resolve.
enum BackendStatusPalette {
    static func color(for tone: BackendStatusTone) -> Color {
        switch tone {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Accordion shell (web `<AccordionSection defaultOpen>`)

/// The collapsible panel shell — the native parity of the web `AccordionSection`:
/// a header row (cyan Server `IconBox`, the title + description, the trailing
/// health badge, a chevron that rotates on expand) over a divider-separated body.
/// The header is a single button (web `role="button"` + `aria-expanded`); the
/// chevron + reveal honor Reduce Motion. `defaultOpen` mirrors the web prop.
struct BackendStatusAccordion<Trailing: View, Content: View>: View {
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
                    Text(verbatim: BackendStatusStrings.string(titleKey, titleFallback))
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: BackendStatusStrings.string(descriptionKey, descriptionFallback))
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
                ? BackendStatusStrings.string("Expanded", "Expanded")
                : BackendStatusStrings.string("Collapsed", "Collapsed")))
        .accessibilityHint(Text(verbatim: BackendStatusStrings.string(
            "Toggle Section",
            "Double tap to expand or collapse"
        )))
        .accessibilityAddTraits(.isButton)
    }

    private var accessibilityHeaderLabel: String {
        let title = BackendStatusStrings.string(titleKey, titleFallback)
        let description = BackendStatusStrings.string(descriptionKey, descriptionFallback)
        return "\(title). \(description)"
    }
}

// MARK: - Health badge (web `<Badge variant={…}>{okCount}/{total} healthy</Badge>`)

/// The header "okCount/total healthy" pill — success-toned when every component is
/// healthy, warning otherwise (web `okCount === total ? 'success' : 'warning'`).
/// Copy resolves through the P1/S10 facade and renders verbatim.
struct BackendHealthBadge: View {
    let okCount: Int
    let total: Int

    private var allHealthy: Bool {
        okCount == total
    }

    var body: some View {
        let tone = allHealthy ? Color.TS.statusSuccess : Color.TS.statusWarning
        let healthy = BackendStatusStrings.string("healthy", "healthy")
        return Text(verbatim: "\(okCount)/\(total) \(healthy)")
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: "\(okCount)/\(total) \(healthy)"))
    }
}

// MARK: - Status cell (web `getStatusIcon` + `statusTextClass` text)

/// One component's status cell — the SF Symbol (checkmark / triangle / xmark) +
/// the raw status text, both tinted by tone (web `getStatusIcon(status)` next to
/// `<span className={statusTextClass(status)}>{status}</span>`).
struct BackendStatusBadgeCell: View {
    let status: String
    let tone: BackendStatusTone

    var body: some View {
        let color = BackendStatusPalette.color(for: tone)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: tone.symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(color)
                .accessibilityHidden(true)
            Text(verbatim: status)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(color)
                .lineLimit(1)
        }
    }
}

// MARK: - Section heading (web `<h4 class="text-sm font-semibold">`)

/// A content-section heading — the native parity of the web `<h4>` labels
/// ("Component Health", "Database Connection Pool", "System Runtime").
struct BackendSectionTitle: View {
    let key: String
    let fallback: String

    var body: some View {
        Text(verbatim: BackendStatusStrings.string(key, fallback))
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// A small live-state chip shown next to the health badge when the bound source
/// is not live (ADR-013). The web accordion has no freshness concept; this is the
/// prompt's "stale chip" / "offline chip", invisible while live so the normal
/// header matches the web.
struct BackendStatusFreshnessChip: View {
    let connection: BackendConnection

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
                Text(verbatim: BackendStatusStrings.string(descriptor.key, descriptor.fallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: BackendStatusStrings.string(descriptor.key, descriptor.fallback)))
        }
    }

    private static func descriptor(for connection: BackendConnection) -> Descriptor? {
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
/// live, so a cached backend snapshot is clearly labeled.
struct BackendStatusConnectivityBanner: View {
    let connection: BackendConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "Offline Banner" : "Stale Banner"
        let fallback = offline
            ? "Offline — showing last known backend status"
            : "Reconnecting — backend status may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: BackendStatusStrings.string(key, fallback))
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

//
//  AutopilotSection.Views.swift
//  TeslaSync — P4 feature view · 0165 · AutopilotSection (Apple)
//
//  The presentational chrome for the "Autopilot & Cruise" section: the panel header + freshness chip,
//  the stale / offline connectivity banner, the glass-panel container (web `<GlassPanel>`), the three
//  stat tiles (web `<StatCard>`), and the responsive grid (web `<Grid cols={{ default: 1, sm: 3 }}>`).
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). The load-state
//  chrome lives in AutopilotSection.States.swift.
//

import SwiftUI

// MARK: - Header (web `<h2>Autopilot & Cruise</h2>`)

/// The section header: the web `<h2 class="…text-lg font-semibold">Autopilot & Cruise</h2>` paired with
/// the live-state freshness chip on the trailing edge.
struct AutopilotSectionHeader: View {
    let connection: AutopilotConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "gauge.with.dots.needle.50percent")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            AutopilotSectionStrings.text("dynamics.autopilot", "Autopilot & Cruise")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            AutopilotFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013). The web reads vehicle
/// state on a 5s interval, so a stalled stream is surfaced here rather than shown as current.
struct AutopilotFreshnessChip: View {
    let connection: AutopilotConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AutopilotSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AutopilotSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: AutopilotConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dynamics.autopilot.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dynamics.autopilot.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dynamics.autopilot.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached values
/// are clearly labelled while reconnecting / offline (web `DataFreshness` intent).
struct AutopilotConnectivityBanner: View {
    let connection: AutopilotConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dynamics.autopilot.offlineBanner" : "dynamics.autopilot.staleBanner"
        let fallback = offline
            ? "Offline — showing the last received cruise telemetry"
            : "Reconnecting — cruise telemetry may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AutopilotSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Glass panel container (web `<GlassPanel className="p-6">`)

/// The web `GlassPanel` surface the whole section renders inside: the semantic surface fill clipped to
/// the panel radius with the glass-border stroke.
struct AutopilotGlassPanel<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Stat tile (web `<StatCard>`)

/// One stat tile (web `<StatCard icon label value unit />`): the label with a trailing glyph, then the
/// prominent value paired with its optional unit caption (the two speed tiles carry the speed unit;
/// Follow Distance carries none). The value renders verbatim — a localized number, a peeled enum
/// suffix, or the em-dash sentinel. The whole tile is a single VoiceOver element.
struct AutopilotStatTile: View {
    let stat: AutopilotStat

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Text(verbatim: stat.label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.xs)
                Image(systemName: Self.systemImage(for: stat.kind))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Text(verbatim: stat.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = stat.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: stat.accessibilityLabel))
    }

    /// The SF Symbol for each tile, mapped from the web lucide glyphs: Current Speed → `Gauge`
    /// (`speedometer`); Cruise Set Speed + Follow Distance → `Navigation` (`location.north.fill`).
    static func systemImage(for kind: AutopilotStatKind) -> String {
        switch kind {
        case .currentSpeed: "speedometer"
        case .cruiseSetSpeed: "location.north.fill"
        case .followDistance: "location.north.fill"
        }
    }
}

// MARK: - Responsive grid (web `<Grid cols={{ default: 1, sm: 3 }} gap={4}>`)

/// The responsive three-tile grid. `.adaptive` columns reproduce the web breakpoints — a single column
/// on a compact width, growing to the full three abreast on a regular/large width.
struct AutopilotStatsGrid: View {
    let stats: [AutopilotStat]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(stats) { stat in
                AutopilotStatTile(stat: stat)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

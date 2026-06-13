//
//  MarkerCluster.Views.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The SwiftUI chrome composed over the MapKit clustering layer by `MarkerCluster`: the cluster-density
//  legend (the native parity of the web `defaultIconCreate` neon palette — the web bubbles are
//  anonymous, so the legend introduces their meaning), the marker-count chip with the "showing N of M"
//  note for the web 5000 cap, the cluster colour-mode switcher (web default palette vs
//  `getClusterColor`), the selected-marker callout (web `popupHtml` / `onMarkerClick`), the P4 leaf
//  connectivity chip + banner with the freshness helper, and the loading / empty / error state overlays
//  (no hidden surface — every state renders over the map, never a blank box). All copy resolves through
//  the P1/S10 facade; chrome colour comes from the P1/S9 tokens, and the cluster swatches from the
//  resolved density palette.
//

import SwiftUI

// MARK: - CSS colour → SwiftUI Color (web `point.color` swatches)

extension Color {
    /// Builds a SwiftUI `Color` from a web CSS colour string via the shared parser, falling back to a
    /// supplied token colour when the string is unrecognised (the native mirror of the web
    /// `point.color ?? defaultColor`).
    init(markerClusterHex hex: String, fallback: Color) {
        guard let rgba = MarkerClusterColor.parse(hex) else {
            self = fallback
            return
        }
        self = Color(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
    }
}

// MARK: - Freshness helper (P4 leaf connectivity axis)

/// Resolves the localised freshness label / a11y note / tone for a connectivity state — shared by the
/// chip and the banner so the copy stays consistent and is asserted in one place.
enum MarkerClusterFreshness {
    static func label(for connection: MarkerClusterConnection) -> String {
        switch connection {
        case .live: MarkerClusterStrings.string("markerCluster.live", "Live")
        case .stale: MarkerClusterStrings.string("markerCluster.stale", "Stale")
        case .offline: MarkerClusterStrings.string("markerCluster.offline", "Offline")
        }
    }

    static func note(for connection: MarkerClusterConnection) -> String {
        switch connection {
        case .live:
            MarkerClusterStrings.string("markerCluster.live", "Live")
        case .stale:
            MarkerClusterStrings.string("markerCluster.staleA11y", "Stale — tap refresh to update")
        case .offline:
            MarkerClusterStrings.string("markerCluster.offlineA11y", "Offline — showing the last known markers")
        }
    }

    static func tone(for connection: MarkerClusterConnection) -> Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Cluster legend (web `defaultIconCreate` palette)

/// The cluster-density legend — the native parity of the web `defaultIconCreate` colour ladder. The
/// web cluster bubbles are anonymous; this legend names each density bucket and shows its colour so the
/// bubble colours are legible. Hidden when the surface colours by category (the dominant-child mode),
/// where bubble colour no longer encodes density.
struct MarkerClusterLegend: View {
    let colorMode: MarkerClusterColorMode

    var body: some View {
        if colorMode == .countDensity {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: MarkerClusterStrings.string("markerCluster.legendTitle", "Cluster size"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                HStack(spacing: TSSpacing.sm) {
                    ForEach(MarkerClusterDensity.allCases) { density in
                        swatch(for: density)
                    }
                }
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string(
                "markerCluster.legendTitle",
                "Cluster size"
            )))
        }
    }

    private func swatch(for density: MarkerClusterDensity) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(Color(markerClusterHex: density.colorHex, fallback: Color.TS.accent)
                    .opacity(MarkerClusterDensity.fillOpacity))
                .frame(width: 10, height: 10)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.7), lineWidth: 1))
            Text(verbatim: MarkerClusterStrings.string(density.labelKey, density.labelFallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string(density.labelKey, density.labelFallback)))
    }
}

// MARK: - Marker-count chip (web 5000 cap → "showing N of M")

/// The marker-count chip — shows how many markers are on the map and, when the web 5000 cap or a NaN
/// guard dropped points, the "showing N of M" note so the truncation is never silent.
struct MarkerClusterCountChip: View {
    let resolved: MarkerClusterResolved

    private var text: String {
        if resolved.isTruncated {
            let template = MarkerClusterStrings.string("markerCluster.countTruncated", "Showing %@ of %@")
            return String(
                format: template,
                resolved.renderedCount.formatted(),
                resolved.totalCount.formatted()
            )
        }
        let template = MarkerClusterStrings.string("markerCluster.count", "%@ markers")
        return String(format: template, resolved.renderedCount.formatted())
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: text)
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Colour-mode switcher (web default palette vs `getClusterColor`)

/// The cluster colour-mode switcher — the native expression of the web component's two cluster
/// colouring paths (the `defaultIconCreate` density palette vs the `getClusterColor` dominant-child
/// colour). A `Menu` keeps the control compact in the map corner on both platforms.
struct MarkerClusterColorModeSwitcher: View {
    let colorMode: MarkerClusterColorMode
    let onSelect: (MarkerClusterColorMode) -> Void

    var body: some View {
        Menu {
            ForEach(MarkerClusterColorMode.allCases) { mode in
                Button {
                    onSelect(mode)
                } label: {
                    Label(
                        MarkerClusterStrings.string(mode.labelKey, mode.labelFallback),
                        systemImage: mode.systemImage
                    )
                }
            }
        } label: {
            Image(systemName: colorMode.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 28, height: 28)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string(
            "markerCluster.colorModeSwitcher",
            "Cluster colour"
        )))
        .accessibilityValue(Text(verbatim: MarkerClusterStrings.string(colorMode.labelKey, colorMode.labelFallback)))
    }
}

// MARK: - Selected-marker callout (web `popupHtml` / `onMarkerClick`)

/// The selected-marker callout — the native parity of the web marker popup (`bindPopup(popupHtml)`)
/// shown after a tap (`onMarkerClick`). Renders the marker's accessible name, its popup text (markup
/// stripped at the display boundary), and its coordinate, with a dismiss affordance.
struct MarkerClusterCallout: View {
    let point: MarkerClusterPoint
    let onDismiss: () -> Void

    private var title: String {
        point.accessibilityLabel ?? MarkerClusterStrings.string("markerCluster.markerA11y", "Map marker")
    }

    private var detail: String? {
        MarkerClusterLogic.plainText(point.popupHTML)
    }

    private var coordinate: String {
        String(format: "%.4f, %.4f", point.latitude, point.longitude)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string("action.dismiss", "Dismiss")))
            }
            if let detail {
                Text(verbatim: detail)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(verbatim: coordinate)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(detail ?? coordinate)"))
    }
}

// MARK: - Connectivity chip (P4 leaf — corner status)

/// The freshness chip + manual refresh affordance — a coloured dot with the freshness label and a
/// refresh button so pointer + VoiceOver users can recover a stale / offline feed. Rendered for every
/// state (live included) so the corner has a stable shape.
struct MarkerClusterConnectivityChip: View {
    let connection: MarkerClusterConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(MarkerClusterFreshness.tone(for: connection))
                .frame(width: 6, height: 6)
            Text(verbatim: MarkerClusterFreshness.label(for: connection))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: MarkerClusterStrings.string("markerCluster.refresh", "Refresh")))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: MarkerClusterFreshness.note(for: connection)))
    }
}

// MARK: - Connectivity banner (P4 leaf — stale / offline)

/// The stale / offline banner shown over the top edge of the map when the feed is not live — a tinted
/// inline callout explaining why the markers may be older. Hidden entirely when live.
struct MarkerClusterConnectivityBanner: View {
    let connection: MarkerClusterConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? MarkerClusterStrings.string("markerCluster.offlineBanner", "Offline — showing last known markers")
            : MarkerClusterStrings.string("markerCluster.staleBanner", "Reconnecting — markers may be stale")
    }

    var body: some View {
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

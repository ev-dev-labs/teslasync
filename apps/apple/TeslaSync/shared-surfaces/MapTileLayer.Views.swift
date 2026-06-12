//
//  MapTileLayer.Views.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The SwiftUI chrome composed over the MapKit base layer by `MapTileLayer`: the attribution chip
//  (the native parity of leaflet's attribution control — required by every tile provider's terms),
//  the fullscreen control (web `MapFullscreenControl` → `FullscreenButton`), the base-map style
//  switcher (web `MapLayerSwitcher`, since the active style drives `tiles[style]`), the P4 leaf
//  connectivity chip + banner with the freshness helper, and the loading / empty / error state
//  overlays (no hidden surface — every state renders over the map, never a blank box). All copy
//  resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Corner alignment (web `MapFullscreenControl.position`)

extension MapTileLayerCorner {
    /// The SwiftUI overlay alignment for this corner (web `POSITION_CLASS`).
    var alignment: Alignment {
        switch self {
        case .topleft: .topLeading
        case .topright: .topTrailing
        case .bottomleft: .bottomLeading
        case .bottomright: .bottomTrailing
        }
    }
}

// MARK: - Freshness helper (P4 leaf connectivity axis)

/// Resolves the localised freshness label / a11y note / tone for a connectivity state — shared by
/// the chip and the banner so the copy stays consistent and is asserted in one place.
enum MapTileLayerFreshness {
    static func label(for connection: MapTileLayerConnection) -> String {
        switch connection {
        case .live: MapTileLayerStrings.string("mapTileLayer.live", "Live")
        case .stale: MapTileLayerStrings.string("mapTileLayer.stale", "Stale")
        case .offline: MapTileLayerStrings.string("mapTileLayer.offline", "Offline")
        }
    }

    static func note(for connection: MapTileLayerConnection) -> String {
        switch connection {
        case .live:
            MapTileLayerStrings.string("mapTileLayer.live", "Live")
        case .stale:
            MapTileLayerStrings.string("mapTileLayer.staleA11y", "Stale — tap refresh to update")
        case .offline:
            MapTileLayerStrings.string("mapTileLayer.offlineA11y", "Offline — showing the last known map")
        }
    }

    static func tone(for connection: MapTileLayerConnection) -> Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Attribution chip (web leaflet attribution control)

/// The map attribution credit — the native parity of leaflet's attribution control. Shows the
/// provider's required plain-text credit (the HTML markup is stripped at the display boundary) so
/// the tile-provider terms are honoured. Rendered for every provider.
struct MapTileLayerAttributionChip: View {
    let attribution: String

    var body: some View {
        Text(verbatim: attribution)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: MapTileLayerStrings.string(
                "mapTileLayer.attributionA11y",
                "Map data"
            ) + ": " + attribution))
    }
}

// MARK: - Fullscreen control (web `MapFullscreenControl` / `FullscreenButton`)

/// The corner fullscreen toggle — the native port of the web `MapFullscreenControl`, which portals a
/// `FullscreenButton` into the map corner. Flips the surface's expanded binding; the surface presents
/// the enlarged map. The accessible label tracks the current state (web `aria-label` flip) and honours
/// the `ariaLabelEnter` / `ariaLabelExit` overrides.
struct MapTileLayerFullscreenButton: View {
    @Binding var expanded: Bool
    let enterLabel: String
    let exitLabel: String

    var body: some View {
        Button {
            expanded.toggle()
        } label: {
            Image(systemName: expanded
                ? "arrow.down.right.and.arrow.up.left"
                : "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textPrimary)
                .frame(width: 28, height: 28)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: expanded ? exitLabel : enterLabel))
        .accessibilityAddTraits(expanded ? .isSelected : [])
    }
}

// MARK: - Style switcher (web `MapLayerSwitcher`)

/// The base-map style switcher — the native parity of the web `MapLayerSwitcher`. Switching the
/// style re-resolves `tiles[style]`, swapping the live tile overlay. A `Menu` keeps the control
/// compact in the map corner on both platforms.
struct MapTileLayerStyleSwitcher: View {
    let style: MapTileLayerStyle
    let onSelect: (MapTileLayerStyle) -> Void

    var body: some View {
        Menu {
            ForEach(MapTileLayerStyle.allCases) { option in
                Button {
                    onSelect(option)
                } label: {
                    Label(
                        MapTileLayerStrings.string(option.labelKey, option.labelFallback),
                        systemImage: option.systemImage
                    )
                }
            }
        } label: {
            Image(systemName: style.systemImage)
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
        .accessibilityLabel(Text(verbatim: MapTileLayerStrings.string("mapTileLayer.styleSwitcher", "Map style")))
        .accessibilityValue(Text(verbatim: MapTileLayerStrings.string(style.labelKey, style.labelFallback)))
    }
}

// MARK: - Connectivity chip (P4 leaf — corner status)

/// The freshness chip + manual refresh affordance — a coloured dot with the freshness label and a
/// refresh button so pointer + VoiceOver users can recover a stale / offline map. Rendered for every
/// state (live included) so the corner has a stable shape.
struct MapTileLayerConnectivityChip: View {
    let connection: MapTileLayerConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(MapTileLayerFreshness.tone(for: connection))
                .frame(width: 6, height: 6)
            Text(verbatim: MapTileLayerFreshness.label(for: connection))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: MapTileLayerStrings.string("mapTileLayer.refresh", "Refresh")))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: MapTileLayerFreshness.note(for: connection)))
    }
}

// MARK: - Connectivity banner (P4 leaf — stale / offline)

/// The stale / offline banner shown over the top edge of the map when the config is not live — a
/// tinted inline callout explaining why the map may show older tiles. Hidden entirely when live.
struct MapTileLayerConnectivityBanner: View {
    let connection: MapTileLayerConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? MapTileLayerStrings.string("mapTileLayer.offlineBanner", "Offline — showing last known map")
            : MapTileLayerStrings.string("mapTileLayer.staleBanner", "Reconnecting — map may be stale")
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

// MARK: - State overlays (loading / empty / error — never a blank box)

/// The centred loading overlay shown over the map while the config query is in flight with no cached
/// tiles yet (web renders `freeTiles` immediately; the scrim signals the pending swap).
struct MapTileLayerLoadingOverlay: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView()
            Text(verbatim: MapTileLayerStrings.string("mapTileLayer.loading", "Loading map…"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: MapTileLayerStrings.string("mapTileLayer.loading", "Loading map…")))
    }
}

/// The empty-state overlay shown when no tile source can be resolved (a defensive branch — the free
/// fallback always tiles). A friendly message, never a blank box.
struct MapTileLayerEmptyOverlay: View {
    var body: some View {
        MapTileLayerMessageOverlay(
            systemImage: "map",
            tone: Color.TS.textMuted,
            title: MapTileLayerStrings.string("mapTileLayer.empty", "Map unavailable"),
            detail: MapTileLayerStrings.string("mapTileLayer.emptyDetail", "No map tiles are available right now.")
        )
    }
}

/// The error overlay shown when the config query fails — an icon, a message, and a Retry affordance.
/// The map keeps the free-fallback tiles beneath (web behaviour), so this is an inline recovery card.
struct MapTileLayerErrorOverlay: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            MapTileLayerMessageOverlay(
                systemImage: "exclamationmark.triangle",
                tone: Color.TS.statusDanger,
                title: MapTileLayerStrings.string("mapTileLayer.error", "Couldn't load map settings"),
                detail: MapTileLayerStrings.string("mapTileLayer.errorDetail", "Showing the default map.")
            )
            Button(action: onRetry) {
                Text(verbatim: MapTileLayerStrings.string("action.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: MapTileLayerStrings.string("action.retry", "Retry")))
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// A shared icon + title + detail card used by the empty / error overlays.
struct MapTileLayerMessageOverlay: View {
    let systemImage: String
    let tone: Color
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: detail)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(detail)"))
    }
}

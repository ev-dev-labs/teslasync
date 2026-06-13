//
//  AnimatedMarker.Views.swift
//  TeslaSync — P4 shared surface · 0184 · AnimatedMarker (Apple)
//
//  The SwiftUI chrome composed over the MapKit host by `AnimatedMarker`: the pulsing heading-aware
//  marker glyph (the native parity of the web CSS pulse circle + heading-rotated inner dot — the web
//  `createCarIcon` `DivIcon`), the P4 leaf connectivity chip + banner with the freshness helper, the
//  marker info chip (the marker's coordinates + heading, surfaced for legibility + VoiceOver), and the
//  loading / empty / error state overlays (no hidden surface — every state renders over the map, never
//  a blank box). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens
//  except the marker's own data-driven colour (the web `color` prop).
//

import Foundation
import SwiftUI

// MARK: - Colour boundary (web `color` prop → SwiftUI)

extension AnimatedMarkerColorComponents {
    /// The SwiftUI colour for the parsed marker components (the data-driven web `color` prop).
    var color: Color {
        Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

// MARK: - Formatting + accessibility copy

/// Formats the marker's coordinates + heading for the info chip and the VoiceOver summary — the
/// native parity of the web consumers' `lat.toFixed(4)` / `Math.round(heading)°`.
enum AnimatedMarkerFormat {
    static func coordinates(_ coordinate: AnimatedMarkerCoordinate) -> String {
        let lat = String(format: "%.4f", coordinate.latitude)
        let lon = String(format: "%.4f", coordinate.longitude)
        return "\(lat), \(lon)"
    }

    static func heading(_ degrees: Double) -> String {
        "\(Int(degrees.rounded()))°"
    }
}

/// Resolves the surface's VoiceOver summary — the marker position + heading, suffixed with the
/// freshness note off-live, or the active load-state message. One place so the copy stays consistent.
enum AnimatedMarkerAccessibility {
    static func value(for resolved: AnimatedMarkerResolved) -> String {
        switch resolved.status {
        case .loading:
            return AnimatedMarkerStrings.string("animatedMarker.loading", "Locating…")
        case .empty:
            return AnimatedMarkerStrings.string("animatedMarker.empty", "No location")
        case .error:
            return AnimatedMarkerStrings.string("animatedMarker.error", "Couldn't load position")
        case .ready:
            break
        }
        guard let fix = resolved.fix else {
            return AnimatedMarkerStrings.string("animatedMarker.empty", "No location")
        }
        var parts = [AnimatedMarkerFormat.coordinates(fix.coordinate)]
        if let heading = fix.heading {
            let label = AnimatedMarkerStrings.string("animatedMarker.heading", "Heading")
            parts.append("\(label) \(AnimatedMarkerFormat.heading(heading))")
        }
        if !resolved.isLive {
            parts.append(AnimatedMarkerFreshness.note(for: resolved.connection))
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Marker glyph (web `createCarIcon` DivIcon)

/// The pulsing live-position marker — the native parity of the web `createCarIcon`: a soft pulsing
/// halo (the web `replay-pulse` 1.5s circle), a glowing solid dot with a white ring (the web inner
/// circle with `box-shadow`), and a directional arrow rotated to the heading (the web inner
/// `transform:rotate(${heading}deg)`, rendered here as the visible arrow the icon's doc comment
/// describes). The pulse honours Reduce Motion; the colour is the data-driven web `color` prop.
struct AnimatedMarkerGlyph: View {
    let color: Color
    let heading: Double?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.3))
                .frame(width: 36, height: 36)
                .scaleEffect(pulse && !reduceMotion ? 1.6 : 1)
                .opacity(pulse && !reduceMotion ? 0 : 0.6)
            Circle()
                .fill(color)
                .frame(width: 16, height: 16)
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                .shadow(color: color.opacity(0.8), radius: 4)
            if let heading {
                Image(systemName: "location.north.fill")
                    .font(.system(size: 8, weight: .heavy))
                    .foregroundStyle(.white)
                    .rotationEffect(.degrees(heading))
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.5).repeatForever(autoreverses: false)) {
                pulse = true
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness helper (P4 leaf connectivity axis)

/// Resolves the localised freshness label / a11y note / tone for a connectivity state — shared by the
/// chip and the banner so the copy stays consistent and is asserted in one place.
enum AnimatedMarkerFreshness {
    static func label(for connection: AnimatedMarkerConnection) -> String {
        switch connection {
        case .live: AnimatedMarkerStrings.string("animatedMarker.live", "Live")
        case .stale: AnimatedMarkerStrings.string("animatedMarker.stale", "Stale")
        case .offline: AnimatedMarkerStrings.string("animatedMarker.offline", "Offline")
        }
    }

    static func note(for connection: AnimatedMarkerConnection) -> String {
        switch connection {
        case .live:
            AnimatedMarkerStrings.string("animatedMarker.live", "Live")
        case .stale:
            AnimatedMarkerStrings.string("animatedMarker.staleA11y", "Stale — tap refresh to update")
        case .offline:
            AnimatedMarkerStrings.string("animatedMarker.offlineA11y", "Offline — showing the last known position")
        }
    }

    static func tone(for connection: AnimatedMarkerConnection) -> Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Connectivity chip (P4 leaf — corner status)

/// The freshness chip + manual refresh affordance — a coloured dot with the freshness label and a
/// refresh button so pointer + VoiceOver users can recover a stale / offline marker. Rendered for
/// every state (live included) so the corner has a stable shape.
struct AnimatedMarkerConnectivityChip: View {
    let connection: AnimatedMarkerConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(AnimatedMarkerFreshness.tone(for: connection))
                .frame(width: 6, height: 6)
            Text(verbatim: AnimatedMarkerFreshness.label(for: connection))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: AnimatedMarkerStrings.string("animatedMarker.refresh", "Refresh")))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AnimatedMarkerFreshness.note(for: connection)))
    }
}

// MARK: - Marker info chip (the marker's coordinates + heading)

/// The marker's coordinates + optional heading — the native legible surfacing of the marker data the
/// web consumers print in their overlay chips. Gives the ready state visible, VoiceOver-readable
/// content beyond the map glyph.
struct AnimatedMarkerInfoChip: View {
    let fix: AnimatedMarkerFix

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "mappin")
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: AnimatedMarkerFormat.coordinates(fix.coordinate))
                .font(Font.TS.caption)
            if let heading = fix.heading {
                Image(systemName: "location.north.fill")
                    .font(.system(size: 8, weight: .heavy))
                    .rotationEffect(.degrees(heading))
                    .accessibilityHidden(true)
                Text(verbatim: AnimatedMarkerFormat.heading(heading))
                    .font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.textSecondary)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: infoLabel))
    }

    private var infoLabel: String {
        let coords = AnimatedMarkerStrings.string("animatedMarker.coordinates", "Coordinates")
        var label = "\(coords): \(AnimatedMarkerFormat.coordinates(fix.coordinate))"
        if let heading = fix.heading {
            let headingLabel = AnimatedMarkerStrings.string("animatedMarker.heading", "Heading")
            label += ", \(headingLabel) \(AnimatedMarkerFormat.heading(heading))"
        }
        return label
    }
}

// MARK: - Connectivity banner (P4 leaf — stale / offline)

/// The stale / offline banner shown over the top edge of the map when the fix is not live — a tinted
/// inline callout explaining why the marker may show an older position. Hidden entirely when live.
struct AnimatedMarkerConnectivityBanner: View {
    let connection: AnimatedMarkerConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? AnimatedMarkerStrings.string("animatedMarker.offlineBanner", "Offline — showing last known position")
            : AnimatedMarkerStrings.string("animatedMarker.staleBanner", "Reconnecting — position may be stale")
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

/// The centred loading overlay shown over the map while the first fix is in flight.
struct AnimatedMarkerLoadingOverlay: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView()
            Text(verbatim: AnimatedMarkerStrings.string("animatedMarker.loading", "Locating…"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AnimatedMarkerStrings.string("animatedMarker.loading", "Locating…")))
    }
}

/// The empty-state overlay shown when the fix resolves with no usable coordinate (web `hasCoords ===
/// false`). A friendly message, never a blank box.
struct AnimatedMarkerEmptyOverlay: View {
    var body: some View {
        AnimatedMarkerMessageOverlay(
            systemImage: "mappin.slash",
            tone: Color.TS.textMuted,
            title: AnimatedMarkerStrings.string("animatedMarker.empty", "No location"),
            detail: AnimatedMarkerStrings.string(
                "animatedMarker.emptyDetail",
                "No position is available to show on the map yet."
            )
        )
    }
}

/// The error overlay shown when the position query fails — an icon, a message, and a Retry affordance.
/// The cached marker keeps rendering beneath (web keeps the last marker on a failed refetch).
struct AnimatedMarkerErrorOverlay: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            AnimatedMarkerMessageOverlay(
                systemImage: "exclamationmark.triangle",
                tone: Color.TS.statusDanger,
                title: AnimatedMarkerStrings.string("animatedMarker.error", "Couldn't load position"),
                detail: AnimatedMarkerStrings.string(
                    "animatedMarker.errorDetail",
                    "We couldn't update the position. Showing the last known location."
                )
            )
            Button(action: onRetry) {
                Text(verbatim: AnimatedMarkerStrings.string("action.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: AnimatedMarkerStrings.string("action.retry", "Retry")))
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
struct AnimatedMarkerMessageOverlay: View {
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

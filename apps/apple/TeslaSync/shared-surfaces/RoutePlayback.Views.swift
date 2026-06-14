//
//  RoutePlayback.Views.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The SwiftUI chrome composed over the MapKit host by `RoutePlayback`: the heading-aware pulsing
//  playhead glyph (the native parity of the web `AnimatedMarker` `DivIcon` tracking `currentIndex`), the
//  inline metric chip (web top-right `currentIndex/total` + speed + SOC overlay), the P4 leaf
//  connectivity chip + banner, and the loading / error state surfaces (no hidden surface — every state
//  renders, never a blank box). All copy resolves through the P1/S10 facade; all colour comes from the
//  P1/S9 tokens except the trail / marker's own data-driven colour (the web `trailColor` / `markerColor`
//  props), which fall back to a semantic token when the host passes none.
//

import Foundation
import SwiftUI

// MARK: - Colour boundary (web `trailColor` / `markerColor` props → SwiftUI)

extension RoutePlaybackColorComponents {
    /// The SwiftUI colour for the parsed components (the data-driven web colour props).
    var color: Color {
        Color(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

/// Resolves the trail / marker / anchor tints — the data-driven web hex props when supplied, else a
/// semantic theme token so the surface stays light/dark-correct (the toned parity of the web defaults).
enum RoutePlaybackTint {
    static func trail(_ content: RoutePlaybackContent) -> Color {
        RoutePlaybackPalette.parse(content.trailColorHex)?.color ?? Color.TS.accent
    }

    static func marker(_ content: RoutePlaybackContent) -> Color {
        RoutePlaybackPalette.parse(content.markerColorHex)?.color ?? Color.TS.accent
    }

    /// The start anchor tint (web `#10b981`) → success token.
    static let start = Color.TS.statusSuccess
    /// The end anchor tint (web `#ef4444`) → danger token.
    static let end = Color.TS.statusDanger
}

// MARK: - Formatting + accessibility copy

/// Formats the playhead metrics for the inline chip + the VoiceOver summary — the native parity of the
/// web `fmtNumber(cp.speed, 1)` / `fmtNumber(cp.soc, 0)` and the `currentIndex + 1 / points.length`
/// counter.
enum RoutePlaybackFormat {
    static func counter(_ frame: RoutePlaybackFrame) -> String {
        "\(frame.displayIndex)/\(frame.count)"
    }

    static func speed(_ value: Double) -> String {
        String(format: "%.1f", value)
    }

    static func soc(_ value: Double) -> String {
        "\(Int(value.rounded()))"
    }

    static func coordinates(_ coordinate: RoutePlaybackCoordinate) -> String {
        let lat = String(format: "%.4f", coordinate.latitude)
        let lon = String(format: "%.4f", coordinate.longitude)
        return "\(lat), \(lon)"
    }
}

/// Resolves the surface's VoiceOver summary for the map — the sample position + the active metrics,
/// suffixed with the freshness note when the route is not live. One place so the copy stays consistent.
enum RoutePlaybackAccessibility {
    static func mapValue(frame: RoutePlaybackFrame, connection: RoutePlaybackConnection) -> String {
        var parts: [String] = []
        if frame.displayIndex > 0 {
            let template = RoutePlaybackStrings.string("routePlayback.sampleOfCount", "Sample %1$d of %2$d")
            parts.append(String(format: template, frame.displayIndex, frame.count))
        }
        if let point = frame.currentPoint {
            if let speed = point.speed {
                let unit = RoutePlaybackStrings.string("routePlayback.speedUnit", "km/h")
                parts.append("\(RoutePlaybackFormat.speed(speed)) \(unit)")
            }
            if let soc = point.soc {
                parts.append("\(RoutePlaybackFormat.soc(soc))%")
            }
        }
        if !connection.isLive {
            parts.append(RoutePlaybackFreshness.note(for: connection))
        }
        if parts.isEmpty {
            return RoutePlaybackStrings.string("maps.routePlayback.mapLabel", "Route playback map")
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Playhead glyph (web `AnimatedMarker` DivIcon)

/// The pulsing heading-aware playhead — the native parity of the web `AnimatedMarker`: a soft pulsing
/// halo, a glowing solid dot with a white ring, and a directional arrow rotated to the heading. The
/// pulse + rotation honour Reduce Motion; the colour is the data-driven web `markerColor` prop.
struct RoutePlaybackPlayheadGlyph: View {
    let color: Color
    let heading: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.3))
                .frame(width: 36, height: 36)
                .scaleEffect(pulse && !reduceMotion ? 1.6 : 1)
                .opacity(pulse && !reduceMotion ? 0 : 0.6)
            Image(systemName: "location.north.fill")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .rotationEffect(.degrees(heading))
                .padding(6)
                .background(color, in: Circle())
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                .shadow(color: color.opacity(0.8), radius: 4)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: heading)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.5).repeatForever(autoreverses: false)) {
                pulse = true
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Inline metric chip (web top-right overlay)

/// The inline playhead metric chip — the sample counter, the optional speed, and the optional SOC, the
/// native parity of the web top-right overlay (`currentIndex/total`, `… km/h`, `…%`). Rendered for the
/// ready state; VoiceOver reads the combined summary.
struct RoutePlaybackMetricChip: View {
    let frame: RoutePlaybackFrame

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "flag.checkered")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: RoutePlaybackFormat.counter(frame))
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            if let speed = frame.currentPoint?.speed {
                Text(verbatim: "\(RoutePlaybackFormat.speed(speed)) \(speedUnit)")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
            if let soc = frame.currentPoint?.soc {
                Text(verbatim: "\(RoutePlaybackFormat.soc(soc))%")
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.statusSuccess)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: chipLabel))
    }

    private var speedUnit: String {
        RoutePlaybackStrings.string("routePlayback.speedUnit", "km/h")
    }

    private var chipLabel: String {
        var label = RoutePlaybackFormat.counter(frame)
        if let speed = frame.currentPoint?.speed {
            label += ", \(RoutePlaybackFormat.speed(speed)) \(speedUnit)"
        }
        if let soc = frame.currentPoint?.soc {
            label += ", \(RoutePlaybackFormat.soc(soc))%"
        }
        return label
    }
}

// MARK: - Freshness helper (P4 leaf connectivity axis)

/// Resolves the localised freshness label / a11y note / tone for a connectivity state — shared by the
/// chip and the banner so the copy stays consistent and is asserted in one place.
enum RoutePlaybackFreshness {
    static func label(for connection: RoutePlaybackConnection) -> String {
        switch connection {
        case .live: RoutePlaybackStrings.string("routePlayback.live", "Live")
        case .stale: RoutePlaybackStrings.string("routePlayback.stale", "Stale")
        case .offline: RoutePlaybackStrings.string("routePlayback.offline", "Offline")
        }
    }

    static func note(for connection: RoutePlaybackConnection) -> String {
        switch connection {
        case .live:
            RoutePlaybackStrings.string("routePlayback.live", "Live")
        case .stale:
            RoutePlaybackStrings.string("routePlayback.staleA11y", "Stale — tap refresh to update")
        case .offline:
            RoutePlaybackStrings.string("routePlayback.offlineA11y", "Offline — showing the last loaded route")
        }
    }

    static func tone(for connection: RoutePlaybackConnection) -> Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Connectivity chip (P4 leaf — corner status)

/// The freshness chip + manual refresh affordance — a coloured dot with the freshness label and a
/// refresh button so pointer + VoiceOver users can recover a stale / offline route. Rendered for every
/// state so the corner has a stable shape.
struct RoutePlaybackConnectivityChip: View {
    let connection: RoutePlaybackConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(RoutePlaybackFreshness.tone(for: connection))
                .frame(width: 6, height: 6)
            Text(verbatim: RoutePlaybackFreshness.label(for: connection))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: RoutePlaybackStrings.string("routePlayback.refresh", "Refresh")))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: RoutePlaybackFreshness.note(for: connection)))
    }
}

// MARK: - Connectivity banner (P4 leaf — stale / offline)

/// The stale / offline banner shown over the top edge of the map when the route is not live — a tinted
/// inline callout explaining why the trail may be older. Hidden entirely when live.
struct RoutePlaybackConnectivityBanner: View {
    let connection: RoutePlaybackConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? RoutePlaybackStrings.string("routePlayback.offlineBanner", "Offline — showing the last loaded route")
            : RoutePlaybackStrings.string("routePlayback.staleBanner", "Reconnecting — the route may be stale")
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

// MARK: - State surfaces (loading / error — never a blank box)

/// The loading surface shown while the first route is in flight (no cached trail yet) — a centred
/// spinner + label sized to the map's height, so the panel keeps its shape while the route loads.
struct RoutePlaybackLoadingPanel: View {
    let height: CGFloat

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ProgressView()
            Text(verbatim: RoutePlaybackStrings.string("routePlayback.loading", "Loading route…"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: RoutePlaybackStrings.string("routePlayback.loading", "Loading route…")))
    }
}

/// The error overlay shown when the route query fails — an icon, a message, and a Retry affordance. The
/// cached trail keeps rendering beneath (web keeps the last trail on a failed refetch).
struct RoutePlaybackErrorOverlay: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            RoutePlaybackMessageOverlay(
                systemImage: "exclamationmark.triangle",
                tone: Color.TS.statusDanger,
                title: RoutePlaybackStrings.string("routePlayback.error", "Couldn't load the route"),
                detail: RoutePlaybackStrings.string(
                    "routePlayback.errorDetail",
                    "We couldn't update the route. Showing the last loaded trail."
                )
            )
            Button(action: onRetry) {
                Text(verbatim: RoutePlaybackStrings.string("action.retry", "Retry"))
                    .font(Font.TS.label)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: RoutePlaybackStrings.string("action.retry", "Retry")))
        }
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// A shared icon + title + detail card used by the error overlay.
struct RoutePlaybackMessageOverlay: View {
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

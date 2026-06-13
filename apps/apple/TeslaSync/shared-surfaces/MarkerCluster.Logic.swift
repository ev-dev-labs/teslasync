//
//  MarkerCluster.Logic.swift
//  TeslaSync — P4 shared surface · 0186 · MarkerCluster (Apple)
//
//  The pure decision + transform core for the marker-clustering surface — the parts of
//  `components/maps/MarkerCluster.tsx` that are neither networking nor rendering: the localisation
//  seam (web `t(key, default)`), the point sanitation (the web `points.slice(0, 5000)` cap plus the
//  per-point NaN guard in the render loop), the dominant-child colour reduction (the native default
//  for the web `getClusterColor` extension point), and the slippy-zoom helper that lets the MapKit
//  bridge honour the web `disableClusteringAtZoom` threshold. Foundation-only so every branch is
//  asserted without a map or a rendered view.
//

import Foundation

// MARK: - Localisation seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: production passes the
/// P1/S10 facade, tests pass the identity resolver.
public typealias MarkerClusterResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Pure transforms

/// The pure helpers that back the cluster bridge + its chrome. All total + side-effect-free.
public enum MarkerClusterLogic {
    /// Sanitises the raw point list into the markers the map renders — the native mirror of the web
    /// `safePoints = points.slice(0, 5000)` cap followed by the per-point `Number.isNaN` guard in
    /// the marker loop. The cap is applied first (so an over-long list is bounded before validation,
    /// exactly as the web slices first), then non-finite coordinates are dropped.
    public static func sanitize(
        _ points: [MarkerClusterPoint],
        cap: Int = MarkerClusterMeta.maxRenderedMarkers
    ) -> [MarkerClusterPoint] {
        Array(points.prefix(max(0, cap))).filter(\.hasValidCoordinate)
    }

    /// Resolves the colour the default cluster bubble should use when the surface is in its
    /// dominant-child colour mode — the native default for the web `getClusterColor(children)`
    /// extension point. Tallies the children's effective colours (each child's `color ?? default`)
    /// and returns the most common, breaking ties by first appearance so the result is stable. An
    /// empty cluster degrades to `defaultColorHex`.
    public static func dominantColorHex(
        children: [MarkerClusterPoint],
        defaultColorHex: String
    ) -> String {
        guard !children.isEmpty else { return defaultColorHex }
        var order: [String] = []
        var counts: [String: Int] = [:]
        for child in children {
            let colour = child.colorHex ?? defaultColorHex
            if counts[colour] == nil { order.append(colour) }
            counts[colour, default: 0] += 1
        }
        let topCount = counts.values.max() ?? 0
        // First colour (in encounter order) that hits the max tally → deterministic tie-break.
        return order.first { counts[$0] == topCount } ?? defaultColorHex
    }

    /// Approximates the slippy-map zoom level for a MapKit region's longitude span — the inverse of
    /// the web tile pyramid (`zoom = log2(360 / longitudeDelta)`). MapKit exposes a metric region,
    /// not a discrete zoom, so this recovers the leaflet-equivalent zoom used to compare against
    /// `disableClusteringAtZoom`. A non-positive span clamps to the deepest zoom.
    public static func zoomLevel(forLongitudeDelta delta: Double) -> Double {
        guard delta > 0, delta.isFinite else { return 28 }
        return log2(360 / delta)
    }

    /// Whether markers should cluster at a given zoom — the native mirror of the web
    /// `disableClusteringAtZoom` semantics: leaflet stops clustering once the map is zoomed in to (or
    /// past) that level, so clustering is active only while `zoom < disableAtZoom`.
    public static func shouldCluster(zoom: Double, disableAtZoom: Int) -> Bool {
        zoom < Double(disableAtZoom)
    }

    /// Projects a leaflet popup HTML string (web `popupHtml`) to the plain text a VoiceOver label
    /// can read — strips markup tags and decodes the handful of entities the web popups use, then
    /// collapses whitespace. Total: a `nil` or markup-free string returns its trimmed text, and an
    /// empty result returns `nil` so the caller falls back to a generic marker label.
    public static func plainText(_ html: String?) -> String? {
        guard let html else { return nil }
        var text = html.replacingOccurrences(
            of: "<[^>]+>",
            with: " ",
            options: .regularExpression
        )
        text = text
            .replacingOccurrences(of: "&copy;", with: "©")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
        text = text.replacingOccurrences(
            of: "\\s+",
            with: " ",
            options: .regularExpression
        )
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

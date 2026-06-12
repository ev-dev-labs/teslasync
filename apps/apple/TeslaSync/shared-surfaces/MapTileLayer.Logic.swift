//
//  MapTileLayer.Logic.swift
//  TeslaSync — P4 shared surface · 0185 · MapTileLayer (Apple)
//
//  The pure decision + transform core for the map base-layer surface — the parts of
//  `components/maps/MapTileLayer.tsx` that are not networking or rendering: the localisation seam
//  (web `t(key, default)`), the attribution HTML → plain-text projection (leaflet renders the
//  `TileDef.attribution` HTML in its control; MapKit shows a plain string, so the markup is stripped
//  at the display boundary), the XYZ URL-template fill (the native equivalent of leaflet's `{s}` /
//  `{z}` / `{x}` / `{y}` / `{r}` substitution — leaflet does this internally; MKTileOverlay leaves
//  `{s}` / `{r}` to us), the subdomain rotation (leaflet `subdomains: 'abc'`), and the fullscreen
//  corner placement (web `MapFullscreenControl` `position`). Foundation-only so every branch is
//  asserted without rendering.
//

import Foundation

// MARK: - Localisation seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. A plain closure so the pure core needs no bundle: production passes the
/// P1/S10 facade, tests pass the identity resolver.
public typealias MapTileLayerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Fullscreen corner (web `MapFullscreenControl.position`)

/// The corner the fullscreen control mounts in — the verbatim port of the web
/// `MapFullscreenControlProps.position` union (`'topleft' | 'topright' | 'bottomleft' |
/// 'bottomright'`). The raw value matches the web string. RTL pages pass `topleft` so the control
/// stays on the reading-direction trailing edge (web comment), mirrored here by the host.
public enum MapTileLayerCorner: String, Sendable, Equatable, CaseIterable {
    case topleft
    case topright
    case bottomleft
    case bottomright

    /// Parses a host-supplied corner string, defaulting to `.topright` (web `position = 'topright'`).
    public static func parse(_ raw: String?) -> MapTileLayerCorner {
        guard let raw, let corner = MapTileLayerCorner(rawValue: raw) else { return .topright }
        return corner
    }
}

// MARK: - Pure transforms

/// The pure helpers that back the tile overlay + attribution chrome. All total + side-effect-free.
public enum MapTileLayerLogic {
    /// Default leaflet subdomains (`subdomains: 'abc'`) — used to rotate `{s}` across tile requests
    /// so the browser/OS opens parallel connections to sharded tile hosts.
    public static let defaultSubdomains = ["a", "b", "c"]

    /// Projects a leaflet attribution HTML string to the plain text MapKit can display — strips
    /// anchor/markup tags and decodes the `&copy;` entity to `©`. Total: a string with no markup is
    /// returned trimmed, so `"&copy; Esri"` → `"© Esri"` and the CARTO anchor → `"© CARTO"`.
    public static func plainAttribution(_ html: String) -> String {
        var text = html
        // Strip any HTML tags (leaflet anchors), keeping the inner text.
        text = text.replacingOccurrences(
            of: "<[^>]+>",
            with: "",
            options: .regularExpression
        )
        // Decode the handful of entities the web attributions use.
        text = text
            .replacingOccurrences(of: "&copy;", with: "©")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&nbsp;", with: " ")
        // Collapse any whitespace runs the tag removal left behind.
        text = text.replacingOccurrences(
            of: "\\s+",
            with: " ",
            options: .regularExpression
        )
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Whether a URL template carries the XYZ tile tokens MapKit needs (`{x}` / `{y}` / `{z}`).
    /// Used to detect the defensive empty state (a malformed source that cannot tile).
    public static func hasTileTemplate(_ template: String) -> Bool {
        template.contains("{x}") && template.contains("{y}") && template.contains("{z}")
    }

    /// Picks the `{s}` subdomain for a tile coordinate — the native mirror of leaflet's
    /// `(x + y) % subdomains.length` rotation. Returns an empty string when no subdomains are
    /// configured (a template without `{s}`), so the fill is a no-op for those providers.
    public static func subdomain(x: Int, y: Int, subdomains: [String] = defaultSubdomains) -> String {
        guard !subdomains.isEmpty else { return "" }
        let index = abs(x &+ y) % subdomains.count
        return subdomains[index]
    }

    /// Fills an XYZ URL template for one tile — the native equivalent of leaflet's internal
    /// `L.Util.template` substitution. Replaces `{s}` (subdomain), `{z}` / `{x}` / `{y}` (tile
    /// path), and `{r}` (retina: `"@2x"` on a `> 1` screen scale, else empty — leaflet's
    /// `detectRetina`). Total: tokens absent from the template are simply not substituted.
    public static func fillTemplate(
        _ template: String,
        x: Int,
        y: Int,
        zoom: Int,
        subdomains: [String] = defaultSubdomains,
        retina: Bool = false
    ) -> String {
        var url = template
        url = url.replacingOccurrences(of: "{s}", with: subdomain(x: x, y: y, subdomains: subdomains))
        url = url.replacingOccurrences(of: "{z}", with: String(zoom))
        url = url.replacingOccurrences(of: "{x}", with: String(x))
        url = url.replacingOccurrences(of: "{y}", with: String(y))
        url = url.replacingOccurrences(of: "{r}", with: retina ? "@2x" : "")
        return url
    }
}

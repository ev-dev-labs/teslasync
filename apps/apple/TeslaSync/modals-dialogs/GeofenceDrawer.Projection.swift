//
//  GeofenceDrawer.Projection.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The snapshot → render projection for the geofence drawer, split from the geometry core for the
//  lint file-length budget. Pure (Foundation only): the resolved render phase (the web controller
//  renders no states of its own, so loading / empty / error are added per the Apple modal contract
//  — the map + toolbar stay live through empty + content so the first fence is always drawable),
//  the renderable filtering (web sync-fences effect that skips null layers), the `describeFence`
//  accessible-string port, the camera-fit point set, and the `modes` fallback (web default
//  `['circle']`). Unit-tested without a map or a store.
//

import Foundation

// MARK: - Render phase (Apple modal contract over the passive web controller)

/// What the surface renders at the top level. The web `GeofenceDrawer` only ever mounts the draw
/// controls; the loading + empty + error envelopes are added so the first-open, no-fences, and
/// load-failure cases never render a blank panel.
public enum GeofenceDrawerPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Renderable fence (the map overlay) + describe row (the list)

/// A persisted fence resolved to a drawable overlay — the web sync-fences effect that turns each
/// `DrawableGeofence` into a layer (skipping the ones with no usable geometry).
public struct GeofenceRenderable: Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: GeofenceRenderKind
    public let name: String?

    public init(id: String, kind: GeofenceRenderKind, name: String?) {
        self.id = id
        self.kind = kind
        self.name = name
    }
}

/// One describe row for the fence list — the `describeFence` string plus the id the list uses to
/// focus / edit / delete that fence.
public struct GeofenceRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String

    public init(id: String, text: String) {
        self.id = id
        self.text = text
    }
}

// MARK: - describeFence (web accessible-string helper)

/// The pure `describeFence` port. The web source's only user-facing prose lives here, promoted to
/// P1/S10 keys (resolved through an injected localizer so it's testable without a bundle). Numbers
/// use the locale-independent `toFixed` parity.
public enum GeofenceDescribe {
    /// Port of `describeFence`: a circle (lat + lng + radius all present, any radius — matching the
    /// web `typeof` guard, which does NOT require `radius > 0`) reads "{name} — {radius}m circle
    /// around {lat}, {lng}"; a ring of ≥3 vertices reads "{name} — {N}-vertex polygon"; otherwise
    /// just the name. A missing name falls back to the localized "Geofence".
    public static func text(for item: GeofenceItem, localize: (String, String) -> String) -> String {
        let name = item.name ?? localize("geofence.defaultName", "Geofence")
        if let lat = item.lat, let lng = item.lng, let radius = item.radius {
            return localize("geofence.describe.circle", "{{name}} — {{radius}}m circle around {{lat}}, {{lng}}")
                .replacingOccurrences(of: "{{name}}", with: name)
                .replacingOccurrences(of: "{{radius}}", with: GeofenceFormat.fixed(radius, places: 0))
                .replacingOccurrences(of: "{{lat}}", with: GeofenceFormat.fixed(lat, places: 4))
                .replacingOccurrences(of: "{{lng}}", with: GeofenceFormat.fixed(lng, places: 4))
        }
        if let polygon = item.polygon, polygon.count >= 3 {
            return localize("geofence.describe.polygon", "{{name}} — {{count}}-vertex polygon")
                .replacingOccurrences(of: "{{name}}", with: name)
                .replacingOccurrences(of: "{{count}}", with: String(polygon.count))
        }
        return name
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules the model binds through: phase resolution, renderable filtering, the
/// describe rows, the camera-fit point set, and the `modes` fallback.
public enum GeofenceDrawerProjection {
    /// Resolves the render phase. Loading shows only before the fences first resolve; a resolved
    /// snapshot with no fences shows the empty state (the map + toolbar still render under it); a
    /// failure with no cached fences shows the error state; once a snapshot is on hand the live
    /// surface stays (freshness + any reload failure shown by the chip / banner / inline error).
    public static func resolvePhase(
        status: GeofenceDrawerLoadStatus,
        fences: [GeofenceItem]?
    ) -> GeofenceDrawerPhase {
        switch status {
        case .loading:
            guard let fences else { return .loading }
            return fences.isEmpty ? .empty : .content
        case .loaded:
            return (fences ?? []).isEmpty ? .empty : .content
        case let .failed(message):
            guard let fences else { return .error(message) }
            return fences.isEmpty ? .empty : .content
        }
    }

    /// Turns the persisted fences into drawable overlays, dropping the ones the web `fenceToLayer`
    /// would skip (no circle and no ≥3-vertex ring).
    public static func renderables(from fences: [GeofenceItem]) -> [GeofenceRenderable] {
        fences.compactMap { item in
            let kind = GeofenceGeometry.renderKind(for: item)
            guard kind != .none else { return nil }
            return GeofenceRenderable(id: item.id, kind: kind, name: item.name)
        }
    }

    /// The describe rows for the fence list, in the persisted order.
    public static func rows(
        from fences: [GeofenceItem],
        localize: (String, String) -> String
    ) -> [GeofenceRow] {
        fences.map { GeofenceRow(id: $0.id, text: GeofenceDescribe.text(for: $0, localize: localize)) }
    }

    /// The coordinates the map camera should fit — every circle center and every polygon vertex of
    /// the renderable fences.
    public static func cameraPoints(from renderables: [GeofenceRenderable]) -> [GeofencePoint] {
        renderables.flatMap { renderable -> [GeofencePoint] in
            switch renderable.kind {
            case let .circle(center, _): [center]
            case let .polygon(ring): ring
            case .none: []
            }
        }
    }

    /// The allowed draw modes — the web `modes` prop filtered to the canonical order and de-duped,
    /// falling back to the web default `['circle']` when empty.
    public static func modes(from requested: [GeofenceDrawerMode]) -> [GeofenceDrawerMode] {
        let filtered = GeofenceDrawerMode.order.filter { requested.contains($0) }
        return filtered.isEmpty ? GeofenceDrawerMode.defaultModes : filtered
    }
}

//
//  VehicleConfigSection.Projector.swift
//  TeslaSync — P4 feature view · 0300 · VehicleConfigSection (Apple)
//
//  The pure (Foundation-only) computational core for the vehicle-detail "Vehicle
//  Configuration" surface: the snapshot→rows projector, the render-phase resolver, the
//  live-state freshness enum, the diagnostics slug, and the VoiceOver summary. Split out of
//  VehicleConfigSection.Adapter.swift (which holds the value types) to keep each file within
//  the lint budget; both are dependency-free so every value can be pinned by unit tests
//  without a bundle or a rendered view.
//

import Foundation

// MARK: - Projector (pure, web-parity)

/// The dependency-free projection from a snapshot to the view-ready `VCSectionProjection`. A
/// faithful port of the web `configItems` build: one row per field in source order, each
/// carrying its resolved value; a `nil` snapshot yields no rows (the empty gate).
public enum VCSectionProjector {
    /// Projects the snapshot into the resolved, view-ready projection. The `strings` carry
    /// the localized `Yes`/`No`/`—` literals the value ternaries need.
    public static func project(
        snapshot: VCSectionSnapshot?,
        strings: VCSectionValueStrings = .fallback
    ) -> VCSectionProjection {
        guard let snapshot else {
            return VCSectionProjection(rows: [], hasSnapshot: false)
        }
        let rows = VCSectionField.ordered.map { field in
            VCSectionRow(field: field, value: field.value(in: snapshot, strings: strings))
        }
        return VCSectionProjection(rows: rows, hasSnapshot: true)
    }
}

// MARK: - Render phase

/// What the surface should render. The web source distinguishes only content vs the
/// skeleton fallback; the loading / error / empty envelope around it (prompt P4 states) is
/// supplied by the bound source, mirroring the web parent page's `isLoading` / error wiring
/// on the vehicle-detail page.
public enum VCSectionPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status (web `isLoading` / resolved / failure), projected into a
/// phase by `resolvePhase`.
public enum VCSectionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a
/// cached configuration is clearly labeled while reconnecting / offline.
public enum VCSectionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension VCSectionProjector {
    /// Resolves the render phase from the bound load status + whether a snapshot cleared the
    /// web content gate. Cached content stays visible across refresh / transient failures so
    /// an offline or stale pod still shows the last-known configuration.
    static func resolvePhase(_ status: VCSectionLoadStatus, hasContent: Bool) -> VCSectionPhase {
        switch status {
        case .loading:
            hasContent ? .content : .loading
        case .loaded:
            hasContent ? .content : .empty
        case let .failed(message):
            hasContent ? .content : .error(message)
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum VCSectionSurface {
    public static let slug = "VehicleConfigSection"
}

// MARK: - Accessibility (VoiceOver summary)

/// Builds the surface's VoiceOver summary through an injected localizer
/// (`(key, fallback) -> String`), so it is bundle-free testable. Speaks the title then each
/// row's label + value, or the no-data sentence when the snapshot is absent.
public enum VCSectionAccessibility {
    /// The panel-level summary: the title followed by each row's label and value (e.g.
    /// "Vehicle Configuration: Car Type Model 3, Trim Long Range, …"), or the empty sentence
    /// when no snapshot is present.
    public static func summary(
        projection: VCSectionProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("vehicles.detail.vehicleConfig", "Vehicle Configuration")
        guard projection.hasContent else {
            let empty = localize("vehicles.detail.noVehicleConfig", "No configuration data available")
            return "\(title): \(empty)"
        }
        let parts = projection.rows.map { row in
            "\(localize(row.labelKey, row.labelFallback)) \(row.value)"
        }
        return "\(title): \(parts.joined(separator: ", "))"
    }
}

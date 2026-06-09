//
//  NoVehicleSelected.Adapter.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  The pure, host-testable projection core for the defensive "no vehicle selected"
//  empty state — the native parity of features/onboarding/components/NoVehicleSelected.tsx.
//  The web component is a presentational guard: when a page is mounted while
//  `useSelectedVehicle().vehicleId` is null (a deep-link landing before the onboarding
//  poll resolves, or an install whose Tesla token was revoked between visits), it renders
//  an `EmptyState` instead of the page's data scaffolding and links the user back into
//  onboarding. This core models that selection input as an exclusive feed phase and
//  resolves it to the render phase + projection the SwiftUI layer switches over.
//
//  Foundation-only — no SwiftUI, no networking, no `Shared` import — so it type-checks and
//  RUNS under bare `swiftc` for the executed adapter harness, and the unit tests reach it
//  without a bundle or a rendered view.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, kept in the
/// dependency-free core so the projection's unit tests can reach it.
public enum NoVehicleSelectedSurface {
    public static let slug = "NoVehicleSelected"
}

// MARK: - Canonical redirect target (web `navigate('/onboarding')`)

/// The canonical route the empty-state CTA drives to, matching the web
/// `navigate('/onboarding')` the `EmptyState` action fires.
public enum NoVehicleSelectedRoute {
    public static let onboarding = "/onboarding"
}

// MARK: - Selected-vehicle reference (web `useSelectedVehicle()`)

/// The minimal selected-vehicle projection the surface needs — the native parity of the
/// `useSelectedVehicle()` hook value the web guard inspects. A `nil` reference (the web
/// `vehicleId === null`) is what makes the empty state render.
public struct SelectedVehicleRef: Equatable, Sendable {
    /// The selected vehicle's stable id (web `vehicleId`).
    public let id: String
    /// The selected vehicle's display name, for the "vehicle ready" confirmation copy.
    public let displayName: String

    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Feed phase (web `useSelectedVehicle` resolution, made exclusive)

/// The selected-vehicle feed's state, collapsed into one exclusive case so the evaluator
/// is total. The web guard only distinguishes "a vehicle is selected" from "none"; the
/// native state matrix additionally surfaces the in-flight (resolving) and failed reads so
/// no branch is ever a blank box.
public enum SelectedVehicleFeedPhase: Equatable, Sendable {
    /// The selection is still resolving (web: the onboarding poll has not resolved yet).
    case resolving
    /// The selection resolved: a vehicle (`.some`) or none (`.none` → web `vehicleId` null).
    case resolved(SelectedVehicleRef?)
    /// The selection read failed (web: token revoked between visits) — message for the
    /// error surface.
    case failed(message: String)
}

// MARK: - Render phase

/// What the surface renders at the top level. The web component is always the empty
/// state; the native envelope widens that with loading / content / error so the bound
/// `useSelectedVehicle` feed is represented in every state without a blank panel.
public enum NoVehicleSelectedPhase: Equatable, Sendable {
    /// The selection is resolving — skeleton chrome.
    case loading
    /// Resolved with no vehicle — THE web empty state (Car glyph + copy + onboarding CTA).
    case empty
    /// Resolved with a vehicle — a "vehicle ready" confirmation (the guard's reason to
    /// render is gone; the host would show real data, so this is never blank).
    case content
    /// The selection read failed — a retry affordance.
    case error(String)
}

// MARK: - Live-stream freshness (ADR-013)

/// Live-stream freshness: drives the freshness chip + the cached-data banner so a cached
/// selection is clearly labeled while reconnecting / offline.
public enum NoVehicleSelectedConnection: Equatable, Sendable {
    case live
    case stale
    case offline
}

// MARK: - Projection (render-ready)

/// The render-ready projection the surface switches over: the resolved render phase, the
/// selected vehicle (present only in the content phase), and the failure message for the
/// error state. Every branch the SwiftUI layer needs is resolved here so the view is a
/// pure function of the projection.
public struct NoVehicleSelectedProjection: Equatable, Sendable {
    public let phase: NoVehicleSelectedPhase
    public let selected: SelectedVehicleRef?
    public let errorMessage: String?

    public init(
        phase: NoVehicleSelectedPhase,
        selected: SelectedVehicleRef? = nil,
        errorMessage: String? = nil
    ) {
        self.phase = phase
        self.selected = selected
        self.errorMessage = errorMessage
    }
}

// MARK: - Builder (feed → projection)

/// Builds a `NoVehicleSelectedProjection` from the bound selection feed. This is THE
/// adapter the executed harness exercises end-to-end: resolving → loading, resolved-none →
/// empty (the web guard's verdict), resolved-some → content, failed → error.
public enum NoVehicleSelectedProjectionBuilder {
    /// Resolves the render phase from the feed phase (pure + total).
    public static func resolvePhase(_ feed: SelectedVehicleFeedPhase) -> NoVehicleSelectedPhase {
        switch feed {
        case .resolving:
            .loading
        case let .resolved(ref):
            ref == nil ? .empty : .content
        case let .failed(message):
            .error(message)
        }
    }

    /// Builds the full projection, carrying the selected reference into the content phase
    /// and the failure message into the error phase.
    public static func build(_ feed: SelectedVehicleFeedPhase) -> NoVehicleSelectedProjection {
        switch feed {
        case .resolving:
            NoVehicleSelectedProjection(phase: .loading)
        case let .resolved(ref):
            NoVehicleSelectedProjection(phase: ref == nil ? .empty : .content, selected: ref)
        case let .failed(message):
            NoVehicleSelectedProjection(phase: .error(message), errorMessage: message)
        }
    }
}

// MARK: - Copy interpolation (web i18next `t(key, { name })`)

/// The interpolations the surface's copy needs, kept pure so they unit-test through an
/// injected localizer without a bundle. Mirrors the repo's `{{token}}` template style.
public enum NoVehicleSelectedCopy {
    /// The "vehicle ready" body, interpolating the selected vehicle's name into the
    /// localized template (web i18next `t(..., { name })`).
    public static func readyBody(name: String, localize: (String, String) -> String) -> String {
        localize("common.noVehicleSelected.ready.body", "{{name}} is ready — your data is available.")
            .replacingOccurrences(of: "{{name}}", with: name)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver summary. Pure + localizer-injected so the spoken content
/// is testable without rendering the view.
public enum NoVehicleSelectedAccessibility {
    /// The spoken label for the whole surface in its current projection.
    public static func summary(
        for projection: NoVehicleSelectedProjection,
        localize: (String, String) -> String
    ) -> String {
        switch projection.phase {
        case .loading:
            return localize("common.noVehicleSelected.loading", "Checking your garage…")
        case .empty:
            let title = localize("common.noVehicleSelected.title", "No vehicle selected")
            let desc = localize(
                "common.noVehicleSelected.desc",
                "Add a vehicle to your fleet to see data on this page."
            )
            return "\(title). \(desc)"
        case .content:
            let title = localize("common.noVehicleSelected.ready.title", "Vehicle selected")
            let name = projection.selected?.displayName ?? ""
            return name.isEmpty ? title : "\(title): \(name)"
        case let .error(message):
            let title = localize("common.noVehicleSelected.error.title", "Couldn't load your vehicles")
            return message.isEmpty ? title : "\(title). \(message)"
        }
    }
}

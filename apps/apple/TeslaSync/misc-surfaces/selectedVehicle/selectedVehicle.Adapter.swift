//
//  selectedVehicle.Adapter.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  The pure, host-testable projection core for the selected-vehicle store — the native
//  parity of store/selectedVehicle.tsx (+ the composing hooks/useSelectedVehicle.ts). The
//  web store is a persistent global "which vehicle is the user focused on" context backed
//  by localStorage; the composing hook layers a precedence (URL > store > first vehicle)
//  and resolves the matching vehicle record. This core models that selection input as the
//  bound fleet feed + the stored / URL ids, and resolves it to the render phase + render-
//  ready projection the SwiftUI layer switches over.
//
//  Foundation-only — no SwiftUI, no networking, no `Shared` import — so it type-checks and
//  RUNS under bare `swiftc` for the executed adapter harness, and the unit tests reach it
//  without a bundle or a rendered view. All public types are `SelectedVehicleStore`-prefixed
//  so they never collide with the existing `SelectedVehicleRef` / `SelectedVehicleFeedPhase`
//  in the NoVehicleSelected surface (same module).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, kept in the
/// dependency-free core so the projection's unit tests can reach it.
public enum SelectedVehicleStoreSurface {
    public static let slug = "selectedVehicle"
}

// MARK: - Persistence keys (web `STORAGE_KEY`)

/// The persistence key the store reads / writes, kept byte-identical to the web
/// `STORAGE_KEY = 'teslasync-selected-vehicle'` so a value written by the web client (or a
/// prior native launch) round-trips unchanged.
public enum SelectedVehicleStoreKeys {
    public static let storageKey = "teslasync-selected-vehicle"
}

// MARK: - Id parsing (web `loadInitial` / `parseId`)

/// Parses a persisted / URL vehicle-id string the way the web store does: a finite, strictly
/// positive number is accepted (`Number.isFinite(n) && n > 0`), everything else — `nil`,
/// empty, non-numeric, zero, negative — resolves to `nil`. Overflowing magnitudes are
/// rejected rather than trapped so a corrupt store never crashes the launch.
public enum SelectedVehicleStoreIdParser {
    /// Web parity for `loadInitial()` / `parseId()`.
    public static func parse(_ raw: String?) -> Int? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard let value = Double(trimmed), value.isFinite, value > 0 else { return nil }
        guard value <= Double(Int.max) else { return nil }
        return Int(value)
    }
}

// MARK: - Fleet vehicle (web `useVehicles()` row the hook resolves against)

/// The minimal vehicle projection the surface needs — the native parity of a `Vehicle` row
/// the web `useSelectedVehicle()` resolves the selection against. The store only ever holds
/// an id; the display name comes from the bound fleet so the surface can name the selection.
public struct SelectedVehicleStoreSummary: Equatable, Sendable, Identifiable {
    /// The vehicle's stable id (web `vehicle.id`, the value persisted by the store).
    public let id: Int
    /// The vehicle's display name, for the resolved-selection copy.
    public let displayName: String

    public init(id: Int, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Fleet feed (web `useVehicles()` resolution, made exclusive)

/// The bound fleet feed's state, collapsed into one exclusive case so the evaluator is
/// total. The web hook reads `useVehicles()` (a cache-then-network query) and the selection
/// store; the native state matrix surfaces the in-flight and failed fleet reads so no branch
/// is ever a blank box.
public enum SelectedVehicleStoreFleetState: Equatable, Sendable {
    /// The fleet is still loading (web: `useVehicles()` has not resolved yet).
    case loading
    /// The fleet resolved to a (possibly empty) list of vehicles.
    case loaded([SelectedVehicleStoreSummary])
    /// The fleet read failed — message for the error surface (web `QueryError`).
    case failed(message: String)
}

// MARK: - Persistence status (web localStorage availability)

/// Whether the selection is durably persisted, kept only for this session, or read-only.
/// Mirrors the web store's localStorage reality: a normal client persists; private-browsing
/// / quota / SSR makes writes silently no-op so the selection works in-session but does not
/// survive reload; an unmounted provider (`useSelectedVehicleStore` outside `Provider`)
/// returns a `null` + no-op store.
public enum SelectedVehicleStorePersistence: Equatable, Sendable {
    /// Writes reach durable storage (`UserDefaults`).
    case persisted
    /// Storage is unavailable — selection is in-session only (web private-browsing / quota).
    case ephemeral
    /// No store is connected — reads are `nil` and writes are ignored (web no-provider).
    case disconnected
}

// MARK: - Live-stream freshness (ADR-013)

/// Live-stream freshness: drives the freshness chip + the cached-data banner so a cached
/// selection is clearly labeled while reconnecting / offline.
public enum SelectedVehicleStoreConnection: Equatable, Sendable {
    case live
    case stale
    case offline
}

// MARK: - Render phase

/// What the surface renders at the top level. The web store is headless; the native envelope
/// resolves the composed selection (web `useSelectedVehicle()`) into loading / content (a
/// vehicle is resolved) / empty (the fleet is empty, web `vehicleId === null`) / error so the
/// bound feed is represented in every state without a blank panel.
public enum SelectedVehicleStorePhase: Equatable, Sendable {
    /// The fleet is resolving — skeleton chrome.
    case loading
    /// A vehicle is resolved (URL > store > first) — the selected-vehicle card.
    case content
    /// The fleet is empty (web `vehicleId === null`) — a friendly empty state.
    case empty
    /// The fleet read failed — a retry affordance.
    case error(String)
}

// MARK: - Projection (render-ready)

/// The render-ready projection the surface switches over: the resolved render phase, the
/// resolved selection (present in the content phase), the default candidate (the first
/// vehicle the empty state offers to select), and the failure message for the error state.
public struct SelectedVehicleStoreProjection: Equatable, Sendable {
    public let phase: SelectedVehicleStorePhase
    /// The resolved selected vehicle (web `useSelectedVehicle().vehicle`).
    public let selected: SelectedVehicleStoreSummary?
    /// The first vehicle in the fleet — the empty state's "select this" candidate.
    public let candidate: SelectedVehicleStoreSummary?
    /// The effective selected id (web `useSelectedVehicle().vehicleId`).
    public let effectiveId: Int?
    public let errorMessage: String?

    public init(
        phase: SelectedVehicleStorePhase,
        selected: SelectedVehicleStoreSummary? = nil,
        candidate: SelectedVehicleStoreSummary? = nil,
        effectiveId: Int? = nil,
        errorMessage: String? = nil
    ) {
        self.phase = phase
        self.selected = selected
        self.candidate = candidate
        self.effectiveId = effectiveId
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolver (web `useSelectedVehicle` precedence + projection)

/// The pure selection resolver — the native parity of `useSelectedVehicle()`. It computes the
/// effective id with the web precedence (URL > store > first vehicle), the store-write
/// decisions the hook's effects make (adopt a URL id, default to the first vehicle), and the
/// full render projection. THE adapter the executed harness exercises end-to-end.
public enum SelectedVehicleStoreResolver {
    /// The effective selected id with the web precedence `urlId ?? stored ?? firstVehicleId`.
    public static func effectiveId(urlId: Int?, storedId: Int?, firstVehicleId: Int?) -> Int? {
        urlId ?? storedId ?? firstVehicleId
    }

    /// The id the hook writes back when the URL provides one that differs from the store
    /// (web `if (urlId != null && urlId !== stored) setVehicleId(urlId)`); `nil` = no write.
    public static func urlAdoption(urlId: Int?, storedId: Int?) -> Int? {
        guard let urlId, urlId != storedId else { return nil }
        return urlId
    }

    /// The id the hook writes when the store is empty and the fleet has loaded (web
    /// `if (stored == null && firstVehicleId != null) setVehicleId(firstVehicleId)`); `nil` =
    /// no write.
    public static func firstVehicleDefault(storedId: Int?, firstVehicleId: Int?) -> Int? {
        guard storedId == nil, let firstVehicleId else { return nil }
        return firstVehicleId
    }

    /// Builds the full render projection from the bound fleet feed + the stored / URL ids.
    /// Loading → loading; failed → error; loaded → content when a vehicle resolves, else
    /// empty (the web `vehicleId === null` verdict for an empty fleet).
    public static func build(
        storedId: Int?,
        urlId: Int?,
        fleet: SelectedVehicleStoreFleetState
    ) -> SelectedVehicleStoreProjection {
        switch fleet {
        case .loading:
            return SelectedVehicleStoreProjection(phase: .loading)
        case let .failed(message):
            return SelectedVehicleStoreProjection(phase: .error(message), errorMessage: message)
        case let .loaded(vehicles):
            let candidate = vehicles.first
            let resolvedId = effectiveId(urlId: urlId, storedId: storedId, firstVehicleId: candidate?.id)
            let selected = resolvedId.flatMap { id in vehicles.first { $0.id == id } }
            if let selected {
                return SelectedVehicleStoreProjection(
                    phase: .content,
                    selected: selected,
                    candidate: candidate,
                    effectiveId: resolvedId
                )
            }
            return SelectedVehicleStoreProjection(
                phase: .empty,
                candidate: candidate,
                effectiveId: resolvedId
            )
        }
    }
}

// MARK: - Copy interpolation (web i18next `t(key, { … })`)

/// The interpolations the surface's copy needs, kept pure so they unit-test through an
/// injected localizer without a bundle. Mirrors the repo's `{{token}}` template style.
public enum SelectedVehicleStoreCopy {
    /// The resolved-selection body, interpolating the selected vehicle's name.
    public static func selectionBody(name: String, localize: (String, String) -> String) -> String {
        localize("selectedVehicle.content.body", "{{name}} is your focused vehicle across TeslaSync.")
            .replacingOccurrences(of: "{{name}}", with: name)
    }

    /// The empty-state "select this vehicle" action label, interpolating the candidate name.
    public static func selectCandidateLabel(name: String, localize: (String, String) -> String) -> String {
        localize("selectedVehicle.empty.select", "Select {{name}}")
            .replacingOccurrences(of: "{{name}}", with: name)
    }

    /// The persistence note for the resolved selection, reflecting where it is stored.
    public static func persistenceNote(
        _ persistence: SelectedVehicleStorePersistence,
        localize: (String, String) -> String
    ) -> String {
        switch persistence {
        case .persisted:
            localize("selectedVehicle.persistence.persisted", "Saved on this device.")
        case .ephemeral:
            localize(
                "selectedVehicle.persistence.ephemeral",
                "Kept for this session only — it won't survive a restart."
            )
        case .disconnected:
            localize(
                "selectedVehicle.persistence.disconnected",
                "Selection isn't being tracked right now."
            )
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver summary. Pure + localizer-injected so the spoken content is
/// testable without rendering the view.
public enum SelectedVehicleStoreAccessibility {
    /// The spoken label for the whole surface in its current projection.
    public static func summary(
        for projection: SelectedVehicleStoreProjection,
        localize: (String, String) -> String
    ) -> String {
        switch projection.phase {
        case .loading:
            return localize("selectedVehicle.loading", "Loading your vehicles…")
        case .content:
            let title = localize("selectedVehicle.content.title", "Selected vehicle")
            let name = projection.selected?.displayName ?? ""
            return name.isEmpty ? title : "\(title): \(name)"
        case .empty:
            let title = localize("selectedVehicle.empty.title", "No vehicle selected")
            let desc = localize("selectedVehicle.empty.desc", "Add a vehicle to your fleet to choose one.")
            return "\(title). \(desc)"
        case let .error(message):
            let title = localize("selectedVehicle.error.title", "Couldn't load your vehicles")
            return message.isEmpty ? title : "\(title). \(message)"
        }
    }
}

//
//  VehicleSettingsTab.Projection.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  The pure input → resolved view-state projection for the per-vehicle settings
//  surface, split out of the model so each file stays focused. The input snapshot
//  mirrors the web hook output (`useVehicleSettings` + the parent query lifecycle);
//  the projection ports the section's render gate (web `isLoading ? skeleton :
//  isError ? error : <rows>`) plus the P4 leaf contract (loading / empty / error /
//  data) and resolves one ordered row per supported key (web `findEffectiveSetting`).
//  Everything here is pure and unit tested in isolation.
//

import Foundation

// MARK: - Resolved setting (one wire row, web `EffectiveSetting`)

/// One resolved per-vehicle setting from the resolver payload — the native mirror of
/// the web `EffectiveSetting` ({key, value, source}). `value` is the string form (the
/// supported keys are all string-valued); `nil` means the resolver returned no row for
/// the key, which the projection treats exactly like the web `findEffectiveSetting`
/// returning `undefined`.
public struct ResolvedSetting: Equatable, Sendable {
    public let key: String
    public let value: String?
    public let source: EffectiveSettingSource

    public init(key: String, value: String?, source: EffectiveSettingSource) {
        self.key = key
        self.value = value
        self.source = source
    }
}

// MARK: - Input snapshot (web hook output + parent query lifecycle)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web
/// `useVehicleSettings` output (the resolver's effective-setting list) plus the parent
/// query lifecycle (`isLoading` / `isError`) and the orthogonal P4 connectivity axis.
public struct VehicleSettingsInput: Equatable, Sendable {
    public var settings: [ResolvedSetting]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: VehicleSettingsConnection

    public init(
        settings: [ResolvedSetting] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleSettingsConnection = .live
    ) {
        self.settings = settings
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// The effective row for a key, or `nil` (web `findEffectiveSetting`).
    public func setting(for key: String) -> ResolvedSetting? {
        settings.first { $0.key == key }
    }
}

// MARK: - Resolved row (descriptor + effective value/source)

/// One render-ready row — the descriptor paired with its resolved effective value and
/// source. A pure function of the descriptor catalogue and the input snapshot.
public struct ResolvedRow: Equatable, Sendable, Identifiable {
    public let descriptor: VehicleSettingDescriptor
    public let source: EffectiveSettingSource
    public let value: String?

    public var id: String {
        descriptor.key
    }

    public init(descriptor: VehicleSettingDescriptor, source: EffectiveSettingSource, value: String?) {
        self.descriptor = descriptor
        self.source = source
        self.value = value
    }
}

// MARK: - Resolved view-state (render gate + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the section body and `rows`
/// carries the ordered per-key resolution so the view is a pure function of this value
/// plus the model's per-row editable drafts.
public struct VehicleSettingsResolved: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let rows: [ResolvedRow]

    public init(phase: Phase, rows: [ResolvedRow]) {
        self.phase = phase
        self.rows = rows
    }
}

// MARK: - Projection

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web section's render gate plus the P4 leaf contract. Unit tested across
/// loading / empty / error / data and the source-resolution fallbacks.
public enum VehicleSettingsProjection {
    public static func resolve(
        _ input: VehicleSettingsInput,
        descriptors: [VehicleSettingDescriptor] = VehicleSettingsCatalog.descriptors
    ) -> VehicleSettingsResolved {
        let rows = descriptors.map { descriptor -> ResolvedRow in
            // web `findEffectiveSetting` → undefined ⇒ source 'default', value absent.
            let effective = input.setting(for: descriptor.key)
            return ResolvedRow(
                descriptor: descriptor,
                source: effective?.source ?? .systemDefault,
                value: effective?.value
            )
        }
        return VehicleSettingsResolved(phase: phase(for: input, rows: rows), rows: rows)
    }

    private static func phase(
        for input: VehicleSettingsInput,
        rows: [ResolvedRow]
    ) -> VehicleSettingsResolved.Phase {
        // P4 contract: a parent query failure surfaces at the leaf as `error`
        // (web `isError` → ErrorDisplay).
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        // Initial fetch (web parent `isLoading` → skeleton).
        if input.isLoading {
            return .loading
        }
        // Defensive leaf state: an empty whitelist renders a friendly empty state
        // rather than a blank panel. The production catalogue is always non-empty, so
        // the data branch renders the six rows (web always renders every row).
        if rows.isEmpty {
            return .empty
        }
        return .data
    }
}

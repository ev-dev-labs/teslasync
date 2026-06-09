//
//  GasPriceSettings.Projection.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  The pure input → resolved view-state projection for the Gas Price Auto-Poll
//  settings surface, split out of `GasPriceSettings.Model.swift` so each file stays
//  focused. The input snapshot mirrors the web hook outputs (`useGasPriceStatus` plus
//  the parent query lifecycle); the projection ports the surface's render shaping
//  (`formatCurrency`/unit, `formatDateTime`/"Never") plus the P4 leaf contract
//  (loading / empty / error / data). Everything here is pure and unit tested in
//  isolation, with locale + time zone + formatting injected for determinism.
//

import Foundation

// MARK: - Input snapshot (web `useGasPriceStatus` + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web
/// `useGasPriceStatus()` result (`status`), the parent surface's lifecycle
/// (`isLoading`, an error message), and the P4 connectivity axis. `status == nil`
/// while `isLoading == false` and no error means the status payload was absent (the
/// empty branch); otherwise the controls render.
public struct GasPriceSettingsInput: Sendable, Equatable {
    public var status: GasPriceRecord?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: GasPriceSettingsConnection

    public init(
        status: GasPriceRecord? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: GasPriceSettingsConnection = .live
    ) {
        self.status = status
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; `enabled` /
/// `pollInterval` drive the controls; `currentPriceLabel` is the pre-shaped price cell
/// (already carrying the `—` fallback); `lastPolledLabel` is the formatted timestamp
/// (nil when never polled → the view renders the localised "Never"). The view is a
/// pure function of this value plus the model's transient `isPolling` flag.
public struct GasPriceSettingsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let enabled: Bool
    public let pollInterval: GasPollInterval
    public let currentPriceLabel: String
    public let lastPolledLabel: String?

    public init(
        phase: Phase,
        enabled: Bool,
        pollInterval: GasPollInterval,
        currentPriceLabel: String,
        lastPolledLabel: String?
    ) {
        self.phase = phase
        self.enabled = enabled
        self.pollInterval = pollInterval
        self.currentPriceLabel = currentPriceLabel
        self.lastPolledLabel = lastPolledLabel
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render shaping plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data and the price / timestamp formatting.
public enum GasPriceSettingsProjection {
    public static func resolve(
        _ input: GasPriceSettingsInput,
        formatting: GasPriceFormatting = GasPriceFormatting(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> GasPriceSettingsResolved {
        let status = input.status
        let priceLabel = status.map {
            GasPriceFormat.price($0.currentPrice, formatting: formatting, locale: locale)
        } ?? GasPriceFormat.dash
        let polledLabel = status?.lastPollTime.map {
            GasPriceFormat.dateTime($0, locale: locale, timeZone: timeZone)
        }

        return GasPriceSettingsResolved(
            phase: phase(for: input),
            enabled: status?.enabled ?? false,
            pollInterval: status?.pollInterval ?? .weekly,
            currentPriceLabel: priceLabel,
            lastPolledLabel: polledLabel
        )
    }

    private static func phase(for input: GasPriceSettingsInput) -> GasPriceSettingsResolved.Phase {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return .error(message)
        }
        // Initial fetch (web query pending).
        if input.isLoading {
            return .loading
        }
        // Status resolved with no payload → friendly empty state, never a blank box.
        if input.status == nil {
            return .empty
        }
        return .data
    }
}

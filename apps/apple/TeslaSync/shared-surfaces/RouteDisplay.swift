//
//  RouteDisplay.swift
//  TeslaSync — P4 shared surface · 0101 · RouteDisplay (Apple)
//
//  The route line — the SwiftUI parity of `components/data-display/RouteDisplay.tsx`. A compact,
//  single-line "From → To" / "↻ round trip" / single-location / "No location data" label with an
//  optional leading map pin, used by every history-style row (Drives, Charging, Trips). It is a
//  pure function of its `start` / `end` endpoints (resolved through `RouteDisplayLogic`) and the
//  P1/S10 i18n facade; there is no networking and no data-fetch state to bind, exactly like the web
//  source. Emits `view.opened` once on first appearance (P1/S11) through `RouteDisplayModel`.
//
//  (Distinct from the atomic `TSRouteDisplay` in `Sources/Components/DataDisplay` — that is the
//  simple origin→destination chip; this shared surface is the full-fidelity port of the web
//  data-display component, including the round-trip / single / no-location branches.)
//

import SwiftUI

// MARK: - RouteDisplay (the shared surface)

/// The route line — the SwiftUI parity of `components/data-display/RouteDisplay.tsx`. Renders the
/// projected `RouteDisplayContent` for the supplied endpoints, optionally led by a map pin, in the
/// small secondary-text style; the whole line truncates to one line like the web `truncate`.
public struct RouteDisplay: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RouteDisplayMeta.surfaceSlug

    private let start: RouteDisplayEndpoint
    private let end: RouteDisplayEndpoint?
    private let roundTripThresholdM: Double
    private let showIcon: Bool
    private let accessibilityID: String?
    @State private var model: RouteDisplayModel

    /// Convenience initializer — the parity of mounting `<RouteDisplay start={…} end={…} />`. The
    /// `accessibilityIdentifier` is the native counterpart of the web `testId` hook.
    public init(
        start: RouteDisplayEndpoint,
        end: RouteDisplayEndpoint? = nil,
        roundTripThresholdM: Double = RouteDisplayLogic.defaultRoundTripThresholdM,
        showIcon: Bool = true,
        accessibilityIdentifier: String? = nil,
        telemetry: any RouteDisplayTelemetry = OSLogRouteDisplayTelemetry()
    ) {
        self.start = start
        self.end = end
        self.roundTripThresholdM = roundTripThresholdM
        self.showIcon = showIcon
        accessibilityID = accessibilityIdentifier
        _model = State(initialValue: RouteDisplayModel(telemetry: telemetry))
    }

    /// Designated initializer binding a pre-built model (for hosts that own it, e.g. previews/tests).
    public init(
        start: RouteDisplayEndpoint,
        end: RouteDisplayEndpoint? = nil,
        roundTripThresholdM: Double = RouteDisplayLogic.defaultRoundTripThresholdM,
        showIcon: Bool = true,
        accessibilityIdentifier: String? = nil,
        model: RouteDisplayModel
    ) {
        self.start = start
        self.end = end
        self.roundTripThresholdM = roundTripThresholdM
        self.showIcon = showIcon
        accessibilityID = accessibilityIdentifier
        _model = State(initialValue: model)
    }

    /// The resolved line for the current endpoints — the web component body, via the pure logic.
    private var content: RouteDisplayContent {
        RouteDisplayLogic.project(
            start: start,
            end: end,
            roundTripThresholdM: roundTripThresholdM,
            noLocation: RouteDisplayStrings.noLocationData,
            roundTripPhrase: RouteDisplayStrings.roundTrip
        )
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if showIcon {
                RouteDisplayPinIcon()
            }
            RouteDisplayBodyText(content: content)
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .lineLimit(1)
        .truncationMode(.tail)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(accessibilityID ?? "")
        .onAppear { model.markAppeared() }
    }
}

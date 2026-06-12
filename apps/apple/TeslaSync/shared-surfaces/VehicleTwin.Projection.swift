//
//  VehicleTwin.Projection.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component's render contract stays unit-testable in isolation (no
//  store, no SwiftUI). It owns the phase selection (skeleton only on the initial fetch with no cached
//  vehicle; the twin stays rendered behind refresh / errors), the `useVehiclePaint` resolution, and
//  the last-updated caption; the per-subsystem legend + VoiceOver summary derivation live in
//  `VehicleTwinLegendBuilder` (VehicleTwin.Legend.swift). Localization is applied here (P1/S10) so the
//  view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. Unit tested across loading /
/// empty / error / content, the paint resolution, and (via the forwarders) the legend + summary.
public enum VehicleTwinProjection {
    public static func resolve(
        _ input: VehicleTwinInput,
        locale: Locale = .current
    ) -> VehicleTwinResolved {
        let hasVehicle = input.vehicleID != nil
        switch input.loadStatus {
        case .loading:
            return hasVehicle
                ? VehicleTwinResolved(phase: .content, content: content(for: input, locale: locale))
                : VehicleTwinResolved(phase: .loading)
        case .empty:
            return VehicleTwinResolved(phase: .empty)
        case .loaded:
            return hasVehicle
                ? VehicleTwinResolved(phase: .content, content: content(for: input, locale: locale))
                : VehicleTwinResolved(phase: .empty)
        case let .failed(message):
            return hasVehicle
                ? VehicleTwinResolved(phase: .content, content: content(for: input, locale: locale))
                : VehicleTwinResolved(phase: .error(message))
        }
    }

    /// The localized status legend (web hover-tooltip peer). Exposed for unit tests.
    static func legend(for state: VehicleTwinState) -> [VehicleTwinLegendItem] {
        VehicleTwinLegendBuilder.items(for: state)
    }

    /// The localized VoiceOver state summary. Exposed for unit tests.
    static func stateSummary(for state: VehicleTwinState) -> String {
        VehicleTwinLegendBuilder.summary(for: state)
    }

    // MARK: Content (web `VehicleTwin` render, localized)

    private static func content(for input: VehicleTwinInput, locale: Locale) -> VehicleTwinContent {
        let state = input.state
        let paint = VehicleTwinPaint.resolve(override: input.paintOverride, exteriorColor: input.exteriorColor)
        let paintName = VehicleTwinStrings.string(paint.labelKey, paint.defaultLabel)

        return VehicleTwinContent(
            title: VehicleTwinStrings.string("vehicles.twin.title", "Digital Twin"),
            figureAccessibilityLabel: VehicleTwinStrings.string(
                "vehicles.twin.a11yLabel",
                "Vehicle digital twin showing current physical state"
            ),
            accessibilityHint: VehicleTwinStrings.string(
                "vehicles.twin.a11yDescription",
                "Scalable layered vehicle illustration with live overlays for doors, windows, lights, "
                    + "lock, sentry mode, and charging status."
            ),
            state: state,
            paint: paint,
            paintAccessibilityLabel: VehicleTwinStrings.format(
                "vehicles.twin.paint.a11y",
                "Finished in %@",
                paintName
            ),
            size: input.size,
            driveIn: input.driveIn,
            interactive: input.interactive,
            legend: VehicleTwinLegendBuilder.items(for: state),
            regions: VehicleTwinRegionsBuilder.rows(for: state),
            stateSummary: VehicleTwinLegendBuilder.summary(for: state),
            updatedText: updatedText(for: input.updatedAt, locale: locale)
        )
    }

    // MARK: Last-updated caption

    private static func updatedText(for date: Date?, locale: Locale) -> String {
        guard let date else {
            return VehicleTwinStrings.string("vehicles.twin.updatedUnknown", "Awaiting telemetry")
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = locale
        formatter.unitsStyle = .full
        let relative = formatter.localizedString(for: date, relativeTo: Date())
        return VehicleTwinStrings.format("vehicles.twin.updated", "Updated %@", relative)
    }
}

//
//  VehicleSpecsWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
//
//  Pure projection builder — the unit-tested cached→projection adapter, a faithful
//  Swift port of the `entries` useMemo + `CompactView` in
//  features/dashboard/widgets/VehicleSpecsWidget.tsx (the `??` fallback chains,
//  the option decode + 8-row slice, and the `hasAnyData` flag). No SwiftUI /
//  transport here — this is the deterministic core iOS, iPadOS, macOS, and the
//  web all agree on.
//

import Foundation

/// Pure adapters that normalize the raw specs / options / config envelopes into a
/// `SpecsProjection`. Mirrors the web source exactly so every platform shows the
/// same model, trim, paint, wheels, interior, aux battery, car version, and
/// decoded option rows.
public enum SpecsProjectionBuilder {
    private static let dash = SpecsProjectionConstants.dash
    private static let optionLimit = SpecsProjectionConstants.optionLimit

    // MARK: Build (web body)

    /// Builds the full projection from the three raw envelopes. `hasData` mirrors
    /// the web `specs !== null || options !== null || configData !== null`, so a
    /// present-but-empty envelope still counts as data (the rows render as `'—'`).
    public static func build(
        specs: RawVehicleSpecs?,
        config: RawVehicleConfig?,
        options: [SpecOption]?,
        labels: SpecsLabels
    ) -> SpecsProjection {
        let hasData = specs != nil || config != nil || options != nil
        return SpecsProjection(
            entries: buildEntries(specs: specs, config: config, options: options, labels: labels),
            compact: buildCompact(specs: specs, config: config),
            hasData: hasData
        )
    }

    // MARK: Entries (web `entries` useMemo)

    /// The 7 fixed rows (always pushed, web `'—'`-filled) + up to 8 decoded option
    /// rows. Faithful to the web `??` precedence on every row.
    static func buildEntries(
        specs: RawVehicleSpecs?,
        config: RawVehicleConfig?,
        options: [SpecOption]?,
        labels: SpecsLabels
    ) -> [SpecEntry] {
        var items: [SpecEntry] = []

        let model = specs?.carType.asString ?? specs?.model.asString ?? config?.carType.asString
        items.append(SpecEntry(label: labels.model, value: model ?? dash))

        let trim = specs?.trimBadging.asString ?? specs?.trim.asString ?? config?.trim.asString
        items.append(SpecEntry(label: labels.trim, value: trim ?? dash))

        let paint = specs?.exteriorColor.asString ?? config?.exteriorColor.asString
        items.append(SpecEntry(label: labels.paint, value: paint ?? dash))

        let wheels = specs?.wheelType.asString ?? config?.wheelType.asString
        items.append(SpecEntry(label: labels.wheels, value: wheels ?? dash))

        let interior = specs?.interior.asString ?? specs?.interiorColor.asString
        items.append(SpecEntry(label: labels.interior, value: interior ?? dash))

        let auxBattery = specs?.auxBatteryType.asString
        items.append(SpecEntry(label: labels.auxBattery, value: auxBattery ?? dash))

        let carVersion = config?.version.asString ?? specs?.carVersion.asString
        items.append(SpecEntry(label: labels.carVersion, value: carVersion ?? dash, mono: true))

        items.append(contentsOf: optionEntries(options, labels: labels))
        return items
    }

    /// Web `Object.keys(options).slice(0, 8)` → each row's value is
    /// `asString(options[key]) ?? key`, badged `"Option"`. (The compact view caps
    /// the slice at 0; it renders `CompactView`, not these rows — so the full-view
    /// projection always carries up to 8.)
    private static func optionEntries(_ options: [SpecOption]?, labels: SpecsLabels) -> [SpecEntry] {
        guard let options else { return [] }
        return options.prefix(optionLimit).map { option in
            SpecEntry(
                label: option.key,
                value: option.value.asString ?? option.key,
                badge: labels.option
            )
        }
    }

    // MARK: Compact (web `CompactView`)

    /// Web `CompactView` headline: model + trim, each resolved through the same
    /// `??` chain as the full rows and `'—'`-filled when missing.
    static func buildCompact(specs: RawVehicleSpecs?, config: RawVehicleConfig?) -> SpecsCompact {
        let model = specs?.carType.asString ?? specs?.model.asString ?? config?.carType.asString ?? dash
        let trim = specs?.trimBadging.asString ?? specs?.trim.asString ?? config?.trim.asString ?? dash
        return SpecsCompact(model: model, trim: trim)
    }
}

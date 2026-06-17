//
//  GeofencesPageFormat.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — Formatting + pure logic
//
//  The native peers of the web page's display helpers (`fmtNumber`) and its
//  module-scope logic (the `stats` memo, the `useFilteredList` name filter, the
//  pinned-order sort, and the zod `geofenceFormSchema` → payload pipeline). All
//  pure + unit-testable; coordinates/radius are SI and only formatted at the
//  display boundary here. Validation messages resolve from the string catalog so
//  no field error is a hardcoded literal.
//

import Foundation

// MARK: - Display formatting (web `fmtNumber`)

/// Locale-aware number + coordinate formatting at the display boundary — the
/// native peer of the web page's `fmtNumber`.
enum GeofencesFormat {
    /// The em-dash the web renders for missing values (`'—'`).
    static let dash = "—"

    /// Web `fmtNumber(value, fractionDigits)` — grouped, fixed fraction digits.
    static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// Web `fmtNumber(value)` grouped integer.
    static func integer(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Web `{fmtNumber(lat, 6)}, {fmtNumber(lng, 6)}` — a six-decimal coordinate pair.
    static func coordinate(latitude: Double, longitude: Double) -> String {
        "\(number(latitude, fractionDigits: 6)), \(number(longitude, fractionDigits: 6))"
    }

    /// Web `{g.radius}{t('m')}` — the metre radius with its unit suffix (SI).
    static func radius(_ metres: Double) -> String {
        let unit = String(localized: "m", defaultValue: "m")
        let rounded = metres.rounded()
        let value = abs(rounded - metres) < 0.0001 ? integer(Int(rounded)) : number(metres, fractionDigits: 1)
        return "\(value)\(unit)"
    }
}

// MARK: - Pure logic (web `stats`, `useFilteredList`, pinned sort, schema → payload)

/// Native peers of the web page's pure derivations + the zod validation pipeline.
enum GeofencesMath {
    // MARK: Stats (web `stats` memo)

    /// Web `stats`: total / active / entry-alert / exit-alert counts over the list.
    static func stats(for zones: [GeofenceZone]) -> GeofencesStats {
        GeofencesStats(
            total: zones.count,
            active: zones.filter(\.enabled).count,
            entryAlerts: zones.filter(\.alertOnEntry).count,
            exitAlerts: zones.filter(\.alertOnExit).count
        )
    }

    // MARK: Search filter (web `useFilteredList(geofences, search, ['name'])`)

    /// Web name filter: case-insensitive substring match on `name`; an empty query
    /// passes everything.
    static func filtered(_ zones: [GeofenceZone], search: String) -> [GeofenceZone] {
        let needle = GeofencesText.trim(search).lowercased()
        guard !needle.isEmpty else { return zones }
        return zones.filter { $0.name.lowercased().contains(needle) }
    }

    // MARK: Pinned ordering (web `sortedGeofences` memo)

    /// Web `sortedGeofences`: float pinned fences to the top in pin order, keeping
    /// the relative order of everything else (a stable sort by pin position).
    static func pinnedSorted(_ zones: [GeofenceZone], pins: [GeofencesPinnedItem]) -> [GeofenceZone] {
        guard !pins.isEmpty else { return zones }
        var order: [String: Int] = [:]
        for pin in pins {
            order[pin.itemID] = pin.position
        }
        return zones.enumerated().sorted { lhs, rhs in
            let lp = order[lhs.element.id]
            let rp = order[rhs.element.id]
            switch (lp, rp) {
            case let (left?, right?): return left == right ? lhs.offset < rhs.offset : left < right
            case (_?, nil): return true
            case (nil, _?): return false
            case (nil, nil): return lhs.offset < rhs.offset
            }
        }.map(\.element)
    }

    // MARK: Validation (web zod `geofenceFormSchema`)

    /// Web `geofenceFormSchema.safeParse` — returns inline field errors keyed by
    /// field (empty when valid). Messages resolve from the catalog.
    static func validate(_ form: GeofencesFormData) -> [GeofencesFormField: String] {
        var errors: [GeofencesFormField: String] = [:]

        let name = GeofencesText.trim(form.name)
        if name.isEmpty {
            errors[.name] = String(localized: "geofences.validation.nameRequired", defaultValue: "Name is required")
        } else if name.count > 120 {
            errors[.name] = String(localized: "geofences.error.nameTooLong", defaultValue: "Max 120 characters")
        }

        if let latError = numberError(
            form.latitude, range: -90 ... 90,
            required: String(localized: "geofences.validation.latitudeRequired", defaultValue: "Latitude is required"),
            outOfRange: String(
                localized: "geofences.validation.latitudeRange",
                defaultValue: "Latitude must be between -90 and 90"
            )
        ) {
            errors[.latitude] = latError
        }
        if let lonError = numberError(
            form.longitude, range: -180 ... 180,
            required: String(
                localized: "geofences.validation.longitudeRequired",
                defaultValue: "Longitude is required"
            ),
            outOfRange: String(
                localized: "geofences.validation.longitudeRange",
                defaultValue: "Longitude must be between -180 and 180"
            )
        ) {
            errors[.longitude] = lonError
        }
        if let radiusError = numberError(
            form.radius, range: 10 ... 50000,
            required: String(localized: "geofences.validation.radiusRequired", defaultValue: "Radius is required"),
            outOfRange: String(
                localized: "geofences.validation.radiusRange",
                defaultValue: "Radius must be between 10 and 50000"
            )
        ) {
            errors[.radius] = radiusError
        }
        return errors
    }

    /// Web `numericString(...).refine(...)` for one field: required → range check.
    /// Returns the localized message to show, or `nil` when the value is valid.
    private static func numberError(
        _ raw: String,
        range: ClosedRange<Double>,
        required: String,
        outOfRange: String
    ) -> String? {
        let trimmed = GeofencesText.trim(raw)
        if trimmed.isEmpty { return required }
        guard let value = Double(trimmed), value.isFinite, range.contains(value) else {
            return outOfRange
        }
        return nil
    }

    /// Web `toGeofencePayload(parsed.data)` + `costPerKwh: null` — only called on a
    /// clean parse, so the force-unwraps are guarded by `validate` returning empty.
    static func payload(from form: GeofencesFormData) -> GeofenceZonePayload? {
        guard validate(form).isEmpty,
              let latitude = Double(GeofencesText.trim(form.latitude)),
              let longitude = Double(GeofencesText.trim(form.longitude)),
              let radius = Double(GeofencesText.trim(form.radius))
        else { return nil }
        return GeofenceZonePayload(
            name: GeofencesText.trim(form.name),
            latitude: latitude,
            longitude: longitude,
            radius: radius,
            alertOnEntry: form.alertType.alertOnEntry,
            alertOnExit: form.alertType.alertOnExit,
            enabled: form.enabled,
            costPerKwh: nil
        )
    }
}

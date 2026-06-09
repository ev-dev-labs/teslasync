//
//  SafetyFeaturesWidget.Cells.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  The pure cell projection + accessibility seam, split out of the adapter so each
//  file stays focused: `SafetyCellsBuilder` is the faithful port of the web
//  `buildCells` (the eight ordered ADAS rows + the `activeCount`), and
//  `SafetyAccessibility` builds the VoiceOver summaries for the cells, the grid,
//  and the compact active-feature hero. Both are pure + dependency-free (every
//  string resolves through an injected localizer) so they unit-test without a
//  store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Cell projection (web `buildCells`)

/// Builds the eight status cells from the cached snapshot, resolving every
/// label/value through the injected localizer (so it is bundle-free in tests).
/// Returns `[]` when there is no snapshot — exactly the web `data ? buildCells :
/// []`, which drives the empty state.
public enum SafetyCellsBuilder {
    /// Cell order is the web `buildCells` order: fcw, aeb, lda, elda, bsc, bscw,
    /// slw, cfd. Kept stable for the active-feature count + grid diffing.
    public static func build(
        latest: SafetyLatestInput?,
        localize: (String, String) -> String
    ) -> [SafetyStatusCell] {
        guard let latest else { return [] }
        return [
            forwardCollisionCell(latest, localize),
            emergencyBrakingCell(latest, localize),
            laneDepartureCell(latest, localize),
            emergencyLaneDepartureCell(latest, localize),
            blindSpotCameraCell(latest, localize),
            blindSpotWarningCell(latest, localize),
            speedLimitCell(latest, localize),
            cruiseFollowCell(latest, localize)
        ]
    }

    /// Active-feature count (web `cells.filter((c) => c.status === 'ok').length`).
    public static func activeCount(_ cells: [SafetyStatusCell]) -> Int {
        cells.reduce(into: 0) { count, cell in
            if cell.status == .ok { count += 1 }
        }
    }

    // MARK: Enum-field cells

    private static func forwardCollisionCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        enumCell(
            id: "fcw",
            label: localize("widget.safety.fcw", "Forward Collision Warning"),
            value: latest.forwardCollisionWarning,
            field: .forwardCollisionWarning,
            localize
        )
    }

    private static func laneDepartureCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        enumCell(
            id: "lda",
            label: localize("widget.safety.lda", "Lane Departure Avoidance"),
            value: latest.laneDepartureAvoidance,
            field: .laneDepartureAvoidance,
            localize
        )
    }

    private static func speedLimitCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        enumCell(
            id: "slw",
            label: localize("widget.safety.slw", "Speed Limit Warning"),
            value: latest.speedLimitWarning,
            field: .speedLimitWarning,
            localize
        )
    }

    private static func cruiseFollowCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        enumCell(
            id: "cfd",
            label: localize("widget.safety.cfd", "Cruise Follow Distance"),
            value: latest.cruiseFollowDistance,
            field: .cruiseFollowDistance,
            localize
        )
    }

    private static func enumCell(
        id: String,
        label: String,
        value: SafetySignalValue,
        field: SafetyEnumField,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        SafetyStatusCell(
            id: id,
            label: label,
            value: displayValue(value, field: field, localize: localize),
            status: SafetyStatusMapper.safetyEnumStatus(value, field: field)
        )
    }

    // MARK: Boolean-field cells

    private static func emergencyBrakingCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        // Field is an "off" flag (web `automatic_emergency_braking_off`): when set
        // the feature is Disabled, so the value mapping is inverted vs the others.
        SafetyStatusCell(
            id: "aeb",
            label: localize("widget.safety.aeb", "Auto Emergency Braking"),
            value: invertedEnabledValue(latest.automaticEmergencyBrakingOff, localize),
            status: SafetyStatusMapper.invertedBoolStatus(latest.automaticEmergencyBrakingOff)
        )
    }

    private static func emergencyLaneDepartureCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        boolCell(
            id: "elda",
            label: localize("widget.safety.elda", "Emergency Lane Departure"),
            value: latest.emergencyLaneDepartureAvoidance,
            localize
        )
    }

    private static func blindSpotCameraCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        boolCell(
            id: "bsc",
            label: localize("widget.safety.bsc", "Blind Spot Camera"),
            value: latest.automaticBlindSpotCamera,
            localize
        )
    }

    private static func blindSpotWarningCell(
        _ latest: SafetyLatestInput,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        boolCell(
            id: "bscw",
            label: localize("widget.safety.bscw", "Blind Spot Collision Warning"),
            value: latest.blindSpotCollisionWarning,
            localize
        )
    }

    private static func boolCell(
        id: String,
        label: String,
        value: Bool?,
        _ localize: (String, String) -> String
    ) -> SafetyStatusCell {
        SafetyStatusCell(
            id: id,
            label: label,
            value: enabledValue(value, localize),
            status: SafetyStatusMapper.boolStatus(value)
        )
    }

    // MARK: Value formatting (localized)

    /// Display value for an enum field: the canonical cleaned string, with the
    /// `On`/`Off` words routed through the localizer (everything else is data).
    static func displayValue(
        _ value: SafetySignalValue,
        field: SafetyEnumField,
        localize: (String, String) -> String
    ) -> String {
        let raw = SafetyEnum.cleanRaw(value, field: field, fallback: SafetyEnum.emptyValue)
        switch raw {
        case "On": return localize("widget.safety.on", "On")
        case "Off": return localize("widget.safety.off", "Off")
        default: return raw
        }
    }

    /// Web bool value mapping: `null → '—'`, `true → Enabled`, `false → Disabled`.
    static func enabledValue(_ value: Bool?, _ localize: (String, String) -> String) -> String {
        guard let value else { return SafetyEnum.emptyValue }
        return value
            ? localize("widget.safety.enabled", "Enabled")
            : localize("widget.safety.disabled", "Disabled")
    }

    /// Web inverted "off"-flag mapping: `null → '—'`, `true → Disabled`,
    /// `false → Enabled` (web `automatic_emergency_braking_off`).
    static func invertedEnabledValue(_ value: Bool?, _ localize: (String, String) -> String) -> String {
        guard let value else { return SafetyEnum.emptyValue }
        return value
            ? localize("widget.safety.disabled", "Disabled")
            : localize("widget.safety.enabled", "Enabled")
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the grid, each cell, and the compact
/// active-count hero. Pure + public so the spoken content can be unit-tested
/// without rendering the view.
public enum SafetyAccessibility {
    /// Per-cell label, e.g. "Forward Collision Warning, On, Active".
    public static func cellSummary(
        for cell: SafetyStatusCell,
        localize: (String, String) -> String
    ) -> String {
        "\(cell.label), \(cell.value), \(cell.status.accessibilityWord(localize: localize))"
    }

    /// The whole-grid summary spoken for the content container, joining each cell
    /// so VoiceOver can read the ADAS posture in one pass.
    public static func gridSummary(
        for cells: [SafetyStatusCell],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("widget.safety.title", "Safety Features")
        guard !cells.isEmpty else {
            return "\(title). \(localize("widget.safety.noData", "No safety data"))"
        }
        let body = cells
            .map { "\($0.label): \($0.value)" }
            .joined(separator: ". ")
        return "\(title). \(body)"
    }

    /// The compact hero summary, e.g. "3 Active Features".
    public static func activeCountSummary(
        _ count: Int,
        localize: (String, String) -> String
    ) -> String {
        "\(count.formatted()) \(localize("widget.safety.activeFeatures", "Active Features"))"
    }
}

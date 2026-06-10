//
//  KioskSettingsModal.Projection.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The dependency-free projection core for the kiosk-settings modal — the faithful port of the web
//  component's selection logic, its conditional render branches, the live-preview math, and the
//  slider ↔ config conversions. Pure Foundation so the initial dashboard selection, the keep-at-least-
//  one toggle rule, the four conditional reveals, the preview swatch opacities / blur, the percent ↔
//  fraction slider mapping, the body phase, and the enter payload are all unit-tested without a
//  bundle or a rendered view. The config model + option catalogs live in
//  KioskSettingsModal.Adapter.swift; the state holder that drives these lives in
//  KioskSettingsModal.Model.swift.
//

import Foundation

/// The dependency-free resolution from the saved-dashboard list + the draft config to the rotation
/// selection, the conditional reveals, the preview swatch, the slider values, the phase, and the
/// enter payload — plus the pure mutators the model applies.
public enum KioskSettingsProjection {
    // MARK: Rotation selection (web `selectedIds`)

    /// The initial rotation selection (web
    /// `new Set(config.dashboardIds.length > 0 ? config.dashboardIds : dashboards.map(d => d.id))`),
    /// sanitized against the dashboards that actually exist. Falls back to every dashboard when the
    /// saved ids no longer resolve, so a stale persisted id never empties the list.
    public static func initialSelection(config: KioskConfig, dashboards: [KioskDashboard]) -> Set<String> {
        let available = Set(dashboards.map(\.id))
        let saved = config.dashboardIds.filter { available.contains($0) }
        if saved.isEmpty {
            return available
        }
        return Set(saved)
    }

    /// Re-sanitizes a selection against a changed dashboard list (drop ids that vanished); falls back
    /// to every dashboard when nothing survives, so the rotation list is never left empty.
    public static func sanitizedSelection(_ selection: Set<String>, dashboards: [KioskDashboard]) -> Set<String> {
        let available = Set(dashboards.map(\.id))
        let kept = selection.intersection(available)
        return kept.isEmpty ? available : kept
    }

    /// Toggles one dashboard in the rotation (web `toggleDashboard`): selecting an unselected id, or
    /// deselecting a selected one only while more than one remains (the rotation always keeps at
    /// least one dashboard). Returns the new selection unchanged when the rule blocks the removal.
    public static func toggling(_ selection: Set<String>, id: String) -> Set<String> {
        var next = selection
        if next.contains(id) {
            if next.count > 1 {
                next.remove(id)
            }
        } else {
            next.insert(id)
        }
        return next
    }

    /// The selected ids in the dashboards' display order (web `Array(selectedIds)`, made
    /// deterministic by following the rendered list order rather than the set's hash order).
    public static func orderedIds(_ selection: Set<String>, dashboards: [KioskDashboard]) -> [String] {
        dashboards.map(\.id).filter { selection.contains($0) }
    }

    // MARK: Conditional reveals (web `&&` render branches)

    /// Whether the "Dashboards to Rotate" checklist shows (web
    /// `config.rotateInterval > 0 && dashboards.length > 1`).
    public static func showsRotationList(rotateInterval: Int, dashboardCount: Int) -> Bool {
        rotateInterval > 0 && dashboardCount > 1
    }

    /// Whether the cursor "Hide After" picker shows (web `config.hideCursor && …`).
    public static func showsCursorTimeout(hideCursor: Bool) -> Bool {
        hideCursor
    }

    /// Whether the "Dimmed Brightness" slider shows (web `config.dimAfter > 0 && …`).
    public static func showsDimBrightness(dimAfter: Int) -> Bool {
        dimAfter > 0
    }

    /// Whether the "Clock Position" picker shows (web `config.showClock && …`).
    public static func showsClockPosition(showClock: Bool) -> Bool {
        showClock
    }

    // MARK: Live preview math (web swatch `style`)

    /// The preview background opacity (web `rgba(10,10,20, backgroundOpacity)` alpha), clamped to 0…1.
    public static func backgroundSwatchOpacity(_ backgroundOpacity: Double) -> Double {
        clampFraction(backgroundOpacity)
    }

    /// The preview widget-panel opacity (web `rgba(255,255,255, 0.03 + widgetOpacity * 0.17)` alpha).
    public static func widgetSwatchOpacity(_ widgetOpacity: Double) -> Double {
        0.03 + clampFraction(widgetOpacity) * 0.17
    }

    /// The preview widget-panel blur radius in points (web `blur(4 + widgetOpacity * 12)`).
    public static func widgetSwatchBlur(_ widgetOpacity: Double) -> Double {
        4 + clampFraction(widgetOpacity) * 12
    }

    // MARK: Slider ↔ config conversion (web `Math.round(x * 100)` / `n / 100`)

    /// A 0…1 fraction rendered as an integer percent (web `Math.round((value ?? 1) * 100)`).
    public static func percent(fromFraction fraction: Double) -> Int {
        Int((clampFraction(fraction) * 100).rounded())
    }

    /// An integer percent converted back to a 0…1 fraction (web `n / 100`).
    public static func fraction(fromPercent percent: Int) -> Double {
        Double(percent) / 100
    }

    /// Clamps a slider percent to its inclusive bounds before it is mapped back to a fraction, so an
    /// out-of-range value can never escape the web `min` / `max`.
    public static func clampedPercent(_ percent: Int, in bounds: KioskSliderBounds) -> Int {
        Swift.min(Swift.max(percent, bounds.min), bounds.max)
    }

    // MARK: Phase + inline failure

    /// The dialog body phase. Loading shows only before any dashboards resolve; once a list is on
    /// hand the populated form stays (a failed reload keeps the cached list rather than flashing the
    /// error envelope), and a first-load failure with no cached list shows the error state. A
    /// resolved-but-empty list is the friendly empty state (kiosk has nothing to display).
    public static func phase(status: KioskLoadStatus, hasDashboards: Bool) -> KioskPhase {
        switch status {
        case .loading:
            hasDashboards ? .populated : .loading
        case .loaded:
            hasDashboards ? .populated : .empty
        case let .failed(message):
            hasDashboards ? .populated : .error(message)
        }
    }

    /// The failure message kept on screen while a cached list survives a failed reload (the inline
    /// banner above the form), else `nil`.
    public static func inlineFailure(status: KioskLoadStatus, hasDashboards: Bool) -> String? {
        guard hasDashboards, case let .failed(message) = status else { return nil }
        return message
    }

    // MARK: Enter payload (web `onUpdateConfig({ dashboardIds }) → onEnterKiosk`)

    /// The config committed when the operator taps "Enter Kiosk Mode" (web `handleEnter`): the draft
    /// config with `dashboardIds` set from the current rotation selection in display order.
    public static func enterPayload(
        config: KioskConfig,
        selection: Set<String>,
        dashboards: [KioskDashboard]
    ) -> KioskConfig {
        var next = config
        next.dashboardIds = orderedIds(selection, dashboards: dashboards)
        return next
    }

    // MARK: Helpers

    /// Clamps a value into the 0…1 fraction range used by the opacity / dim fields.
    private static func clampFraction(_ value: Double) -> Double {
        Swift.min(Swift.max(value, 0), 1)
    }
}

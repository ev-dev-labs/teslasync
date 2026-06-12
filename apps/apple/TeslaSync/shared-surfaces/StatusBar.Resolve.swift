//
//  StatusBar.Resolve.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The pure projection from the bound ``StatusBarInput`` to the resolved ``StatusBarPresentation`` — the
//  native peer of everything the web `StatusBar.tsx` + its six segment components compute per render: the
//  prefs-driven visibility, the `compact || iconOnly || isNarrow` density, each segment's tone / icon /
//  labels / fallbacks, and the container's offline / stale / error / loading / empty branches. The view is a
//  pure function of this value; every branch is unit tested in StatusBar.AdapterTests.swift.
//

import Foundation

/// Pure projection from the bound input to the resolved presentation. Runs the prefs gate, the density
/// rule, and each segment's verbatim per-render logic.
public enum StatusBarProjection {
    /// Projects the input into the resolved presentation.
    public static func resolve(input: StatusBarInput, localize: StatusBarLocalize) -> StatusBarPresentation {
        let iconOnly = input.resolvedIconOnly
        let connection = resolveConnection(input, iconOnly: iconOnly, localize: localize)
        let live = resolveLive(input, iconOnly: iconOnly, localize: localize)
        let vehicle = resolveVehicle(input, localize: localize)
        let background = resolveBackground(input, localize: localize)
        let isOffline = input.connectivity == .offline
        let isError = connection.isError && !isOffline
        let isEmpty = vehicle.mode == .hidden && !background.isVisible && input.phase == .ready
        return StatusBarPresentation(
            isHidden: !input.prefs.enabled,
            iconOnly: iconOnly,
            phase: input.phase,
            isOffline: isOffline,
            isStale: live.isStale,
            isError: isError,
            isEmpty: isEmpty,
            connection: connection,
            live: live,
            vehicle: vehicle,
            background: background,
            help: resolveHelp(localize: localize),
            version: resolveVersion(input, iconOnly: iconOnly, localize: localize),
            accessibilityLabel: localize("statusBar.aria", "Application status"),
            offlineChipLabel: localize("statusBar.offline", "Offline"),
            staleChipLabel: localize("statusBar.stale", "Stale data"),
            errorChipLabel: localize("statusBar.error", "Backend unreachable"),
            loadingLabel: localize("statusBar.loading", "Loading status"),
            emptyLabel: localize("statusBar.empty", "No active vehicle or background work"),
            retryLabel: localize("statusBar.retry", "Retry")
        )
    }
}

// MARK: - Connection (web ConnectionSegment)

extension StatusBarProjection {
    static func resolveConnection(
        _ input: StatusBarInput,
        iconOnly: Bool,
        localize: StatusBarLocalize
    ) -> StatusBarConnectionVM {
        let status = input.apiHealth
        let stateLabel = connectionStateLabel(status, localize: localize)
        let latencyText = input.latencyMs.map { "\($0)ms" }
        let tooltipBase = localize("statusBar.connection.tooltip", "API connection")
        let showTooltipLatency = latencyText != nil && status != .offline
        var tooltip = "\(tooltipBase) · \(stateLabel)"
        if let latencyText, showTooltipLatency { tooltip += " · \(latencyText)" }
        let ariaBase = localize("statusBar.connection.aria", "API connection status")
        var aria = "\(ariaBase): \(stateLabel)"
        if let latencyText, showTooltipLatency { aria += " (\(latencyText))" }
        let showsLatency = !iconOnly && (status == .ok || status == .degraded) && latencyText != nil
        return StatusBarConnectionVM(
            tone: .forApiHealth(status),
            symbol: connectionSymbol(status),
            shortLabel: localize("statusBar.connection.short", "API"),
            stateLabel: stateLabel,
            latencyText: latencyText,
            showsLatency: showsLatency,
            offlineSuffix: (!iconOnly && status == .offline) ? stateLabel : nil,
            tooltip: tooltip,
            accessibilityLabel: aria,
            route: "/system-status",
            isError: status == .offline
        )
    }

    private static func connectionStateLabel(_ status: StatusBarApiHealth, localize: StatusBarLocalize) -> String {
        switch status {
        case .ok: localize("statusBar.connection.ok", "Online")
        case .degraded: localize("statusBar.connection.degraded", "Degraded")
        case .offline: localize("statusBar.connection.offline", "Offline")
        case .unknown: localize("statusBar.connection.unknown", "Connecting…")
        }
    }

    private static func connectionSymbol(_ status: StatusBarApiHealth) -> String {
        switch status {
        case .ok: "antenna.radiowaves.left.and.right"
        case .degraded: "exclamationmark.triangle.fill"
        case .offline: "xmark.circle.fill"
        case .unknown: "questionmark.circle"
        }
    }
}

// MARK: - Live telemetry (web LiveTelemetrySegment)

extension StatusBarProjection {
    static func resolveLive(
        _ input: StatusBarInput,
        iconOnly: Bool,
        localize: StatusBarLocalize
    ) -> StatusBarLiveVM {
        let status = input.liveStatus
        let shortLabel = liveShortLabel(status, localize: localize)
        let tooltipBase = localize("statusBar.live.tooltip", "Live telemetry stream")
        let ageForTooltip = input.lastMessageAt.map { StatusBarFormat.ageLabel(since: $0, now: input.now) }
            ?? StatusBarFormat.dash
        let tooltip = if status == .connected {
            "\(tooltipBase) · " + StatusBarInterpolation.format(
                localize("statusBar.live.lastMessage", "Last message {{age}} ago"), ["age": ageForTooltip]
            )
        } else {
            "\(tooltipBase) · \(shortLabel)"
        }
        let ageText: String? = (status == .connected && input.lastMessageAt != nil && !iconOnly)
            ? input.lastMessageAt.map { StatusBarFormat.ageLabel(since: $0, now: input.now) }
            : nil
        return StatusBarLiveVM(
            tone: .forLiveStatus(status),
            symbol: liveSymbol(status),
            spins: status == .reconnecting,
            shortLabel: shortLabel,
            ageText: ageText,
            tooltip: tooltip,
            accessibilityLabel: "\(localize("statusBar.live.aria", "Live telemetry status")): \(shortLabel)",
            route: "/signal-diff",
            isStale: status == .stale
        )
    }

    private static func liveShortLabel(_ status: StatusBarLiveStatus, localize: StatusBarLocalize) -> String {
        switch status {
        case .connected: localize("statusBar.live.short", "Live")
        case .reconnecting: localize("statusBar.live.reconnecting", "Reconnecting")
        case .disconnected: localize("statusBar.live.offline", "Offline")
        case .stale: localize("statusBar.live.stale", "Stale")
        case .unknown: localize("statusBar.live.unknown", "Idle")
        }
    }

    private static func liveSymbol(_ status: StatusBarLiveStatus) -> String {
        switch status {
        case .connected: "wifi"
        case .reconnecting: "arrow.triangle.2.circlepath"
        case .disconnected: "wifi.slash"
        case .stale: "wifi.exclamationmark"
        case .unknown: "wifi.slash"
        }
    }
}

// MARK: - Active vehicle (web ActiveVehicleSegment)

extension StatusBarProjection {
    static func resolveVehicle(_ input: StatusBarInput, localize: StatusBarLocalize) -> StatusBarVehicleVM {
        let vehicleWord = localize("statusBar.vehicle.fallback", "Vehicle")
        let selected = input.vehicles.first { $0.id == input.selectedVehicleID }
        let label = vehicleLabel(input, selected: selected, vehicleWord: vehicleWord, localize: localize)
        let metricsText = vehicleMetrics(input)
        let tooltipBase = localize("statusBar.vehicle.tooltip", "Active vehicle")
        var tooltip = "\(tooltipBase) · \(label)"
        if let sub = selected?.model, !sub.isEmpty { tooltip += " · \(sub)" }
        if let metricsText { tooltip += " · \(metricsText)" }
        let activeWord = localize("statusBar.vehicle.aria", "Active vehicle")
        let options = input.vehicles.map { ref in
            StatusBarVehicleOption(
                id: ref.id,
                name: ref.resolvedName(vehicleFallback: vehicleWord),
                model: ref.model,
                isSelected: ref.id == input.selectedVehicleID
            )
        }
        return StatusBarVehicleVM(
            mode: vehicleMode(count: input.vehicles.count),
            label: label,
            subLabel: selected?.model,
            metricsText: metricsText,
            tooltip: tooltip,
            accessibilityLabel: "\(activeWord): \(label)",
            switchAccessibilityLabel: "\(localize("statusBar.vehicle.switch", "Switch vehicle")) (\(label))",
            listAccessibilityLabel: activeWord,
            options: options
        )
    }

    private static func vehicleMode(count: Int) -> StatusBarVehicleMode {
        if count == 0 { return .hidden }
        return count == 1 ? .staticChip : .switcher
    }

    private static func vehicleLabel(
        _ input: StatusBarInput,
        selected: StatusBarVehicleRef?,
        vehicleWord: String,
        localize: StatusBarLocalize
    ) -> String {
        if let selected { return selected.resolvedName(vehicleFallback: vehicleWord) }
        if let id = input.selectedVehicleID { return "\(vehicleWord) \(id)" }
        return localize("statusBar.vehicle.none", "No vehicle")
    }

    private static func vehicleMetrics(_ input: StatusBarInput) -> String? {
        guard input.hasVehicleState else { return nil }
        let battery = input.batteryLevel ?? 0
        let distance = StatusBarFormat.distance(meters: input.ratedRangeMeters ?? 0, unit: input.distanceUnit)
        return "\(battery)% · \(distance) \(input.distanceUnit.symbol)"
    }
}

// MARK: - Background work (web BackgroundWorkSegment)

extension StatusBarProjection {
    static func resolveBackground(_ input: StatusBarInput, localize: StatusBarLocalize) -> StatusBarBackgroundVM {
        let count = input.jobs.count
        let summary = count == 1
            ? localize("statusBar.background.one", "1 task")
            : StatusBarInterpolation.format(
                localize("statusBar.background.many", "{{count}} tasks"), ["count": String(count)]
            )
        let rows = input.jobs.map { StatusBarJobRow(id: $0.id, kind: $0.kind, label: $0.label, detail: $0.detail) }
        let aria = localize("statusBar.background.aria", "Background tasks")
        return StatusBarBackgroundVM(
            isVisible: !input.jobs.isEmpty,
            summary: summary,
            tooltip: "\(localize("statusBar.background.tooltip", "Background work in progress")) · \(summary)",
            accessibilityLabel: "\(aria): \(summary)",
            heading: localize("statusBar.background.heading", "Running"),
            jobs: rows
        )
    }
}

// MARK: - Help (web HelpSegment)

extension StatusBarProjection {
    static func resolveHelp(localize: StatusBarLocalize) -> StatusBarHelpVM {
        StatusBarHelpVM(
            shortcuts: StatusBarHelpAction(
                tooltip: localize("shortcuts.tooltip", "Keyboard shortcuts"),
                accessibilityLabel: localize("shortcuts.openAria", "Open keyboard shortcuts"),
                label: localize("shortcuts.hintSuffix", "for shortcuts")
            ),
            shortcutKeyCap: "?",
            tour: StatusBarHelpAction(
                tooltip: localize("tour.launcher.openShort", "Take a tour"),
                accessibilityLabel: localize("tour.launcher.openAria", "Open tour launcher"),
                label: localize("tour.launcher.openShort", "Take a tour")
            ),
            feedback: StatusBarHelpAction(
                tooltip: localize("feedback.openShort", "Report bug"),
                accessibilityLabel: localize("feedback.openAria", "Open feedback / bug report form"),
                label: localize("feedback.openShort", "Report bug")
            )
        )
    }
}

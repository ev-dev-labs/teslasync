//
//  SignalExplorerStrings.swift
//  TeslaSync — P4 feature view · P7 · SignalExplorerPage (Apple)
//
//  Central catalog binding each web i18n key to `Localizable.xcstrings`
//  (web key names preserved behind the `translation.` table prefix, ADR-014).
//  One symbol per parity string keeps literals out of the view bodies and gives
//  the parity gate a single citable evidence site per string. The two long copy
//  strings are assembled from short fragments so every source line stays inside
//  the 120-column lint budget while the resolved key still matches the catalog.
//

import Foundation

/// Resolves the SignalExplorer page's 15 parity strings from the shared string
/// catalog. Mirrors the sibling `WSText` (SignalsWorkspace) so the two telemetry
/// pages share one resolution convention (the `translation.` prefix + a web
/// English fallback). All accessors return `String`; the page's view helpers take
/// `String` and render through `Text(verbatim:)` so the catalog stays the single
/// source of truth for every visible literal.
enum SEText {
    /// Resolves `translation.<key>` from `Localizable.xcstrings`, falling back to
    /// the web English `value` if the catalog entry is somehow absent.
    private static func tr(_ key: String, _ value: String) -> String {
        NSLocalizedString("translation.\(key)", bundle: .main, value: value, comment: "")
    }

    /// Web `t('Signal Explorer')` — the page title.
    static var title: String {
        tr("Signal Explorer", "Signal Explorer")
    }

    /// Web `PageContainer subtitle` — the page strapline.
    static var subtitle: String {
        let copy = "Visualise signal history with chart and stats — or stream live"
        return tr(copy, copy)
    }

    /// Web `t('Time Range')` — the range-picker field label.
    static var timeRange: String {
        tr("Time Range", "Time Range")
    }

    /// Web `t('Per Page')` — the page-size select label.
    static var perPage: String {
        tr("Per Page", "Per Page")
    }

    /// Web `t('Explore')` — the run-historical-query action.
    static var explore: String {
        tr("Explore", "Explore")
    }

    /// Web `t('signalExplorer.live', 'Live')` — the start-live-stream action.
    static var live: String {
        tr("signalExplorer.live", "Live")
    }

    /// Web `t('signalExplorer.stopLive', 'Stop live')` — the stop-live action.
    static var stopLive: String {
        tr("signalExplorer.stopLive", "Stop live")
    }

    /// Web `t('Pick signals and click Explore')` — the resting empty-state title.
    static var pickSignalsTitle: String {
        tr("Pick signals and click Explore", "Pick signals and click Explore")
    }

    /// Web resting empty-state body — the "choose up to 5 signals…" hint.
    static var exploreHint: String {
        let copy = "Choose up to 5 signals, set a date range, "
            + "then hit Explore — or toggle Live to stream in real time."
        return tr(copy, copy)
    }

    /// Web `t('signalExplorer.noVehicle', 'Select a vehicle to begin')`.
    static var noVehicle: String {
        tr("signalExplorer.noVehicle", "Select a vehicle to begin")
    }

    /// Web `t('signalExplorer.noVehicleDesc', …)` — the no-vehicle body copy.
    static var noVehicleDesc: String {
        tr(
            "signalExplorer.noVehicleDesc",
            "Pick a vehicle from the picker above to explore its signals."
        )
    }

    /// Web `t('error.loadFailed', 'Failed to load data')` — the error banner lead.
    static var loadFailed: String {
        tr("error.loadFailed", "Failed to load data")
    }

    /// Web `t('help.signal.live.aria', …)` — the live-help VoiceOver label.
    static var liveHelpAria: String {
        tr("help.signal.live.aria", "More info about live signal streaming")
    }

    /// Web `t('liveMonitor.connected', 'Connected')` — the live badge (open).
    static var liveConnected: String {
        tr("liveMonitor.connected", "Connected")
    }

    /// Web `t('liveMonitor.disconnected', 'Disconnected')` — the live badge (closed).
    static var liveDisconnected: String {
        tr("liveMonitor.disconnected", "Disconnected")
    }

    /// The 15 web key names, in manifest order, for the parity coverage test.
    static let rawKeys: [String] = [
        "Choose up to 5 signals, set a date range, "
            + "then hit Explore — or toggle Live to stream in real time.",
        "Explore",
        "Per Page",
        "Pick signals and click Explore",
        "Signal Explorer",
        "Time Range",
        "Visualise signal history with chart and stats — or stream live",
        "error.loadFailed",
        "help.signal.live.aria",
        "liveMonitor.connected",
        "liveMonitor.disconnected",
        "signalExplorer.live",
        "signalExplorer.noVehicle",
        "signalExplorer.noVehicleDesc",
        "signalExplorer.stopLive"
    ]
}

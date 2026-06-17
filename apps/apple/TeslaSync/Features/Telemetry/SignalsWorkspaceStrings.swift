//
//  SignalsWorkspaceStrings.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  Central catalog binding each web i18n key to `Localizable.xcstrings`
//  (web key names preserved behind the `translation.` table prefix, ADR-014).
//  One symbol per parity string keeps literals out of the view bodies and gives
//  the parity gate a single citable evidence site per string. The two longest
//  copy strings resolve straight from the catalog (no inline fallback) so every
//  line stays within the 120-column lint budget.
//

import Foundation

enum WSText {
    // signalsWorkspace.*
    static var title: String {
        String(localized: "translation.signalsWorkspace.title", defaultValue: "Signals")
    }
    static var subtitle: String {
        String(localized: "translation.signalsWorkspace.subtitle")
    }
    static var selected: String {
        String(localized: "translation.signalsWorkspace.selected", defaultValue: "Selected")
    }
    static var mode: String {
        String(localized: "translation.signalsWorkspace.mode", defaultValue: "Mode")
    }
    static var liveRate: String {
        String(localized: "translation.signalsWorkspace.liveRate", defaultValue: "Live rate")
    }
    static var pinned: String {
        String(localized: "translation.signalsWorkspace.pinned", defaultValue: "Pinned signals")
    }
    static var compare: String {
        String(localized: "translation.signalsWorkspace.compare", defaultValue: "Compare")
    }
    static var live: String {
        String(localized: "translation.signalsWorkspace.live", defaultValue: "Live")
    }
    static var historical: String {
        String(localized: "translation.signalsWorkspace.historical", defaultValue: "Historical")
    }
    static var addSignals: String {
        String(localized: "translation.signalsWorkspace.addSignals", defaultValue: "Add signals")
    }
    static var noneSelected: String {
        String(localized: "translation.signalsWorkspace.noneSelected", defaultValue: "None selected")
    }
    static func signalsSelected(_ count: Int) -> String {
        let format = String(
            localized: "translation.signalsWorkspace.signalsSelected",
            defaultValue: "%lld selected"
        )
        return String(format: format, count)
    }
    static var run: String {
        String(localized: "translation.signalsWorkspace.run", defaultValue: "Run")
    }
    static var stopLive: String {
        String(localized: "translation.signalsWorkspace.stopLive", defaultValue: "Stop live")
    }
    static var exitCompare: String {
        String(localized: "translation.signalsWorkspace.exitCompare", defaultValue: "Exit compare")
    }
    static var chartMode: String {
        String(localized: "translation.signalsWorkspace.chartMode", defaultValue: "Chart layout")
    }
    static var chartAuto: String {
        String(localized: "translation.signalsWorkspace.chartAuto", defaultValue: "Auto")
    }
    static var chartOverlay: String {
        String(localized: "translation.signalsWorkspace.chartOverlay", defaultValue: "Overlay")
    }
    static var chartGrid: String {
        String(localized: "translation.signalsWorkspace.chartGrid", defaultValue: "Grid")
    }
    static var historyTitle: String {
        String(localized: "translation.signalsWorkspace.historyTitle", defaultValue: "Signal history")
    }
    static var emptyTitle: String {
        String(localized: "translation.signalsWorkspace.emptyTitle", defaultValue: "Pick signals and run a query")
    }
    static var emptyDesc: String {
        String(localized: "translation.signalsWorkspace.emptyDesc")
    }
    static var noVehicle: String {
        String(localized: "translation.signalsWorkspace.noVehicle", defaultValue: "Select a vehicle to begin")
    }
    static var noVehicleDesc: String {
        String(
            localized: "translation.signalsWorkspace.noVehicleDesc",
            defaultValue: "Pick a vehicle from the picker above to see its signals."
        )
    }
    static var share: String {
        String(localized: "translation.signalsWorkspace.share", defaultValue: "Share")
    }

    // standalone keys
    static var perPage: String {
        String(localized: "translation.Per Page", defaultValue: "Per Page")
    }
    static var timeRange: String {
        String(localized: "translation.Time Range", defaultValue: "Time Range")
    }
    static var loadFailed: String {
        String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
    }
    static var liveHelpAria: String {
        String(
            localized: "translation.help.signal.live.aria",
            defaultValue: "More info about live and compare modes"
        )
    }

    // liveMonitor.*
    static var liveConnected: String {
        String(localized: "translation.liveMonitor.connected", defaultValue: "Connected")
    }
    static var liveDisconnected: String {
        String(localized: "translation.liveMonitor.disconnected", defaultValue: "Disconnected")
    }
    static var liveTailTitle: String {
        String(localized: "translation.liveMonitor.title", defaultValue: "Live tail")
    }

    // signalDiff.*
    static var bulkPin: String {
        String(localized: "translation.signalDiff.bulk.pin", defaultValue: "Pin selected")
    }
    static var bulkUnpin: String {
        String(localized: "translation.signalDiff.bulk.unpin", defaultValue: "Unpin selected")
    }
    static var bulkCsv: String {
        String(localized: "translation.signalDiff.bulk.csv", defaultValue: "Copy CSV")
    }
    static var bulkAddAlert: String {
        String(localized: "translation.signalDiff.bulk.addAlert", defaultValue: "Add as alert rule")
    }
    static var noChanges: String {
        String(
            localized: "translation.signalDiff.noChanges",
            defaultValue: "No signals changed between the two snapshots"
        )
    }
    static var totalChanged: String {
        String(localized: "translation.signalDiff.totalChanged", defaultValue: "Changed signals")
    }
    static var visibleAfterFilter: String {
        String(localized: "translation.signalDiff.visible", defaultValue: "Visible after filter")
    }
    static var pinnedCount: String {
        String(localized: "translation.signalDiff.pinnedCount", defaultValue: "Pinned")
    }
    static var pinnedLabel: String {
        String(localized: "translation.signalDiff.pinnedLabel", defaultValue: "Pinned:")
    }
    static var windowSpan: String {
        String(localized: "translation.signalDiff.windowSpan", defaultValue: "Window span")
    }

    // signalGap.*
    static var refreshInterval: String {
        String(
            localized: "translation.signalGap.refreshInterval",
            defaultValue: "Catalog refreshes every 5s"
        )
    }
}

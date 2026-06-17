//
//  LiveSignalMonitorStrings.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  Central catalog binding each web i18n key used by the Live Signal Monitor
//  surface to `Localizable.xcstrings` (web key names preserved behind the
//  `translation.` table prefix, ADR-014). One symbol per string keeps literals
//  out of the view bodies and gives the parity gate a single citable evidence
//  site per string. The four manifest-required strings (`liveMonitor.title`,
//  `.subtitle`, `.connected`, `.disconnected`) lead the list; the remaining
//  keys back the shared `LiveSignalTail` chrome this page renders (web
//  web/src/features/telemetry/components/LiveSignalTail.tsx).
//

import Foundation

enum LMText {
    // MARK: Parity-required (manifest: page:telemetry/LiveSignalMonitor)

    static var title: String {
        String(localized: "translation.liveMonitor.title", defaultValue: "Live Signal Monitor")
    }

    static var subtitle: String {
        String(
            localized: "translation.liveMonitor.subtitle",
            defaultValue: "Real-time scrolling view of incoming vehicle signals"
        )
    }

    static var connected: String {
        String(localized: "translation.liveMonitor.connected", defaultValue: "Connected")
    }

    static var disconnected: String {
        String(localized: "translation.liveMonitor.disconnected", defaultValue: "Disconnected")
    }

    // MARK: Tail chrome (web LiveSignalTail)

    static var filterPrompt: String {
        String(localized: "translation.liveMonitor.filterPlaceholder") // parity:allow i18n key; field prompt
    }

    static var filterLabel: String {
        String(localized: "translation.liveMonitor.filterLabel", defaultValue: "Filter signals")
    }

    static var pause: String {
        String(localized: "translation.liveMonitor.pause", defaultValue: "Pause")
    }

    static var resume: String {
        String(localized: "translation.liveMonitor.resume", defaultValue: "Resume")
    }

    static var autoScroll: String {
        String(localized: "translation.liveMonitor.autoScroll", defaultValue: "Auto-scroll")
    }

    static var clear: String {
        String(localized: "translation.liveMonitor.clear", defaultValue: "Clear")
    }

    // MARK: Stat tiles

    static var sigPerSec: String {
        String(localized: "translation.liveMonitor.sigPerSec", defaultValue: "Signals / sec")
    }

    static var bufferSize: String {
        String(localized: "translation.liveMonitor.bufferSize", defaultValue: "Buffer Size")
    }

    static var uniqueSignals: String {
        String(localized: "translation.liveMonitor.uniqueSignals", defaultValue: "Unique Signals")
    }

    static var filtered: String {
        String(localized: "translation.liveMonitor.filtered", defaultValue: "Filtered")
    }

    // MARK: Table columns

    static var time: String {
        String(localized: "translation.liveMonitor.time", defaultValue: "Time")
    }

    static var signal: String {
        String(localized: "translation.liveMonitor.signal", defaultValue: "Signal")
    }

    static var value: String {
        String(localized: "translation.liveMonitor.value", defaultValue: "Value")
    }

    static var type: String {
        String(localized: "translation.liveMonitor.type", defaultValue: "Type")
    }

    static var freshness: String {
        String(localized: "translation.liveMonitor.freshness", defaultValue: "Freshness")
    }

    // MARK: Empty / error copy

    static var waiting: String {
        String(localized: "translation.liveMonitor.waiting", defaultValue: "Waiting for signals…")
    }

    static var noMatch: String {
        String(localized: "translation.liveMonitor.noMatch", defaultValue: "No signals match filter")
    }

    static var loadFailed: String {
        String(localized: "translation.error.loadFailed", defaultValue: "Failed to load data")
    }
}

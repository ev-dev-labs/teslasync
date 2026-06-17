//
//  SmartChargeRateTier.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Tier + status tokens
//
//  Semantic mapping of the wire TOU tier tokens and plan-status strings to the
//  generated design tokens (P2), so the rate timeline bars, the tooltip rate
//  text, and the history status badges all resolve correctly across light / dark
//  / increased-contrast. Mirrors `web/.../RateTimeline.tsx` `tierColors` /
//  `tierTextColors` and the History status color map in `SmartChargePage.tsx`.
//

import SwiftUI

// MARK: - TOU rate tier (web RateTimeline tier tokens)

/// One time-of-use rate tier (web `OFF_PEAK` / `SUPER_OFF_PEAK` / `MID_PEAK` /
/// `ON_PEAK`). `unknown` covers any tier the backend has not classified.
enum SmartChargeRateTier: String, CaseIterable, Identifiable, Equatable, Sendable {
    case offPeak
    case superOffPeak
    case midPeak
    case onPeak
    case unknown

    var id: String { rawValue }

    /// Folds the raw wire token (`OFF_PEAK`, …) onto a tier case.
    init(wire: String) {
        switch wire.uppercased() {
        case "OFF_PEAK": self = .offPeak
        case "SUPER_OFF_PEAK": self = .superOffPeak
        case "MID_PEAK": self = .midPeak
        case "ON_PEAK": self = .onPeak
        default: self = .unknown
        }
    }

    /// The raw wire token (`OFF_PEAK`, …) the backend serves for this tier.
    var wireToken: String {
        switch self {
        case .offPeak: return "OFF_PEAK"
        case .superOffPeak: return "SUPER_OFF_PEAK"
        case .midPeak: return "MID_PEAK"
        case .onPeak: return "ON_PEAK"
        case .unknown: return "UNKNOWN"
        }
    }

    /// The bar fill tone (web `tierColors` — emerald / amber / red surfaces).
    var barColor: Color {
        switch self {
        case .offPeak: return Color.TS.statusSuccess.opacity(0.40)
        case .superOffPeak: return Color.TS.statusSuccess.opacity(0.55)
        case .midPeak: return Color.TS.statusWarning.opacity(0.40)
        case .onPeak: return Color.TS.statusDanger.opacity(0.40)
        case .unknown: return Color.TS.textMuted.opacity(0.30)
        }
    }

    /// The rate-text tone shown in the bar tooltip (web `tierTextColors`).
    var accentColor: Color {
        switch self {
        case .offPeak, .superOffPeak: return Color.TS.statusSuccess
        case .midPeak: return Color.TS.statusWarning
        case .onPeak: return Color.TS.statusDanger
        case .unknown: return Color.TS.textMuted
        }
    }
}

// MARK: - Plan status (web History status color map)

/// The lifecycle state of a saved plan (web `p.status`) driving the History
/// status badge tone (scheduled → accent, completed → success, cancelled →
/// danger, anything else → muted).
enum SmartChargePlanStatus: Equatable, Sendable {
    case scheduled
    case completed
    case cancelled
    case other(String)

    init(wire: String) {
        switch wire.lowercased() {
        case "scheduled": self = .scheduled
        case "completed": self = .completed
        case "cancelled": self = .cancelled
        default: self = .other(wire)
        }
    }

    /// The raw wire token displayed verbatim (web shows `p.status` directly).
    var rawValue: String {
        switch self {
        case .scheduled: return "scheduled"
        case .completed: return "completed"
        case .cancelled: return "cancelled"
        case let .other(value): return value
        }
    }

    /// Badge tone resolved from the status tokens.
    var color: Color {
        switch self {
        case .scheduled: return Color.TS.accent
        case .completed: return Color.TS.statusSuccess
        case .cancelled: return Color.TS.statusDanger
        case .other: return Color.TS.textMuted
        }
    }
}

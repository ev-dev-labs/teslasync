//
//  TeslaCarViz.Palette.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The colour palette for the illustration — the native peer of the web `useSvgPalette()` (which switches on
//  `useTheme().mode.colorScheme === 'light'`). It is a pure function of `isLight` (read from the SwiftUI
//  environment colour scheme), so it is testable in isolation. The *structural* shading (body, glass, wheels,
//  detail) is neutral greyscale tuned per scheme — the native peer of the web's black/white rgba pairs — while
//  every *semantic* colour (battery band, charging, lock, climate, Sentry, tail-light) comes from the P1/S9
//  status tokens so "good stays green / Sentry stays red" across every theme (the web `colors.ts` contract).
//

import SwiftUI

/// The theme-aware colour palette for the car illustration — the native parity of `useSvgPalette`.
struct TeslaCarVizPalette {
    let isLight: Bool

    // MARK: Structure (neutral greyscale — web black/white rgba pairs)

    var bodyFill: Color {
        Color(white: isLight ? 0.83 : 0.22)
    }

    var bodyStroke: Color {
        Color.primary.opacity(isLight ? 0.18 : 0.10)
    }

    var glassFill: Color {
        Color(white: isLight ? 0.60 : 0.10)
    }

    var glassStroke: Color {
        Color.primary.opacity(isLight ? 0.20 : 0.14)
    }

    var windFill: Color {
        Color(white: isLight ? 0.66 : 0.13)
    }

    var detailLine: Color {
        Color.primary.opacity(0.10)
    }

    var detailFaint: Color {
        Color.primary.opacity(0.06)
    }

    var roofShine: Color {
        Color.white.opacity(isLight ? 0.30 : 0.06)
    }

    var shadow: Color {
        Color.black.opacity(isLight ? 0.08 : 0.30)
    }

    var wheelOuter: Color {
        Color(white: isLight ? 0.28 : 0.05)
    }

    var wheelInner: Color {
        Color(white: isLight ? 0.20 : 0.13)
    }

    var wheelHub: Color {
        Color(white: isLight ? 0.34 : 0.28)
    }

    var wheelSpoke: Color {
        Color.primary.opacity(isLight ? 0.30 : 0.55)
    }

    var tread: Color {
        Color.primary.opacity(0.10)
    }

    var batteryTrack: Color {
        Color.primary.opacity(0.10)
    }

    var batteryText: Color {
        Color.primary.opacity(0.70)
    }

    var lockBadge: Color {
        Color.black.opacity(isLight ? 0.08 : 0.40)
    }

    var headlightOff: Color {
        Color.primary.opacity(0.10)
    }

    var statusInactive: Color {
        Color.primary.opacity(0.22)
    }

    var statusInactiveText: Color {
        Color.primary.opacity(0.38)
    }

    // MARK: Semantic (theme-stable P1/S9 status tokens)

    var charging: Color {
        Color.TS.statusSuccess
    }

    var lockedTint: Color {
        Color.TS.statusSuccess
    }

    var unlockedTint: Color {
        Color.TS.statusWarning
    }

    var taillight: Color {
        Color.TS.statusDanger
    }

    var climate: Color {
        Color.TS.statusInfo
    }

    var sentry: Color {
        Color.TS.statusDanger
    }

    var speedLine: Color {
        Color.TS.statusInfo
    }

    var headlightOn: Color {
        Color.white
    }

    var projectorOn: Color {
        Color(red: 1.0, green: 0.984, blue: 0.902)
    }

    /// The battery-bar fill for a band — the semantic token peer of the web `batteryColor` hue.
    func battery(_ band: TeslaCarVizBatteryBand) -> Color {
        switch band {
        case .high: Color.TS.statusSuccess
        case .medium: Color.TS.statusWarning
        case .low: Color.TS.statusDanger
        }
    }

    /// The lit colour for a status-dot role (theme-stable).
    func statusColor(_ role: TeslaCarVizStatusRole) -> Color {
        switch role {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .danger: Color.TS.statusDanger
        }
    }

    /// The base hue of the ambient glow for a mood (web ambient gradients).
    func ambient(_ mode: TeslaCarVizAmbientMode) -> Color {
        switch mode {
        case .sentry: Color.TS.statusDanger
        case .charging: Color.TS.statusSuccess
        case .driving: Color.TS.statusInfo
        case .idle: Color.primary
        }
    }

    /// The peak opacity of the ambient glow — stronger in dark mode (web `isLight` ternaries).
    func ambientOpacity(_ mode: TeslaCarVizAmbientMode) -> Double {
        if mode == .idle { return isLight ? 0.04 : 0.06 }
        return isLight ? 0.20 : 0.38
    }
}

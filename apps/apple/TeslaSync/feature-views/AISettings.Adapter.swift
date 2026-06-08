//
//  AISettings.Adapter.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  The testable projection core for the Helix (AI) settings surface — the SwiftUI
//  parity of features/settings/components/AISettings.tsx (the in-scope slice: the
//  mode picker, the save flow, and the cost-cap spend bar). Everything here is pure
//  and dependency-free (no store, no bundle, no rendered view) so the Helix mode
//  catalogue, the cost-cap arithmetic, and the dollar/percent formatting are all unit
//  tested in isolation.
//
//  Parity note: the web `AICostCapSpendBar` reads today's spend in micro-cents
//  (1e-4 cent) from /ai/usage/today and the cap in whole cents, converts both to
//  dollars, derives an ok / warn / critical level at the 80 % and 100 % thresholds
//  (the same thresholds the backend cost-cap decorator enforces), and renders
//  `${{spent}} / ${{cap}}`. This core reproduces that arithmetic and labelling
//  verbatim — it does not reinterpret the upstream values.
//

import Foundation

// MARK: - Helix mode (web `AiMode = 'off' | 'local' | 'cloud'`)

/// The three canonical Helix modes — the native mirror of the web `AiMode`. `off`
/// is the default per ADR-015 §I1 (a fresh install never auto-enables Helix).
public enum AiMode: String, Sendable, Equatable, CaseIterable, Identifiable {
    case off
    case local
    case cloud

    public var id: String {
        rawValue
    }

    /// Defensive parse for loosely-typed payloads (web `isAiMode`); unknown /
    /// legacy empty strings collapse to the default `off`.
    public static func parse(_ value: String?) -> AiMode {
        AiMode(rawValue: value ?? "") ?? .off
    }
}

// MARK: - Mode option catalogue (web `<ModeRadio>` × 3)

/// One selectable Helix-mode card — the native mirror of a web `<ModeRadio>`. The
/// label + description are carried as i18n keys with their web English fallback so
/// the view resolves them through the P1/S10 facade (no literals in Swift).
public struct AiModeOption: Identifiable, Equatable, Sendable {
    public let mode: AiMode
    public let labelKey: String
    public let labelFallback: String
    public let hintKey: String
    public let hintFallback: String

    public var id: AiMode {
        mode
    }

    public init(
        mode: AiMode,
        labelKey: String,
        labelFallback: String,
        hintKey: String,
        hintFallback: String
    ) {
        self.mode = mode
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.hintKey = hintKey
        self.hintFallback = hintFallback
    }
}

/// The ordered mode catalogue rendered by the picker — off → local → cloud, exactly
/// the web order. Keys + English fallbacks are extracted verbatim from the web
/// source's `t(key, default)` calls.
public enum AiModeCatalog {
    public static let options: [AiModeOption] = [
        AiModeOption(
            mode: .off,
            labelKey: "ai.settings.mode.off",
            labelFallback: "Off (default)",
            hintKey: "ai.settings.mode.offHint",
            hintFallback: "No Helix features. The app works fully without them."
        ),
        AiModeOption(
            mode: .local,
            labelKey: "ai.settings.mode.local",
            labelFallback: "Local-only",
            hintKey: "ai.settings.mode.localHint",
            hintFallback: "Use a private model on your network (e.g. Ollama). No data leaves your install."
        ),
        AiModeOption(
            mode: .cloud,
            labelKey: "ai.settings.mode.cloud",
            labelFallback: "Cloud",
            hintKey: "ai.settings.mode.cloudHint",
            hintFallback: "Use a cloud provider (e.g. OpenAI). Requires an API key."
        )
    ]

    /// The catalogue entry for a mode (total over the closed `AiMode` set).
    public static func option(for mode: AiMode) -> AiModeOption {
        options.first { $0.mode == mode } ?? options[0]
    }
}

// MARK: - Number formatting (port of the web `toFixed(2)` dollar render)

/// Pure, locale-deterministic formatting helpers for the cost-cap bar. The web bar
/// formats dollars with `Number.toFixed(2)` (invariant `.` separator, two fraction
/// digits), so the default locale here is `en_US_POSIX` to match the wire output
/// exactly; tests may inject another locale.
public enum HelixFormat {
    /// The em-dash sentinel for a missing value (kept for parity with the web `—`).
    public static let dash = "—"

    /// Native port of `value.toFixed(2)`: two fixed fraction digits, half-away
    /// rounding, no grouping, invariant separator.
    public static func fixed2(_ value: Double, locale: Locale = Locale(identifier: "en_US_POSIX")) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        formatter.roundingMode = .halfUp
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? "0.00"
    }
}

// MARK: - Cost-cap math (port of `AICostCapSpendBar`)

/// The cost-cap spend level — the native mirror of the web bar's
/// `pct >= 100 ? 'critical' : pct >= 80 ? 'warn' : 'ok'`. Drives the fill / text
/// tone and which trailing hint (if any) is shown.
public enum HelixCostLevel: String, Sendable, Equatable {
    case ok
    case warn
    case critical
}

/// The resolved cost-cap readout — today's spend against the daily cap, both in
/// dollars, the clamped 0...100 fill percentage, and the derived level. A pure
/// function of `todayMicroCents` (web `/ai/usage/today` `cost_micro_cents`) and the
/// whole-cent `capCents` (web `provider.cost_cap_cents`).
public struct HelixCostCap: Sendable, Equatable {
    public let todayDollars: Double
    public let capDollars: Double
    public let percent: Double
    public let level: HelixCostLevel

    public init(todayDollars: Double, capDollars: Double, percent: Double, level: HelixCostLevel) {
        self.todayDollars = todayDollars
        self.capDollars = capDollars
        self.percent = percent
        self.level = level
    }

    /// Reproduces the web bar's arithmetic verbatim:
    ///   capMicroCents = capCents * 10_000
    ///   pct           = capMicroCents > 0 ? min(100, today/cap * 100) : 0
    ///   todayDollars  = todayMicroCents / 1_000_000
    ///   capDollars    = capCents / 100
    public static func compute(todayMicroCents: Double, capCents: Int) -> HelixCostCap {
        let today = todayMicroCents.isFinite && todayMicroCents > 0 ? todayMicroCents : 0
        let capMicroCents = Double(capCents) * 10000
        let percent = capMicroCents > 0 ? min(100, (today / capMicroCents) * 100) : 0
        let level: HelixCostLevel = percent >= 100 ? .critical : percent >= 80 ? .warn : .ok
        return HelixCostCap(
            todayDollars: today / 1_000_000,
            capDollars: Double(capCents) / 100,
            percent: percent,
            level: level
        )
    }

    /// The spent/cap dollar pair as two `toFixed(2)` strings, ready to fold into the
    /// `ai.settings.costCap.amount` format (`${{spent}} / ${{cap}}`).
    public func amountParts(locale: Locale = Locale(identifier: "en_US_POSIX")) -> (spent: String, cap: String) {
        (HelixFormat.fixed2(todayDollars, locale: locale), HelixFormat.fixed2(capDollars, locale: locale))
    }
}

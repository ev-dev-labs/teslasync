//
//  InfoTile.Model.swift
//  TeslaSync — P4 feature view · 0280 · InfoTile (Apple)
//
//  Projections (the "adapter"), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the InfoTile surface — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/InfoTile.tsx. The web component is a
//  pure presentational leaf: it receives an already-resolved icon / label / value /
//  color / sub from its parent (e.g. TelemetryGrid) and renders a labelled glass tile.
//  It performs no data fetching, so there are no loading / error / stale / offline
//  branches to bind — the only conditional render branches in the source are the value
//  type (boolean → "Yes"/"No", otherwise verbatim) and the optional sub line. Those
//  branches plus a graceful em-dash for blank values (so the tile is never blank) are
//  modelled here as pure, unit-testable projections. The view binds through
//  `InfoTileModel`, which also owns the once-only `view.opened` emission. No I/O lives
//  in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event.
public enum InfoTileSurface {
    public static let slug = "InfoTile"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// diagnostics pipeline (consent-gated + redacted there).
public protocol InfoTileTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogInfoTileTelemetry: InfoTileTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Value (web `value: string | number | boolean`)

/// The tile's value, mirroring the web union type. The web collapses it to a display
/// string with `typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value`; the
/// native projection reproduces that and routes the boolean words + the blank-value
/// em dash through the P1/S10 facade so the view holds no English literals.
public enum InfoTileValue: Equatable, Sendable {
    case text(String)
    case number(Double)
    case bool(Bool)

    /// The display string (web `display`), localized via the injected facade.
    public func display(localize: (String, String) -> String) -> String {
        switch self {
        case let .bool(flag):
            let key = flag ? "infoTile.value.yes" : "infoTile.value.no"
            let fallback = flag ? "Yes" : "No"
            return localize(key, fallback)
        case let .number(number):
            return InfoTileValue.format(number)
        case let .text(text):
            return text.isBlank ? localize("infoTile.value.empty", "—") : text
        }
    }

    /// Whether the projection resolves to the em-dash fallback (a blank text value).
    /// Numbers and booleans always render a concrete value.
    public var isEmpty: Bool {
        if case let .text(text) = self { return text.isBlank }
        return false
    }

    /// Locale-independent number rendering matching the web `String(number)`: whole
    /// numbers print without a fraction, others keep their natural decimals, and no
    /// grouping separators are inserted.
    static func format(_ value: Double) -> String {
        guard value.isFinite else { return String(value) }
        if value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

// MARK: - Value tint (web `color` Tailwind class)

/// The semantic tint applied to the value text (web `color`, default
/// `text-[var(--text-primary)]`). The web call sites pass a small, fixed set of
/// Tailwind classes — `text-emerald-300` / `text-amber-300` / `text-rose-300` /
/// `text-[var(--text-muted)]` and the primary default — which map onto the shared
/// semantic token palette here. Keeping it an enum (rather than a free `Color`) keeps
/// the surface on the design tokens and light/dark/high-contrast aware.
public enum InfoTileValueColor: String, CaseIterable, Sendable {
    /// Default — `text-[var(--text-primary)]`.
    case primary
    /// `text-[var(--text-muted)]`.
    case muted
    /// `text-emerald-300`.
    case success
    /// `text-amber-300`.
    case warning
    /// `text-rose-300`.
    case danger
    /// `text-cyan-300` / `text-indigo-300`.
    case info
    /// Brand accent.
    case accent

    /// The token color for the tint (light / dark / high-contrast aware).
    public var color: Color {
        switch self {
        case .primary: Color.TS.textPrimary
        case .muted: Color.TS.textMuted
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .accent: Color.TS.accent
        }
    }
}

// MARK: - Accessibility builders (web `title` + the tile's read-out)

/// Pure builders for the surface's accessibility contract. The web tile is a static
/// (non-interactive) display whose full value lives in the `title` attribute; the
/// native tile is a single accessibility element whose label combines the (already
/// localized) label, value, and optional sub so VoiceOver reads the whole tile — and
/// the full, untruncated value — in one pass.
public enum InfoTileAccessibility {
    /// The combined spoken label (label, value[, sub]); empty parts are dropped.
    public static func label(label: String, value: String, sub: String?) -> String {
        var parts = [label, value]
        if let sub, !sub.isBlank { parts.append(sub) }
        return parts.filter { !$0.isBlank }.joined(separator: ", ")
    }

    /// A stable UI-test identifier derived from the label (native chrome — the web
    /// tile carries no testid). Non-alphanumerics collapse to single dashes.
    public static func testID(label: String) -> String {
        var slug = ""
        var pendingDash = false
        for scalar in label.lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                slug.unicodeScalars.append(scalar)
                pendingDash = false
            } else if !slug.isEmpty {
                pendingDash = true
            }
            if pendingDash, !slug.isEmpty, !slug.hasSuffix("-") {
                slug.append("-")
            }
        }
        while slug.hasSuffix("-") {
            slug.removeLast()
        }
        return "info-tile-" + (slug.isEmpty ? "value" : slug)
    }
}

// MARK: - View model

/// The surface's observable view-model. Holds the (immutable) projected inputs the web
/// component receives as props, exposes the localized display value, and owns the
/// once-only `view.opened` emission (web effect on mount). No networking lives here —
/// the tile is purely presentational.
@MainActor
@Observable
public final class InfoTileModel {
    /// SF Symbol for the leading icon (web `icon`).
    public let systemImage: String
    /// The already-localized label (web `label`, resolved by the parent).
    public let label: String
    /// The value union (web `value`).
    public let value: InfoTileValue
    /// The value tint (web `color`).
    public let valueColor: InfoTileValueColor
    /// The optional sub line (web `sub`).
    public let sub: String?

    @ObservationIgnored private let telemetry: any InfoTileTelemetry
    @ObservationIgnored private var didStart = false

    public init(
        systemImage: String,
        label: String,
        value: InfoTileValue,
        valueColor: InfoTileValueColor = .primary,
        sub: String? = nil,
        telemetry: any InfoTileTelemetry = OSLogInfoTileTelemetry()
    ) {
        self.systemImage = systemImage
        self.label = label
        self.value = value
        self.valueColor = valueColor
        self.sub = sub
        self.telemetry = telemetry
    }

    /// The localized display value (web `display`).
    public var displayValue: String {
        value.display(localize: InfoTileStrings.string)
    }

    /// Whether a non-blank sub line should render (web `sub && <p>…`).
    public var hasSub: Bool {
        guard let sub else { return false }
        return !sub.isBlank
    }

    /// The combined VoiceOver label for the whole tile.
    public var accessibilityLabel: String {
        InfoTileAccessibility.label(label: label, value: displayValue, sub: hasSub ? sub : nil)
    }

    /// Stable UI-test identifier for the tile (native chrome).
    public var accessibilityID: String {
        InfoTileAccessibility.testID(label: label)
    }

    /// Emits the diagnostics `view.opened` event once (web effect on mount). Idempotent.
    public func start() {
        guard !didStart else { return }
        didStart = true
        telemetry.viewOpened(surface: InfoTileSurface.slug)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. The web `InfoTile` itself hardcodes the boolean words
/// "Yes"/"No"; here they (and the blank-value em dash) are routed through the same
/// facade the rest of the app uses. Keys live in the "InfoTile" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time. The label / value / sub
/// passed in by the parent are already localized at the call site, so they are not
/// redeclared here.
public enum InfoTileStrings {
    public static let table = "InfoTile"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Small helpers

private extension String {
    /// Whether the string is empty or only whitespace/newlines.
    var isBlank: Bool {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

//
//  SignalDiffTable.Localization.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  The P1/S10 localization facade + the testable accessibility summary. Both are
//  Foundation-only so the strings resolve through the per-surface catalog table
//  (no hardcoded literals in the view) and the VoiceOver content can be unit
//  tested without rendering.
//

import Foundation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SignalDiffTable" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time. The
/// first block is the exact set extracted from the web source; the rest backs the
/// native-only chrome (legend help, source-layer descriptions, error/retry,
/// freshness banners, accessibility).
public enum SignalDiffTableStrings {
    public static let table = "SignalDiffTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Keys from the web source (parity)

    public static var columnSignal: String {
        string("signalDiff.signal", "Signal")
    }

    public static var columnValueA: String {
        string("signalDiff.valueA", "Window A")
    }

    public static var columnValueB: String {
        string("signalDiff.valueB", "Window B")
    }

    public static var columnDelta: String {
        string("signalDiff.delta", "Δ")
    }

    public static var columnSourceA: String {
        string("signalDiff.sourceA", "Src A")
    }

    public static var columnSourceB: String {
        string("signalDiff.sourceB", "Src B")
    }

    public static var deltaChanged: String {
        string("signalDiff.deltaChanged", "changed")
    }

    public static var tableNoMatches: String {
        string("signalDiff.tableNoMatches", "No signals match the current filter")
    }

    public static var tableEmpty: String {
        string("signalDiff.tableEmpty", "No differences between the two snapshots")
    }

    public static var tableLoading: String {
        string("signalDiff.tableLoading", "Loading…")
    }

    // MARK: Legend (web HelpTooltip column legend)

    public static var legendDelta: String {
        string("signalDiff.legend.delta", "Δ")
    }

    public static var legendSource: String {
        string("signalDiff.legend.source", "Src A / Src B")
    }

    public static var legendDeltaAria: String {
        string("signalDiff.legend.deltaAria", "More info about the Δ column")
    }

    public static var legendSourceAria: String {
        string("signalDiff.legend.sourceAria", "More info about the source-layer column")
    }

    public static var helpDelta: String {
        string(
            "help.signal.deltaCol",
            "Numeric difference (and percent change) between Window A and Window B for this signal. "
                + "'changed' is shown for non-numeric values that differ."
        )
    }

    public static var helpSource: String {
        string(
            "help.signal.sourceLayer",
            "The layer that supplied this value: L1 (in-process), L2 (Redis), LOG (TimescaleDB history), "
                + "or STALE (older than 2 minutes)."
        )
    }

    // MARK: Source-layer descriptions (web `SourceLayerBadge`)

    public static var sourceLayerAge: String {
        string("sourceLayer.age", "age")
    }

    public static func sourceLayerDescription(_ layer: SignalDiffSourceLayer) -> String {
        switch layer {
        case .l1:
            string("sourceLayer.l1.desc", "Read from the in-process SignalStore (hot path, freshest).")
        case .l2:
            string("sourceLayer.l2.desc", "Read from Redis cross-pod cache (legacy entry; freshness unknown).")
        case .log:
            string("sourceLayer.log.desc", "Replayed from signal_log (durable history).")
        case .stale:
            string("sourceLayer.stale.desc", "Redis-backed value older than the 2-minute freshness window.")
        case .unknown:
            string("sourceLayer.unknown.desc", "Source layer unknown.")
        }
    }

    /// The badge tooltip — the layer description plus the optional age, mirroring
    /// the web `SourceLayerBadge` tooltip `${desc} (${age}: ${ageText})`.
    public static func sourceLayerTooltip(_ layer: SignalDiffSourceLayer, ageText: String?) -> String {
        let description = sourceLayerDescription(layer)
        guard let ageText else { return description }
        return "\(description) (\(sourceLayerAge): \(ageText))"
    }

    // MARK: Native chrome — states + actions

    public static var errorTitle: String {
        string("signalDiff.error.title", "Couldn't load signal diff")
    }

    public static var retry: String {
        string("signalDiff.action.retry", "Retry")
    }

    public static var staleBanner: String {
        string("signalDiff.banner.stale", "Reconnecting — values may be stale")
    }

    public static var offlineBanner: String {
        string("signalDiff.banner.offline", "Offline — showing last known values")
    }

    // MARK: Pin affordance (web shared `PinButton`)

    public static var pinAction: String {
        string("pin.pin", "Pin")
    }

    public static var unpinAction: String {
        string("pin.unpin", "Unpin")
    }

    // MARK: Accessibility

    public static var tableLabel: String {
        string("signalDiff.a11y.table", "Signal differences")
    }

    public static var pinnedLabel: String {
        string("signalDiff.a11y.pinned", "pinned")
    }

    public static var selectLabel: String {
        string("signalDiff.a11y.select", "Select signal")
    }

    public static var deltaChangeLabel: String {
        string("signalDiff.a11y.delta", "change")
    }

    public static var noChangeLabel: String {
        string("signalDiff.a11y.noChange", "no change")
    }

    public static var sortHint: String {
        string("signalDiff.a11y.sortHint", "Sorts the table")
    }

    public static var sortedAscending: String {
        string("signalDiff.a11y.sortedAscending", "sorted ascending")
    }

    public static var sortedDescending: String {
        string("signalDiff.a11y.sortedDescending", "sorted descending")
    }

    /// VoiceOver value spoken for the whole table: the differing-signal count.
    public static func countSummary(_ count: Int) -> String {
        String(format: string("signalDiff.a11y.count", "%lld differing signals"), count)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content for the table + its rows. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum SignalDiffTableAccessibility {
    /// The grid's spoken value — the differing-signal count, or the empty message
    /// when nothing differs.
    public static func gridSummary(rowCount: Int) -> String {
        rowCount == 0 ? SignalDiffTableStrings.tableEmpty : SignalDiffTableStrings.countSummary(rowCount)
    }

    /// A localized, VoiceOver-friendly description of the Δ classification.
    public static func deltaDescription(
        for kind: SignalDiffDeltaKind,
        locale: Locale = SignalDiffTableFormat.defaultLocale
    ) -> String {
        switch kind {
        case .none:
            return SignalDiffTableStrings.noChangeLabel
        case .changed:
            return SignalDiffTableStrings.deltaChanged
        case let .numeric(delta, percent):
            let value = SignalDiffTableFormat.deltaNumericText(delta: delta, percent: percent, locale: locale)
            return "\(SignalDiffTableStrings.deltaChangeLabel) \(value)"
        }
    }

    /// One row's combined VoiceOver label: name, both windows, the Δ description,
    /// the two source layers, and the pinned flag when set. The selected state is
    /// announced separately via the `.isSelected` trait.
    public static func rowLabel(
        for row: SignalDiffRow,
        locale: Locale = SignalDiffTableFormat.defaultLocale
    ) -> String {
        var parts = [
            row.name,
            "\(SignalDiffTableStrings.columnValueA) \(row.valueAText)",
            "\(SignalDiffTableStrings.columnValueB) \(row.valueBText)",
            deltaDescription(for: row.delta, locale: locale),
            "\(SignalDiffTableStrings.columnSourceA) \(row.sourceA.badgeLabel)",
            "\(SignalDiffTableStrings.columnSourceB) \(row.sourceB.badgeLabel)"
        ]
        if row.pinned { parts.append(SignalDiffTableStrings.pinnedLabel) }
        return parts.joined(separator: ", ")
    }
}

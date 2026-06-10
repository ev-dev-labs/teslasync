//
//  SignalSelector.Adapter.swift
//  TeslaSync — P4 feature view · 0270 · SignalSelector (Apple)
//
//  The testable projection core for the signal multi-select — the SwiftUI parity
//  of features/telemetry/components/SignalSelector.tsx. Pure + Foundation-only
//  (no SwiftUI, no bundle, no clock) so the candidate-list projection, the cap
//  slice, the `Signals (N / max)` label, and the VoiceOver copy unit-test
//  deterministically.
//
//  Parity source: the web `SignalSelector` is a thin `ComboboxMulti` wrapper —
//  it renders the "Signals (value.length / max)" label, the layer-help tooltip,
//  mono signal options, and caps the selection with `next.slice(0, cap)` (cap
//  defaults to 5, `null` = uncapped). This projection reproduces that math: the
//  available-signal candidate list (web `options`, deduped/trimmed), the ordered
//  capped reconciliation a `Set`-edit from `TSComboboxMulti` maps back to (the
//  native counterpart of `ComboboxMulti`'s array `onChange`), and the label
//  string the bar shows above the field.
//

import Foundation

// MARK: - Selector projection (web `options` / label / `slice(0, cap)`)

/// Pure projection for the signal selector: the candidate-list normalization, the
/// ordered+capped selection reconciliation (web `next.slice(0, cap)`), the
/// `Signals (N / max)` label, and the at-capacity flag. Mirrors the web
/// `SignalSelector` wrapper exactly so the native field reads the same signals.
public enum SignalSelectorProjection {
    /// Normalizes a cached available-signal list into the option list the field
    /// offers: trims whitespace, drops blanks, and de-duplicates preserving first
    /// occurrence (the web passes `options` straight through; a streamed signal
    /// catalog can repeat names, so the native projection makes it set-like while
    /// keeping the upstream order). This is the cached → projection adapter.
    public static func options(from availableSignals: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for raw in availableSignals {
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, !seen.contains(name) else { continue }
            seen.insert(name)
            result.append(name)
        }
        return result
    }

    /// Caps an ordered selection to `cap` items (web `slice(0, cap)`); `nil` cap
    /// (web `max = null`) leaves it untouched. A negative cap clamps to empty.
    public static func applyCap(_ items: [String], cap: Int?) -> [String] {
        guard let cap else { return items }
        guard cap > 0 else { return [] }
        return Array(items.prefix(cap))
    }

    /// Reconciles a `Set`-edit from `TSComboboxMulti` back into the ordered,
    /// capped selection — the native counterpart of `ComboboxMulti`'s array
    /// `onChange={(next) => onChange(next.slice(0, cap))}`. Items already selected
    /// keep their prior order; newly-checked items are appended (sorted for a
    /// deterministic result); the whole list is then capped, so checking a signal
    /// past the cap is dropped exactly like the web slice.
    public static func reconcile(previous: [String], incoming: Set<String>, cap: Int?) -> [String] {
        var ordered = previous.filter { incoming.contains($0) }
        let additions = incoming.subtracting(ordered).sorted()
        ordered.append(contentsOf: additions)
        return applyCap(ordered, cap: cap)
    }

    /// The label above the field — web ``${t('Signals')} (${value.length} / ${max})``
    /// when capped, ``${t('Signals')} (${value.length})`` when uncapped, or the
    /// caller's `labelOverride` verbatim. `signalsWord` is the localized `Signals`.
    public static func label(
        selectedCount: Int,
        max: Int?,
        override: String?,
        signalsWord: String
    ) -> String {
        if let override, !override.isEmpty { return override }
        if let max { return "\(signalsWord) (\(selectedCount) / \(max))" }
        return "\(signalsWord) (\(selectedCount))"
    }

    /// Whether the selection has reached the cap (drives the at-capacity hint).
    /// Always `false` when uncapped (web `max = null`).
    public static func isAtCapacity(selectedCount: Int, max: Int?) -> Bool {
        guard let max else { return false }
        return selectedCount >= max
    }
}

// MARK: - Accessibility (testable seam)

/// Pure builder for the VoiceOver copy the field exposes, so the spoken content
/// is unit-testable without rendering the view.
public enum SignalSelectorAccessibility {
    /// The combobox's accessibility label: the role plus the selected/cap count —
    /// e.g. "Signals selector, 2 / 5 selected" (capped) or "Signals selector, 2
    /// selected" (uncapped). `localize` resolves the role + "selected" words.
    public static func selectorSummary(
        selectedCount: Int,
        max: Int?,
        localize: (String, String) -> String
    ) -> String {
        let role = localize("telemetry.signalSelector.a11ySelector", "Signals selector")
        let selected = localize("telemetry.signalSelector.a11ySelected", "selected")
        if let max {
            return "\(role), \(selectedCount) / \(max) \(selected)"
        }
        return "\(role), \(selectedCount) \(selected)"
    }
}

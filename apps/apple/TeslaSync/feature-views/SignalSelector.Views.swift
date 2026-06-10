//
//  SignalSelector.Views.swift
//  TeslaSync — P4 feature view · 0270 · SignalSelector (Apple)
//
//  The presentational subviews composed by `SignalSelector`: the label row (web
//  uppercase muted "Signals (N / max)" span + the `HelpTooltip`), the multi-select
//  field (the native `TSComboboxMulti` counterpart of the web `ComboboxMulti`,
//  fed the available signal options + the cap-enforcing binding), and the
//  candidate-list chrome the Apple HIG states contract requires layered under the
//  always-present field: the loading skeleton, the friendly empty hint, the
//  `QueryError`-equivalent inline error with retry, and the stale/offline
//  freshness banner (ADR-013). All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//
//  HIG note: the web caps the field with `maxItems` + a custom mono `renderOption`
//  and an inline search icon — both are internal details of `ComboboxMulti`. The
//  native shared `TSComboboxMulti` owns its own option rendering + search chrome,
//  so the wrapper enforces the cap through the bound model (web `slice(0, cap)`)
//  rather than reaching into the component. Composition (label + tooltip + capped
//  multi-select) and every i18n key are preserved.
//

import SwiftUI

// MARK: - i18n facade helpers

extension SignalSelectorStrings {
    /// Resolves a key to a verbatim `Text` (the facade owns the lookup; the view
    /// never embeds a literal).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolved value wrapped as a `LocalizedStringKey` for shared components that
    /// only accept `LocalizedStringKey` (e.g. `TSComboboxMulti` / `TSHelpTooltip`);
    /// the resolved string is not a main-catalog key, so SwiftUI renders it verbatim.
    static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }
}

// MARK: - Label row (web uppercase muted label + `HelpTooltip`)

/// The label above the field — the native port of the web `<span>` with the
/// uppercase muted "Signals (N / max)" text and the optional layer-help tooltip.
struct SignalSelectorLabelRow: View {
    let label: String
    let showsLayerHelp: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            if showsLayerHelp { helpTooltip }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The layer-help tooltip (web `HelpTooltip i18nKey="help.signal.layers"`); the
    /// aria label overrides the shared component's default for parity with the web
    /// `ariaLabel`.
    private var helpTooltip: some View {
        TSHelpTooltip(SignalSelectorStrings.key("help.signal.layers", SignalSelectorStrings.layersHelpDefault))
            .accessibilityLabel(SignalSelectorStrings.text(
                "help.signal.layers.aria",
                "More info about signal layers (L1, L2, log)"
            ))
    }
}

// MARK: - Multi-select field (web `ComboboxMulti` → `TSComboboxMulti`)

/// The signal multi-select — the native `TSComboboxMulti` counterpart of the web
/// `ComboboxMulti`, fed the available signal options and the cap-enforcing
/// selection binding. The combobox is always present; the cap (web `slice(0, cap)`)
/// is applied by the bound model when the binding writes back.
struct SignalSelectorComboField: View {
    let options: [String]
    @Binding var selection: Set<String>
    let accessibilityLabel: String

    private var comboOptions: [TSComboOption<String>] {
        options.map { TSComboOption($0, title: LocalizedStringKey($0), searchText: $0) }
    }

    var body: some View {
        TSComboboxMulti(
            selection: $selection,
            options: comboOptions,
            prompt: SignalSelectorStrings.key("Search signals…", "Search signals…")
        )
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Candidate-list chrome (loading / empty / error) under the field

/// The state chrome shown beneath the always-present field: a skeleton on the
/// initial candidate-list load, a friendly empty hint when no signals are
/// available, and a `QueryError`-equivalent inline error with retry on failure.
/// `content` adds no chrome (the field speaks for itself).
struct SignalSelectorStatusLine: View {
    let phase: SignalSelectorModel.Phase
    let onRetry: () -> Void

    var body: some View {
        switch phase {
        case .loading:
            SignalSelectorLoadingHint()
        case .empty:
            SignalSelectorEmptyHint()
        case let .error(message):
            SignalSelectorErrorHint(message: message, onRetry: onRetry)
        case .content:
            EmptyView()
        }
    }
}

/// The initial-load skeleton — a one-line stand-in while the available-signal
/// query resolves.
struct SignalSelectorLoadingHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 140, height: 12, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 64, height: 12, cornerRadius: TSRadius.sm)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SignalSelectorStrings.text(
            "telemetry.signalSelector.loadingHint",
            "Loading available signals…"
        ))
    }
}

/// The friendly empty hint when no signals are available for the vehicle — so the
/// surface reads as "nothing to pick yet", never a blank strip (web `options`
/// empty).
struct SignalSelectorEmptyHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SignalSelectorStrings
                .text("telemetry.signalSelector.emptyHint", "No signals are available for this vehicle yet")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.textMuted.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

/// The `QueryError`-equivalent inline error with a retry affordance, shown under
/// the field so the selector stays usable while the list is refetched.
struct SignalSelectorErrorHint: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                SignalSelectorStrings
                    .text("telemetry.signalSelector.errorTitle", "Couldn't load the available signals")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            retryButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            SignalSelectorStrings.text("telemetry.signalSelector.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SignalSelectorStrings.text("telemetry.signalSelector.retry", "Retry"))
    }
}

// MARK: - Freshness banner (stale / offline)

/// The stale/offline banner shown above the field when the bound source is not
/// live, so a cached signal list is clearly labeled (ADR-013 live-state intent).
struct SignalSelectorConnectivityBanner: View {
    let connection: SignalSelectorConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline
            ? "telemetry.signalSelector.offlineBanner"
            : "telemetry.signalSelector.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded signal list"
            : "Refreshing — the signal list may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SignalSelectorStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

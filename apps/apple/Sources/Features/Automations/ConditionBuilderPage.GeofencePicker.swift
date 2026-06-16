//
//  ConditionBuilderPage.GeofencePicker.swift
//  TeslaSync — P7 page · automations/ConditionBuilder (Apple)
//
//  The multi-state geofence picker (web geofence `Select` bound to `useGeofences`) plus the freshness
//  chip and inline error/offline state it composes. This is where the page's single data source
//  renders every HIG state the parity contract requires — loading (spinner), content (the picker,
//  fresh / stale / offline), empty (`No saved places yet.`), error (retryable), and offline-no-cache —
//  driven by the reused `GeofenceOptionsModel.presentation` projection. Split from
//  `ConditionBuilderPage.Views.swift` to keep each source file within the project's length budget.
//

import SwiftUI

// MARK: - Freshness chip (live / stale / offline)

/// Header chip flagging live / stale / offline geofence options (web freshness hint, ADR-013).
struct ConditionBuilderPageFreshnessChip: View {
    let freshness: GeofenceFreshness

    private var color: Color {
        switch freshness {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: ConditionBuilderPageStrings.localize("automations.builder.live", "Live")
        case .stale: ConditionBuilderPageStrings.localize("automations.builder.stale", "Stale")
        case .offline: ConditionBuilderPageStrings.localize("automations.builder.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Inline state (error / offline) with optional retry

/// A compact inline state row (web `QueryError` / offline fallback) used by the geofence picker's
/// error + offline branches, with an optional retry affordance.
struct ConditionBuilderPageInlineState: View {
    let symbol: String
    let message: String
    let isError: Bool
    var onRetry: (() -> Void)?

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isError ? Color.TS.statusDanger : Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let onRetry {
                TSButton(variant: .ghost, size: .small, action: onRetry) {
                    Text(verbatim: ConditionBuilderPageStrings.localize("automations.builder.retry", "Retry"))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                }
                .accessibilityLabel(
                    Text(verbatim: ConditionBuilderPageStrings.localize("automations.builder.retry", "Retry"))
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Geofence picker (web geofence Select, every source state)

/// The geofence select bound to the reused `GeofenceOptionsModel` (web `useGeofences`). Renders the
/// empty-selection prompt + loaded options (web `geofenceOptions`) and, per the HIG states contract,
/// the loading / empty / error / stale / offline chrome of the geofence query — never a blank region.
struct ConditionBuilderPageGeofencePicker: View {
    @Binding var placeId: Int
    let geofences: GeofenceOptionsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            content
        }
        .frame(maxWidth: 240, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            ConditionBuilderPageFieldLabel(key: "automations.builder.geofence", fallback: "Geofence")
            Spacer(minLength: TSSpacing.sm)
            if let freshness = headerFreshness, freshness != .live {
                ConditionBuilderPageFreshnessChip(freshness: freshness)
            }
        }
    }

    private var headerFreshness: GeofenceFreshness? {
        switch geofences.presentation {
        case let .content(_, freshness, _): freshness
        case let .empty(freshness): freshness
        default: nil
        }
    }

    @ViewBuilder
    private var content: some View {
        switch geofences.presentation {
        case .loading:
            loadingRow
        case let .content(options, _, refreshing):
            picker(options: options, refreshing: refreshing)
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                picker(options: [], refreshing: false)
                emptyHint
            }
        case .offlineNoData:
            ConditionBuilderPageInlineState(
                symbol: "wifi.slash",
                message: ConditionBuilderPageStrings.localize(
                    "automations.builder.geofenceOffline", "Offline — showing no saved places"
                ),
                isError: false,
                onRetry: { geofences.refresh() }
            )
        case let .error(retryable):
            ConditionBuilderPageInlineState(
                symbol: "exclamationmark.triangle.fill",
                message: ConditionBuilderPageStrings.localize(
                    "automations.builder.geofenceError", "Couldn't load saved places"
                ),
                isError: true,
                onRetry: retryable ? { geofences.refresh() } : nil
            )
        }
    }

    private func picker(options: [GeofenceOption], refreshing: Bool) -> some View {
        HStack(spacing: TSSpacing.sm) {
            ConditionBuilderPagePicker(
                accessibilityKey: "automations.builder.geofence",
                accessibilityFallback: "Geofence",
                options: pickerOptions(options),
                selection: selectionBinding,
                maxWidth: 220
            )
            if refreshing { ProgressView().controlSize(.mini) }
        }
    }

    private var loadingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: ConditionBuilderPageStrings.localize(
                "automations.builder.geofenceLoading", "Loading saved places…"
            ))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var emptyHint: some View {
        Text(verbatim: ConditionBuilderPageStrings.localize(
            "automations.builder.geofenceEmpty",
            "No saved places yet."
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
    }

    private func pickerOptions(_ options: [GeofenceOption]) -> [ConditionBuilderPageOption<String>] {
        let emptyOption = ConditionBuilderPageOption(
            tag: "",
            label: ConditionBuilderPageStrings.localize("automations.builder.selectGeofence", "Select geofence...")
        )
        return [emptyOption] + options.map { ConditionBuilderPageOption(tag: $0.id, label: $0.name) }
    }

    private var selectionBinding: Binding<String> {
        Binding(
            get: { ConditionBuilderAdapter.geofenceSelection(placeId: placeId) },
            set: { placeId = ConditionBuilderAdapter.geofencePlaceId(from: $0) }
        )
    }
}

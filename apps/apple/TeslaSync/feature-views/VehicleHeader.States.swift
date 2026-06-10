//
//  VehicleHeader.States.swift
//  TeslaSync — P4 feature view · 0301 · VehicleHeader (Apple)
//
//  The P4 leaf-contract chrome composed by `VehicleHeader` when the surface is not in
//  its data state: the loading skeleton, the empty (no-vehicle) state, and the error
//  state with a retry affordance. Each keeps the header's panel shape + leading back
//  button so the surface never collapses to a blank box. All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — the back button beside skeleton badge + VIN lines, so the
/// header keeps its shape while the parent vehicle query resolves.
struct VehicleHeaderLoadingView: View {
    let onBack: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            VehicleHeaderBackButton(action: onBack)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 88, height: 22, cornerRadius: TSRadius.pill)
                    TSSkeleton(width: 120, height: 18, cornerRadius: TSRadius.pill)
                }
                TSSkeleton(width: 160, height: 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: TSSpacing.md)
            TSSkeleton(width: 104, height: 36, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehicleHeaderStrings.string(
            "vehicleHeader.loadingA11y", "Loading vehicle"
        )))
    }
}

// MARK: - Empty (resolved, no vehicle)

/// The empty render (resolved, no vehicle) — the back button beside a friendly
/// "Vehicle unavailable" message and a disabled wake button, never a blank box.
struct VehicleHeaderEmptyView: View {
    let onBack: () -> Void

    private var title: String {
        VehicleHeaderStrings.string("vehicleHeader.unavailable", "Vehicle unavailable")
    }

    private var detail: String {
        VehicleHeaderStrings.string("vehicleHeader.unavailableDetail", "Select a vehicle to see its details")
    }

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            VehicleHeaderBackButton(action: onBack)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: TSSpacing.md)
            VehicleHeaderWakeButton(waking: false, enabled: false) {}
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state (web `QueryError` peer) — the back button beside an error
/// glyph, the failure copy, and a retry affordance.
struct VehicleHeaderErrorView: View {
    let message: String
    let onBack: () -> Void
    let onRetry: () -> Void

    private var title: String {
        VehicleHeaderStrings.string("vehicleHeader.errorTitle", "Couldn't load vehicle")
    }

    private var retry: String {
        VehicleHeaderStrings.string("vehicleHeader.retry", "Retry")
    }

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            VehicleHeaderBackButton(action: onBack)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: title)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    if !message.isEmpty {
                        Text(verbatim: message)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(2)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: TSSpacing.md)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: retry)
            }
            .accessibilityLabel(Text(verbatim: retry))
        }
        .accessibilityElement(children: .contain)
    }
}

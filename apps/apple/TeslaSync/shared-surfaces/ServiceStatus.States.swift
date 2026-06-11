//
//  ServiceStatus.States.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  The P4 leaf-contract chrome composed by `ServiceStatus` when the surface is not in its data
//  state: the loading skeleton (the dot-row shape as shimmer), the empty state (no `/system/status`
//  value yet — the friendly native parity of the web `if (!data) return null`, never a blank box),
//  and the error tile with a retry affordance (web `QueryError` peer). All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (first `/system/status` fetch in flight)

/// The initial-fetch chrome — a skeleton that keeps the surface's shape (a dot + two text lines)
/// while the first system-status fetch resolves (web `useQuery` before `data` arrives).
struct ServiceStatusLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 12, height: 12, cornerRadius: TSRadius.pill)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(width: 120, height: 12)
                TSSkeleton(width: 80, height: 10)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ServiceStatusStrings.string(
            "service.status.loadingA11y", "Checking system status"
        )))
    }
}

// MARK: - Empty (no value yet — web `if (!data) return null`)

/// The empty render — a friendly card stating that no system-health data is available yet, the
/// native parity of the web dot returning `null` (improved to never collapse to a blank box, per the
/// P4 leaf contract).
struct ServiceStatusEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(ServiceStatusStrings.string(
                    "service.status.empty", "System status unavailable"
                )),
                message: LocalizedStringKey(ServiceStatusStrings.string(
                    "service.status.emptyMessage",
                    "No system health data has been reported yet. It appears here once the backend responds."
                )),
                systemImage: "waveform.path.ecg"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct ServiceStatusErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: ServiceStatusStrings.string(
                    "service.status.errorTitle", "Couldn't load system status"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: ServiceStatusStrings.string("service.status.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: ServiceStatusStrings.string(
                    "service.status.retry", "Retry"
                )))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

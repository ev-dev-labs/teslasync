//
//  TeslaAccountSection.Chrome.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The P4 leaf chrome composed by `TeslaAccountSection`: the freshness chip, the header refresh
//  button, the stale/offline connectivity banner, the loading skeleton (the section silhouette while
//  the auth status resolves), the retryable error view, the auto-dismissing toast (web `useToast`),
//  and the disconnect confirmation sheet (web `ConfirmDialog variant="danger"`). All consume the
//  P1/S10 facade + the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TeslaAccountFreshnessChip: View {
    let connection: TeslaAccountConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: TSSpacing.xs) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: TeslaAccountStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string(descriptor.key, descriptor.fallback)))
    }

    private static func descriptor(for connection: TeslaAccountConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "tesla.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "tesla.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "tesla.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the auth-status snapshot (web page-tick peer).
struct TeslaAccountRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string("tesla.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so a cached
/// status is clearly labeled while reconnecting / offline.
struct TeslaAccountConnectivityBanner: View {
    let connection: TeslaAccountConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tesla.offlineBanner" : "tesla.staleBanner"
        let fallback = offline
            ? "Offline — showing last known account status"
            : "Reconnecting — account status may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: TeslaAccountStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading chrome (section silhouette)

/// The initial-fetch chrome: the section silhouette (icon block + title/subtitle bars, the status
/// pill, and a row of action blocks) while the auth status resolves, keeping the section shape rather
/// than collapsing to nothing.
struct TeslaAccountLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 140, height: 14)
                    TSSkeleton(height: 10)
                }
            }
            TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 120, height: 36, cornerRadius: TSRadius.md)
                TSSkeleton(width: 120, height: 36, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string(
            "tesla.loadingA11y",
            "Loading Tesla account status"
        )))
    }
}

// MARK: - Error chrome (retryable)

/// The fetch-failure state — a retryable "couldn't load" surface (P4 leaf contract; the web section
/// has no error branch).
struct TeslaAccountErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: TeslaAccountStrings.string(
                "tesla.errorTitle",
                "Couldn’t load Tesla account status"
            ))
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: TeslaAccountStrings.string("tesla.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string("tesla.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Toast (web `useToast().success` / `.error`)

/// The auto-dismissing toast — a tone glyph + title + optional detail, posted after an account action
/// succeeds or fails. Honors Reduce Motion for its transition (applied by the parent).
struct TeslaAccountToastView: View {
    let toast: TeslaAccountToast
    let onDismiss: () -> Void

    private var tone: Color {
        toast.kind == .success ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    private var systemImage: String {
        toast.kind == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: toast.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !toast.detail.isEmpty {
                    Text(verbatim: toast.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string("tesla.toast.dismiss", "Dismiss")))
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.18), radius: 12, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: toastAccessibilityLabel))
    }

    private var toastAccessibilityLabel: String {
        toast.detail.isEmpty ? toast.title : "\(toast.title). \(toast.detail)"
    }
}

// MARK: - Disconnect confirm sheet (web `ConfirmDialog variant="danger"`)

/// The disconnect confirmation — the native parity of the web danger `ConfirmDialog`: a tinted warning
/// callout with the "Disconnect Tesla Account?" title + the re-authorize warning, and the Cancel /
/// Disconnect actions. Stays up (loading) until the mutation settles; Cancel is disabled while it is
/// in flight.
struct TeslaAccountDisconnectConfirmSheet: View {
    let model: TeslaAccountModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: TeslaAccountStrings.string(
                        "tesla.disconnectTitle",
                        "Disconnect Tesla Account?"
                    ))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                    Text(verbatim: TeslaAccountStrings.string(
                        "tesla.disconnectConfirm",
                        "Disconnect your Tesla account? You will need to re-authorize to use TeslaSync."
                    ))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.statusDanger.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.25), lineWidth: 1)
            )

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(
                    variant: .ghost,
                    size: .large,
                    action: { model.cancelDisconnect() },
                    label: { Text(verbatim: TeslaAccountStrings.string("common.cancel", "Cancel")) }
                )
                .disabled(model.isDisconnecting)
                .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string("common.cancel", "Cancel")))
                TSButton(
                    variant: .destructive,
                    size: .large,
                    isLoading: model.isDisconnecting,
                    action: { Task { await model.confirmDisconnect() } },
                    label: { Text(verbatim: TeslaAccountStrings.string("tesla.disconnect", "Disconnect")) }
                )
                .accessibilityLabel(Text(verbatim: TeslaAccountStrings.string("tesla.disconnect", "Disconnect")))
                .accessibilityIdentifier("tesla-account-disconnect-confirm")
            }
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minWidth: 320)
        .background(Color.TS.bg)
        .accessibilityElement(children: .contain)
        .teslaAccountSheetDetents()
    }
}

// MARK: - Platform modifiers

extension View {
    /// A medium-detented sheet on iOS/iPadOS; the natural sheet sizing on macOS.
    @ViewBuilder
    func teslaAccountSheetDetents() -> some View {
        #if os(iOS)
            presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        #else
            self
        #endif
    }
}

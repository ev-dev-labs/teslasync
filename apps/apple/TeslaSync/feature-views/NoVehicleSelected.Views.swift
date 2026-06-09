//
//  NoVehicleSelected.Views.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  The presentation primitives the surface composes: the header (web `PageContainer`
//  title + freshness chip), the primary empty state (web `EmptyState` — Car glyph, title,
//  message, onboarding CTA), the "vehicle ready" confirmation (content phase), the error
//  notice (failed selection read → retry), the loading skeleton, and the freshness chip +
//  connectivity banner the native state matrix adds. All render over the shared design
//  tokens (P1/S9) — no hardcoded colors, no English literals (copy via P1/S10).
//

import SwiftUI

// MARK: - Header (web `PageContainer` title + freshness)

/// The surface header: the page title with a freshness chip interposed on the trailing
/// edge when the selection feed is not live (web `PageContainer title`).
struct NoVehicleSelectedHeader: View {
    let title: String
    let connection: NoVehicleSelectedConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            if connection != .live {
                NoVehicleSelectedFreshnessChip(connection: connection)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState` — the primary surface)

/// The defensive empty state — the faithful reproduction of the web `EmptyState`: the Car
/// glyph, the title + message, and the "Set up TeslaSync" CTA that routes to onboarding.
/// Rendered over the shared `TSEmptyState` so it reads natively (`ContentUnavailableView`).
struct NoVehicleSelectedEmptyView: View {
    let title: String
    let message: String
    let actionLabel: String
    let onSetUp: () -> Void

    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(title),
            message: LocalizedStringKey(message),
            systemImage: "car.fill"
        ) {
            TSButton(variant: .primary, size: .medium, action: onSetUp) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.right.circle.fill")
                        .accessibilityHidden(true)
                    Text(verbatim: actionLabel)
                }
            }
            .accessibilityLabel(Text(verbatim: actionLabel))
            .accessibilityHint(Text(verbatim: message))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Vehicle ready (content phase — never a blank box)

/// The content phase: a vehicle IS selected, so the guard's reason to render is gone. A
/// compact confirmation (checkmark + the selected vehicle + a note) stands in for the host
/// page's real data so this branch is never a blank panel.
struct NoVehicleSelectedReadyView: View {
    let vehicleName: String
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: vehicleName)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error notice (failed selection read → retry)

/// The selection-read failure state with a retry affordance (web: the token was revoked
/// between visits). A `QueryError`-style notice so it is never a blank box.
struct NoVehicleSelectedErrorView: View {
    let title: String
    let message: String
    let retryLabel: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: retryLabel)
            }
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading (skeleton chrome)

/// The first-paint loading state: a redacted stand-in for the empty-state composition
/// (glyph + title + message + CTA) so the panel doesn't reflow when the selection resolves.
struct NoVehicleSelectedLoadingView: View {
    let label: String

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 56, height: 56, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 200, height: 16)
            TSSkeleton(width: 260, height: 12)
            TSSkeleton(width: 160, height: 36, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct NoVehicleSelectedFreshnessChip: View {
    let connection: NoVehicleSelectedConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: descriptor.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: descriptor.label))
    }

    private struct Descriptor {
        let tone: Color
        let label: String
    }

    private static func descriptor(for connection: NoVehicleSelectedConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, label: NoVehicleSelectedStrings.string(
                "common.noVehicleSelected.live", "Live"
            ))
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, label: NoVehicleSelectedStrings.string(
                "common.noVehicleSelected.stale", "Stale"
            ))
        case .offline:
            Descriptor(tone: Color.TS.textMuted, label: NoVehicleSelectedStrings.string(
                "common.noVehicleSelected.offline", "Offline"
            ))
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the panel when the bound source is not live, so a
/// cached selection is clearly labeled (ADR-013).
struct NoVehicleSelectedConnectivityBanner: View {
    let connection: NoVehicleSelectedConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "common.noVehicleSelected.offlineBanner" : "common.noVehicleSelected.staleBanner"
        let fallback = offline
            ? "Offline — showing your last known garage"
            : "Reconnecting — this may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            NoVehicleSelectedStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

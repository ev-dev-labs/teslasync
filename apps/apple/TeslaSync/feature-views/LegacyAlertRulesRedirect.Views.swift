//
//  LegacyAlertRulesRedirect.Views.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  The presentational chrome for the legacy Alert Rules redirect: the live-state freshness chip, the
//  stale / offline connectivity banner, the destination breadcrumb (parent › destination + the count of
//  forwarded query parameters), and the resolved confirmation card with a manual Continue affordance.
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). The phase-driven
//  chrome lives in LegacyAlertRulesRedirect.States.swift.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013).
struct LegacyAlertRulesRedirectFreshnessChip: View {
    let connection: AlertRulesRedirectConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            LegacyAlertRulesRedirectStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LegacyAlertRulesRedirectStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: AlertRulesRedirectConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "legacyAlertRulesRedirect.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "legacyAlertRulesRedirect.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "legacyAlertRulesRedirect.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the redirect chrome when the bound source is not live, so the
/// surface is clearly labelled while reconnecting / offline (the redirect still proceeds locally).
struct LegacyAlertRulesRedirectConnectivityBanner: View {
    let connection: AlertRulesRedirectConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline
            ? "legacyAlertRulesRedirect.offlineBanner"
            : "legacyAlertRulesRedirect.staleBanner"
        let fallback = offline
            ? "Offline — the redirect still works; it's a local route change"
            : "Reconnecting — the redirect still works"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            LegacyAlertRulesRedirectStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Destination breadcrumb (parent › destination + forwarded params)

/// The destination breadcrumb: the parent surface, a chevron, the destination name, and — when the
/// inbound `search` carried parameters — a note that they are forwarded (web preserves `search`).
struct LegacyAlertRulesRedirectBreadcrumbRow: View {
    let breadcrumb: AlertRulesRedirectBreadcrumb

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "bell.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: breadcrumb.parentName)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: breadcrumb.destinationName)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
            }
            if breadcrumb.forwardedParameterCount > 0 {
                forwardedNote
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: spokenLabel))
    }

    private var forwardedNote: some View {
        let template = LegacyAlertRulesRedirectStrings.string(
            "legacyAlertRulesRedirect.forwarding",
            "Carrying over %d link parameter(s)"
        )
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: "link")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: String(format: template, breadcrumb.forwardedParameterCount))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
    }

    private var spokenLabel: String {
        let base = "\(breadcrumb.parentName), \(breadcrumb.destinationName)"
        guard breadcrumb.forwardedParameterCount > 0 else { return base }
        let template = LegacyAlertRulesRedirectStrings.string(
            "legacyAlertRulesRedirect.forwarding",
            "Carrying over %d link parameter(s)"
        )
        return "\(base). \(String(format: template, breadcrumb.forwardedParameterCount))"
    }
}

// MARK: - Resolved confirmation card (the dispatched redirect)

/// The resolved state: a success check, the "Opening Alert Rules" confirmation, the destination
/// breadcrumb, and a manual Continue affordance that re-issues the navigation if the host deferred the
/// automatic redirect (web auto-navigates; the native fallback keeps the surface from being a dead end).
struct LegacyAlertRulesRedirectConfirmation: View {
    let breadcrumb: AlertRulesRedirectBreadcrumb
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                LegacyAlertRulesRedirectStrings.text(
                    "legacyAlertRulesRedirect.resolvedTitle",
                    "Opening Alert Rules"
                )
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: 0)
            }
            LegacyAlertRulesRedirectBreadcrumbRow(breadcrumb: breadcrumb)
            LegacyAlertRulesRedirectActionButton(
                titleKey: "legacyAlertRulesRedirect.continue",
                titleFallback: "Continue",
                systemImage: "arrow.right",
                action: onContinue
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

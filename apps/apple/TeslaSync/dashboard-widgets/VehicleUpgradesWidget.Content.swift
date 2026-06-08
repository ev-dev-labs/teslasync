//
//  VehicleUpgradesWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  The content-phase body of the surface: the compact (cols ≤ 1) headline layout
//  and the standard upgrades-list + share-links sections, plus the price /
//  eligibility chips. Split from VehicleUpgradesWidget.swift to keep each file
//  focused.
//

import Foundation
import SwiftUI

// MARK: - Content body (compact + standard layouts)

extension VehicleUpgradesWidget {
    @ViewBuilder
    var contentBody: some View {
        if isCompact {
            compactContent
        } else {
            standardContent
        }
    }

    /// ── Compact (1×2): eligible-upgrade count, or an "Up to date" chip ──
    var compactContent: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            if projection.hasUpgrades {
                Text(verbatim: String(projection.eligibleCount))
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                UpgradesStrings.text("widget.upgrades.available", "available")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                UpgradeChip(text: UpgradesStrings.string("widget.upgrades.upToDate", "Up to date"), tone: .success)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: UpgradesAccessibility.summary(for: projection)))
    }

    /// ── Standard / Wide (2×4+): upgrades list + share-links summary ──
    var standardContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if connection != .live { connectivityBanner }
                upgradesSection
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: 1)
                    .accessibilityHidden(true)
                shareLinksSection
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: UpgradesAccessibility.summary(for: projection)))
    }
}

// MARK: - Upgrades section (web "Available Upgrades")

extension VehicleUpgradesWidget {
    private var upgradesSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            UpgradesStrings.text("widget.upgrades.upgradesHeading", "Available Upgrades")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            if projection.hasUpgrades {
                upgradesList
            } else {
                allAppliedRow
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var upgradesList: some View {
        VStack(spacing: 0) {
            let rows = projection.upgrades
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, upgrade in
                upgradeRow(upgrade)
                if index < rows.count - 1 {
                    Rectangle()
                        .fill(Color.TS.border)
                        .frame(height: 1)
                        .accessibilityHidden(true)
                }
            }
        }
    }

    private func upgradeRow(_ upgrade: ParsedUpgrade) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: upgrade.name)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    if let price = upgrade.price {
                        UpgradeChip(text: "\(projection.currencySymbol)\(price)", tone: .neutral)
                    }
                }
                if let detail = upgrade.detail {
                    Text(verbatim: detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
                if isWide {
                    Text(verbatim: eligibilityLabel(upgrade.eligible))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            Spacer(minLength: TSSpacing.xs)
            UpgradeChip(text: eligibilityLabel(upgrade.eligible), tone: upgrade.eligible ? .success : .neutral)
        }
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Web "All upgrades applied" — the empty branch of the upgrades section.
    private var allAppliedRow: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            UpgradesStrings.text("widget.upgrades.allApplied", "All upgrades applied")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    /// Web `eligible ? 'Eligible' : 'Not eligible'`.
    private func eligibilityLabel(_ eligible: Bool) -> String {
        eligible
            ? UpgradesStrings.string("widget.upgrades.eligible", "Eligible")
            : UpgradesStrings.string("widget.upgrades.notEligible", "Not eligible")
    }
}

// MARK: - Share links section (web "Share Links")

extension VehicleUpgradesWidget {
    private var shareLinksSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "link")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                UpgradesStrings.text("widget.upgrades.shareLinksHeading", "Share Links")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            if projection.hasActiveShareLinks {
                shareLinksSummary
            } else {
                noShareLinksRow
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var shareLinksSummary: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack {
                UpgradesStrings.text("widget.upgrades.activeLinks", "Active links")
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .tracking(0.5)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: 0)
                Text(verbatim: String(projection.activeShareLinkCount))
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .accessibilityElement(children: .combine)
            if let expiry = projection.nearestExpiryText {
                HStack {
                    UpgradesStrings.text("widget.upgrades.nearestExpiry", "Nearest expiry")
                        .font(Font.TS.caption)
                        .textCase(.uppercase)
                        .tracking(0.5)
                        .foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: 0)
                    UpgradeChip(text: expiry, tone: .warning)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// Web `<EmptyState … message="No active share links" />`.
    private var noShareLinksRow: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "link")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            UpgradesStrings.text("widget.upgrades.noShareLinks", "No active share links")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - UpgradeChip (verbatim-text capsule — web `<Badge size="sm">`)

/// A capsule chip styled with the shared `TSBadge` design tokens, but rendering a
/// *verbatim* (already-localized or dynamic) string. The shared `TSBadge` accepts
/// only a `LocalizedStringKey`, which would re-localize a price like "$2000" or a
/// pre-resolved label; this chip avoids that double-localization.
private struct UpgradeChip: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: text))
    }
}

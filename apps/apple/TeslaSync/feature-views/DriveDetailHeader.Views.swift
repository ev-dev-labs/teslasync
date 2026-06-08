//
//  DriveDetailHeader.Views.swift
//  TeslaSync — P4 feature view · 0137 · DriveDetailHeader (Apple)
//
//  The presentational chrome composed by `DriveDetailHeader`: the back affordance, the route/title
//  row, the vehicle + timestamp subtitle, the Replay / Share actions, the freshness chip, the loading
//  skeleton, and the inline empty / error states. All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Back affordance (web `<Link to="/drives"><ArrowLeft/></Link>`)

/// The leading back button: an arrow glyph in a rounded, bordered control that pops the drive-detail
/// route. Carries a VoiceOver label since it is icon-only.
struct DriveDetailHeaderBackButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.left")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 40, height: 40)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(DriveDetailHeaderStrings.text("driveDetail.back", "Back to drives"))
    }
}

// MARK: - Title + subtitle (web `<h1>` route/fallback + `<p>` subtitle)

/// The route (or "Drive Details" fallback) title prefixed by the cyan route glyph, with the vehicle +
/// timestamp subtitle below — the parity of the web `<h1>`/`<p>` block. The whole block is one
/// accessibility header element so VoiceOver reads it as a unit.
struct DriveDetailHeaderTitleBlock: View {
    let projection: DriveHeaderProjection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: projection.resolvedTitle)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(verbatim: projection.subtitle)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(verbatim: DriveDetailHeaderAccessibility.summary(for: projection)))
    }
}

// MARK: - Actions (web ghost `Button` Replay + Share)

/// One ghost action button: a small leading glyph + a localized label, the parity of the web
/// `<Button variant="ghost" size="sm" icon=…>`. The glyph is decorative; the label carries a11y.
struct DriveDetailHeaderActionButton: View {
    let titleKey: String
    let titleFallback: String
    let systemImage: String
    let action: () -> Void

    private var title: String {
        DriveDetailHeaderStrings.string(titleKey, titleFallback)
    }

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .lineLimit(1)
            }
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}

/// The trailing Replay + Share action pair. Laid out with `ViewThatFits` so they sit side-by-side on
/// wide (iPad / Mac) windows and stack on a compact iPhone width without truncating.
struct DriveDetailHeaderActions: View {
    let onReplay: () -> Void
    let onShare: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) { buttons }
            VStack(alignment: .trailing, spacing: TSSpacing.xs) { buttons }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder private var buttons: some View {
        DriveDetailHeaderActionButton(
            titleKey: "driveDetail.replay",
            titleFallback: "Replay",
            systemImage: "play.fill",
            action: onReplay
        )
        DriveDetailHeaderActionButton(
            titleKey: "driveDetail.share",
            titleFallback: "Share",
            systemImage: "square.and.arrow.up",
            action: onShare
        )
    }
}

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a localized
/// label, and an optional relative "updated" stamp. Shown only while fetching or when not live.
struct DriveDetailHeaderFreshnessChip: View {
    let connection: DriveHeaderConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return DriveDetailHeaderStrings.string("driveDetail.updating", "Updating")
        }
        switch connection {
        case .live: return DriveDetailHeaderStrings.string("driveDetail.live", "Live")
        case .stale: return DriveDetailHeaderStrings.string("driveDetail.stale", "Stale")
        case .offline: return DriveDetailHeaderStrings.string("driveDetail.offline", "Offline")
        }
    }
}

// MARK: - Loading skeleton (web shell skeleton chrome)

/// The initial-fetch skeleton chrome: the real back affordance, a skeleton title + subtitle bar, and
/// two skeleton action chips — the masthead silhouette while the drive loads. Reduce-Motion safe via
/// the shared `TSSkeleton`.
struct DriveDetailHeaderSkeleton: View {
    let onBack: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            DriveDetailHeaderBackButton(action: onBack)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 240, height: 22)
                TSSkeleton(width: 180, height: 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 84, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 76, height: 28, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DriveDetailHeaderStrings.text("driveDetail.loading", "Loading drive details"))
    }
}

// MARK: - Empty (drive unavailable — never a blank box)

/// The empty branch (no drive resolved): the back affordance plus the localized "Drive Details"
/// fallback title and a friendly caption, so the masthead is never a blank box.
struct DriveDetailHeaderEmpty: View {
    let onBack: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            DriveDetailHeaderBackButton(action: onBack)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                        .font(Font.TS.section)
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    Text(verbatim: DriveDetailHeaderStrings.string("driveDetail.title", "Drive Details"))
                        .font(Font.TS.title)
                        .fontWeight(.bold)
                        .foregroundStyle(Color.TS.textPrimary)
                }
                Text(verbatim: DriveDetailHeaderStrings.string("driveDetail.unavailable", "Drive details unavailable"))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        }
    }
}

// MARK: - Error (web `QueryError` equivalent with retry)

/// The error branch: the back affordance, a danger glyph, the failure copy + the underlying message,
/// and a Retry control wired to `model.refresh()` — the masthead parity of the web `QueryError`.
struct DriveDetailHeaderErrorView: View {
    let message: String
    let onBack: () -> Void
    let onRetry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            DriveDetailHeaderBackButton(action: onBack)
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: DriveDetailHeaderStrings.string(
                        "driveDetail.errorTitle",
                        "Couldn't load drive details"
                    ))
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
            .accessibilityElement(children: .combine)
            retryButton
        }
    }

    private var retryButton: some View {
        let title = DriveDetailHeaderStrings.string("driveDetail.retry", "Retry")
        return TSButton(variant: .secondary, size: .small, action: onRetry) {
            Text(verbatim: title).lineLimit(1)
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}

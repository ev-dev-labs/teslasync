//
//  ConflictWarnings.Views.swift
//  TeslaSync — P4 feature view · 0084 · ConflictWarnings (Apple)
//
//  The presentational core composed by the surface: the toned conflict banner
//  (web `AlertBanner` from @/components/feedback — mirrored over the shared
//  `TSAlertBanner` visual contract, but resolving its constant title through the
//  per-surface P1/S10 facade and rendering the dynamic `"{name}": {reason}` body
//  verbatim, since that body is user data, not a catalog key), plus the P4
//  states-contract chrome the web leaf delegates to its parent: the loading
//  skeleton, the never-a-blank-box empty state, the query-error retry, and the
//  stale/offline status chips. All consume the P1/S10 facade + shared P1/S9
//  tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Conflict banner (web `<AlertBanner variant icon title>{body}</AlertBanner>`)

/// One conflict row as a tinted, bordered banner: a leading severity SF Symbol
/// (`AlertTriangle` → `exclamationmark.triangle.fill`, `Info` →
/// `info.circle.fill`), the constant localized title, and the verbatim
/// `"{name}": {reason}` body. Mirrors `TSAlertBanner` (tone fill 0.1 + stroke 0.3,
/// `TSRadius.md`) so it reads identically to the shared feedback component.
struct ConflictWarningBanner: View {
    let row: ConflictWarningRow

    private var tone: TSTone {
        row.severity == .warning ? .warning : .info
    }

    private var title: String {
        CWCopy.title.resolved(CWStrings.string)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: row.iconSystemName)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: row.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        ConflictWarningsAccessibility.bannerSummary(
            title: title,
            severityWord: CWCopy.severityWord(for: row.severity).resolved(CWStrings.string),
            detail: row.detail
        )
    }
}

/// The list of conflict banners (web `<div className="space-y-2">{conflicts.map(…)}`).
struct ConflictWarningsList: View {
    let rows: [ConflictWarningRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                ConflictWarningBanner(row: row)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading chrome (P4 states contract)

/// The initial conflict-check load: two redacted banner rows over the shared
/// `TSSkeleton`, never a frozen/blank panel.
struct ConflictWarningsLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 2, id: \.self) { _ in
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(CWStrings.text(CWCopy.loading.key, CWCopy.loading.fallback))
    }
}

// MARK: - Empty state (native treatment of web `if (length === 0) return null`)

/// The healthy "no conflicts" outcome. The web leaf renders nothing; the native
/// surface shows a friendly `ContentUnavailableView` (the primitive the shared
/// `TSEmptyState` wraps) so the panel is never a blank box.
struct ConflictWarningsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: CWCopy.emptyTitle.resolved(CWStrings.string))
            } icon: {
                Image(systemName: "checkmark.shield")
            }
        } description: {
            Text(verbatim: CWCopy.emptyMessage.resolved(CWStrings.string))
        }
        .accessibilityLabel(Text(verbatim: emptyA11y))
    }

    private var emptyA11y: String {
        let title = CWCopy.emptyTitle.resolved(CWStrings.string)
        let message = CWCopy.emptyMessage.resolved(CWStrings.string)
        return "\(title). \(message)"
    }
}

// MARK: - Error chrome (web `QueryError` equivalent — parent query failure)

/// The conflict-check failure branch: the shared `TSErrorDisplay`/`TSQueryError`
/// look (danger glyph + message + retry), resolved through the per-surface facade
/// and delegating retry to the bound source's `refresh`.
struct ConflictWarningsError: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: CWCopy.errorMessage.resolved(CWStrings.string))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            ConflictRetryButton(action: onRetry)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

/// The native retry control (web leaf delegates the fetch to its parent and has
/// no retry; this is the states-contract affordance, wired to `refresh`).
struct ConflictRetryButton: View {
    let action: () -> Void

    var body: some View {
        let label = CWCopy.retry.resolved(CWStrings.string)
        return Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Status chips (P4 stale + offline chrome)

/// A tinted status chip mirroring `TSBadge` (capsule, tone fill 0.15 + stroke
/// 0.3) but resolving its label through the per-surface facade. Used for the
/// stale + offline banners the web leaf has no notion of.
struct ConflictStatusChip: View {
    let copy: CWText
    let tone: TSTone
    let systemImage: String

    var body: some View {
        let label = copy.resolved(CWStrings.string)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityLabel(Text(verbatim: label))
    }
}

//
//  AnnotationList.Views.swift
//  TeslaSync — P4 shared surface · 0063 · AnnotationList (Apple)
//
//  The presentational subviews composed by `AnnotationList`, reproducing the web
//  `components/charts/AnnotationList.tsx` body: the uppercase "Annotations" title, the per-row
//  category swatch + label + (responsively hidden) description + timestamp + ghost remove control,
//  plus the P4 leaf chrome (loading skeleton, friendly empty state, query-error retry, freshness
//  chip). All copy arrives pre-localized through the resolved model (P1/S10); all colour comes from
//  the P1/S9 tokens (the per-category swatch is decoded from the verbatim `ANNOTATION_COLORS` hex);
//  the shared `TSButton` / `TSSkeleton` / `TSFadeIn` primitives are reused. No networking, no
//  Tailwind ports, no raw hex literals.
//

import SwiftUI

// MARK: - Category swatch (web `ANNOTATION_COLORS[category]` dot)

/// Builds the per-category dot tint from the verbatim `ANNOTATION_COLORS` `#rrggbb` swatch, falling
/// back to the accent token when a value is malformed. A dynamic, data-driven colour applied at the
/// SwiftUI boundary (not a static chrome colour), decoded by the pure ``AnnotationListPalette``.
func annotationListColor(_ hex: String) -> Color {
    guard let parts = AnnotationListPalette.components(forHex: hex) else {
        return Color.TS.accent
    }
    return Color(.sRGB, red: parts.red, green: parts.green, blue: parts.blue, opacity: 1)
}

/// The small category colour dot (web `h-2 w-2 rounded-full`). Decorative — the category name is
/// spoken as part of the row's combined accessibility label.
struct AnnotationCategoryDot: View {
    let colorHex: String

    var body: some View {
        Circle()
            .fill(annotationListColor(colorHex))
            .frame(width: 8, height: 8)
            .accessibilityHidden(true)
    }
}

// MARK: - Row description (web `hidden … sm:inline`)

/// The optional secondary description — the native port of the web `hidden truncate … sm:inline`
/// rule: shown on regular width (iPad / macOS), hidden on compact width (iPhone). Always folded into
/// the row's combined accessibility label, so hiding it visually never hides it from VoiceOver.
struct AnnotationRowDescription: View {
    let text: String?

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    var body: some View {
        if let text, !text.isEmpty, isWide {
            Text(verbatim: "— \(text)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityHidden(true)
        }
    }

    private var isWide: Bool {
        #if os(iOS)
            sizeClass != .compact
        #else
            true
        #endif
    }
}

// MARK: - Remove control (web ghost `X` button)

/// The per-row remove control — the native port of the web ghost `Button` with the lucide `X` icon
/// (`aria-label` "Remove annotation"). Rests in the muted tone and shifts to the danger tone on
/// hover (pointer) the way the web `hover:!text-red-400` does; the spoken label names the row.
struct AnnotationRemoveButton: View {
    let accessibilityLabel: String
    let onRemove: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onRemove) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(hovering ? Color.TS.statusDanger : Color.TS.textMuted)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Row (web annotation row)

/// One annotation row — the swatch, the label, the responsively-hidden description, the
/// right-aligned timestamp, and the remove control inside a bordered, lightly-filled container (web
/// `rounded-lg border bg-gray-50`). The text content reads as one VoiceOver element (the combined
/// label); the remove control is a separate, reachable element.
struct AnnotationRowView: View {
    let row: AnnotationListRow
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                AnnotationCategoryDot(colorHex: row.colorHex)
                Text(verbatim: row.label)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                AnnotationRowDescription(text: row.description)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: row.timestamp)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: row.accessibilityLabel))

            AnnotationRemoveButton(accessibilityLabel: row.removeAccessibilityLabel, onRemove: onRemove)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the title when the snapshot is not live — a coloured dot + label
/// that re-requests the annotations on tap (stale / offline recovery). Warning tone for stale, muted
/// tone for offline.
struct AnnotationListFreshnessChip: View {
    let freshness: AnnotationListFreshness
    let onRefresh: () -> Void

    private var tone: Color {
        freshness.isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: 6, height: 6)
                Text(verbatim: freshness.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: freshness.accessibilityLabel))
    }
}

// MARK: - Header (web uppercase title + freshness)

/// The list header — the uppercase "Annotations" title (web `uppercase tracking-wider`) plus the
/// freshness chip when the snapshot is not live.
struct AnnotationListHeaderView: View {
    let title: String
    let freshness: AnnotationListFreshness?
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .tracking(TSTypeMetrics.labelTracking)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            if let freshness {
                AnnotationListFreshnessChip(freshness: freshness, onRefresh: onRefresh)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Populated (web rendered list)

/// The populated list — the header over the bordered annotation rows. The native parity of the web
/// rendered `AnnotationList`, extended with the P4 freshness chip.
struct AnnotationListPopulatedView: View {
    let title: String
    let freshness: AnnotationListFreshness?
    let rows: [AnnotationListRow]
    let onRefresh: () -> Void
    let onRemove: (String) -> Void

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                AnnotationListHeaderView(title: title, freshness: freshness, onRefresh: onRefresh)
                ForEach(rows) { row in
                    AnnotationRowView(row: row) { onRemove(row.id) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading (web parent fetch → skeleton)

/// The skeleton chrome shown while the annotations resolve — a title shimmer over three row shimmers
/// that mirror the populated layout. Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct AnnotationListLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 90, height: 10)
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 8, height: 8, cornerRadius: TSRadius.pill)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 64, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AnnotationListStrings.string(
            "annotation.loadingA11y",
            "Loading annotations"
        )))
    }
}

// MARK: - Empty (P4 "never a blank box")

/// The friendly empty state shown when the list resolves with no annotations under the `.emptyState`
/// policy — the P4 stand-in for the web `null` collapse, so the standalone surface is never blank.
struct AnnotationListEmptyView: View {
    let content: AnnotationListEmpty

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: content.title)
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            Text(verbatim: content.message)
        }
    }
}

// MARK: - Error (web `QueryError` peer)

/// The query-failure state shown when the annotations fetch fails — an inline error with a retry
/// affordance (the native peer of the web `QueryError`). Never a blank box (P4).
struct AnnotationListErrorView: View {
    let content: AnnotationListErrorContent
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: content.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AnnotationListStrings.string("annotation.error.retry", "Retry"))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: content.accessibilityLabel))
    }
}

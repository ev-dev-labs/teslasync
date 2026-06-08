//
//  SuggestedPrompts.Views.swift
//  TeslaSync — P4 feature view · 0223 · SuggestedPrompts (Apple)
//
//  The presentational subviews composed by `SuggestedPrompts`: the suggestion chip
//  (web ghost `Button` → a capsule with the sparkle glyph + label), the wrapping,
//  centered flow layout (web `flex flex-wrap gap-2 justify-center max-w-2xl mx-auto`),
//  and the loading / empty / error chrome for the P4 leaf states. All consume the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no
//  raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the sparkle accent and the pressed
//  chip border use `chartSeriesPower` (the brand purple that equals the web
//  `purple-500` hover), the chip fill/stroke use the neutral surface/border tokens,
//  and the chip label uses `textSecondary` so it reads as a calm affordance rather
//  than body copy.
//

import SwiftUI

// MARK: - Layout metrics

/// The shared sizing constants for the strip — kept here so the view, the loading
/// skeleton, and the previews stay in lock-step with the web measurements.
enum SuggestedPromptsMetrics {
    /// Web `max-w-2xl` (42rem) — the centered strip's maximum width.
    static let maxStripWidth: CGFloat = 672
    /// Vertical chip padding (web `size="sm"` ≈ 6pt top/bottom).
    static let chipVerticalPadding: CGFloat = 6
    /// The sparkle glyph point size (web `h-3.5 w-3.5` ≈ 12pt).
    static let iconPointSize: CGFloat = 12
    /// Skeleton chip widths for the loading strip (varied, for a natural shape).
    static let skeletonWidths: [CGFloat] = [168, 132, 208, 150]
    /// Skeleton chip height (matches a single-line resolved chip).
    static let skeletonHeight: CGFloat = 32
}

// MARK: - Suggestion chip (web ghost `Button` with the `Sparkles` icon)

/// One suggestion chip — a capsule carrying the sparkle glyph and the resolved prompt
/// text, reporting the text through `action` on tap (web `onClick={() => onPick(text)}`).
/// It is a real button so VoiceOver, Full Keyboard Access, and pointer hover all work.
struct SuggestedPromptChip: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles")
                    .font(.system(size: SuggestedPromptsMetrics.iconPointSize, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesPower)
                    .accessibilityHidden(true)
                Text(verbatim: text)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, SuggestedPromptsMetrics.chipVerticalPadding)
            .padding(.horizontal, TSSpacing.md)
        }
        .buttonStyle(SuggestedPromptChipStyle())
        .accessibilityLabel(Text(verbatim: SuggestedPromptsAccessibility.chipLabel(for: text)))
        .accessibilityHint(Text(verbatim: SuggestedPromptsAccessibility.chipHint()))
        .accessibilityAddTraits(.isButton)
    }
}

/// The chip styling — a continuous capsule with the neutral surface fill + border,
/// shifting to the brand-purple border while pressed (the web `hover:border-purple`).
/// The press dim is a static opacity change so it is inert under Reduce Motion.
struct SuggestedPromptChipStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Color.TS.surface, in: Capsule(style: .continuous))
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(borderColor(pressed: configuration.isPressed), lineWidth: 1)
            )
            .contentShape(Capsule(style: .continuous))
            .opacity(configuration.isPressed ? 0.75 : 1)
    }

    private func borderColor(pressed: Bool) -> Color {
        pressed ? Color.TS.chartSeriesPower.opacity(0.4) : Color.TS.border
    }
}

// MARK: - Flow layout (web `flex flex-wrap gap-2 justify-center`)

/// A wrapping, horizontally-centered flow layout — the native equivalent of the web
/// `flex flex-wrap justify-center` strip. Chips flow left-to-right, wrap to a new line
/// when the next chip would exceed the proposed width, and each line is centered.
struct SuggestedPromptsFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = rows(maxWidth: maxWidth, subviews: subviews)
        let height = totalHeight(of: rows)
        let width = proposal.width ?? rows.map(\.width).max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let rows = rows(maxWidth: bounds.width, subviews: subviews)
        var originY = bounds.minY
        for row in rows {
            var originX = bounds.minX + (bounds.width - row.width) / 2
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(x: originX, y: originY),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(size)
                )
                originX += size.width + spacing
            }
            originY += row.height + spacing
        }
    }

    // MARK: Row packing

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let projected = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if !current.indices.isEmpty, projected > maxWidth {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty {
            rows.append(current)
        }
        return rows
    }

    private func totalHeight(of rows: [Row]) -> CGFloat {
        guard !rows.isEmpty else { return 0 }
        let stacked = rows.reduce(0) { $0 + $1.height }
        return stacked + spacing * CGFloat(rows.count - 1)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton capsules laid out by the same flow layout, so
/// the strip keeps its centered, wrapping shape while the feed resolves.
struct SuggestedPromptsLoadingView: View {
    var body: some View {
        SuggestedPromptsFlowLayout(spacing: TSSpacing.sm) {
            ForEach(SuggestedPromptsMetrics.skeletonWidths.indices, id: \.self) { index in
                TSSkeleton(
                    width: SuggestedPromptsMetrics.skeletonWidths[index],
                    height: SuggestedPromptsMetrics.skeletonHeight,
                    cornerRadius: TSRadius.pill
                )
            }
        }
        .frame(maxWidth: SuggestedPromptsMetrics.maxStripWidth)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(SuggestedPromptsStrings.text("chatbot.suggestion.loading", "Loading suggestions"))
    }
}

/// The empty render (the future backend-fed "no suggestions" case): a friendly state,
/// never a blank box.
struct SuggestedPromptsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SuggestedPromptsStrings.text("chatbot.suggestion.empty", "No suggestions right now.")
            } icon: {
                Image(systemName: "sparkles")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct SuggestedPromptsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SuggestedPromptsStrings.text("chatbot.suggestion.errorTitle", "Couldn't load suggestions")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                SuggestedPromptsStrings.text("chatbot.suggestion.retry", "Retry")
            }
            .accessibilityLabel(SuggestedPromptsStrings.text("chatbot.suggestion.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

//
//  UptimeHeatmap.Views.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  The presentational pieces of the rolling N-day status grid: the status / tier → semantic-tone token
//  projections (the web `SQUARE_BG` fills + the caption ternary hues), the wrapping square layout (web
//  `flex flex-wrap gap-1`), one day square with its tap popover (web per-square `Tooltip` + `<button>`),
//  the friendly empty state, and the content view that assembles them inside a glass panel (web
//  `GlassPanel`). All chrome is token-driven (P1/S9); hover honours Reduce Motion; no raw hex, no
//  Tailwind ports.
//
//  Web-parity detail, reproduced faithfully:
//    • each square's fill comes from its status (web `SQUARE_BG`), mapped to the shared ``TSTone`` tokens
//      so it recolours across light / dark / high-contrast; the faint hover lighten mirrors the web
//      `hover:bg-*-300`.
//    • tapping a square reveals its day's date + status label + optional summary (web `Tooltip` content);
//      on macOS the same content is the hover `help` tooltip.
//    • the uptime caption is tinted by its tier — green / amber / red bands (web caption ternary).
//    • the squares pack tightly left-to-right and wrap (web `flex-wrap`), leaving trailing slack rather
//      than stretching, exactly like the web row.
//

import SwiftUI

// MARK: - UptimeStatus → semantic tone tokens (web `SQUARE_BG` fills)

extension UptimeStatus {
    /// The semantic tone — the theme-aware token projection of the web status fills (`healthy → success`,
    /// `degraded → warning`, `unhealthy → danger`, `unknown → neutral`, `maintenance → info`). Reuses the
    /// shared ``TSTone`` so the squares recolour across light / dark / high-contrast, where the web fixed
    /// `*-400` hues did not.
    var tone: TSTone {
        switch self {
        case .healthy: .success
        case .degraded: .warning
        case .unhealthy: .danger
        case .unknown: .neutral
        case .maintenance: .info
        }
    }

    /// The resolved square fill colour (web `SQUARE_BG[status]`).
    var color: Color {
        tone.color
    }
}

// MARK: - UptimeTier → semantic tone tokens (web caption ternary)

extension UptimeTier {
    /// The semantic tone for the uptime caption — `high → success` (web green), `medium → warning` (web
    /// amber), `low → danger` (web red).
    var tone: TSTone {
        switch self {
        case .high: .success
        case .medium: .warning
        case .low: .danger
        }
    }

    /// The resolved caption text colour (web `text-green/amber/red-400`).
    var color: Color {
        tone.color
    }
}

// MARK: - UptimeHeatmapFlowLayout (web `flex flex-wrap gap-1`)

/// A lightweight wrapping layout — squares flow left-to-right and wrap to the next line, leading-aligned,
/// the Apple-idiomatic shape for the web `flex flex-wrap gap-1` row (tight packing, trailing slack)
/// versus an evenly-distributed grid. Owned by this surface (a small, self-contained primitive) so it
/// stays within the prompt's file scope.
struct UptimeHeatmapFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.xs

    private struct Line {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func lines(maxWidth: CGFloat, sizes: [CGSize]) -> [Line] {
        var result: [Line] = []
        var current = Line()
        for (index, size) in sizes.enumerated() {
            let projected = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if !current.indices.isEmpty, projected > maxWidth {
                result.append(current)
                current = Line(indices: [index], width: size.width, height: size.height)
            } else {
                current.width = projected
                current.height = max(current.height, size.height)
                current.indices.append(index)
            }
        }
        if !current.indices.isEmpty {
            result.append(current)
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let maxWidth = proposal.width ?? sizes.reduce(0) { $0 + $1.width }
        let computed = lines(maxWidth: maxWidth, sizes: sizes)
        let width = computed.map(\.width).max() ?? 0
        let height = computed.reduce(0) { $0 + $1.height }
            + CGFloat(max(0, computed.count - 1)) * spacing
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal _: ProposedViewSize,
        subviews: Subviews,
        cache _: inout Void
    ) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let computed = lines(maxWidth: bounds.width, sizes: sizes)
        var originY = bounds.minY
        for line in computed {
            var originX = bounds.minX
            for index in line.indices {
                let size = sizes[index]
                subviews[index].place(
                    at: CGPoint(x: originX, y: originY + (line.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                originX += size.width + spacing
            }
            originY += line.height + spacing
        }
    }
}

// MARK: - UptimeDaySquareView (web per-square `Tooltip` + `<button>`)

/// One day square — the native peer of the web per-day `<button>` wrapped in a `Tooltip`. A small tinted
/// rounded square (web `h-3 w-3 rounded-sm`, status fill) that reveals the day's date + status label +
/// optional summary in a popover on tap (web `Tooltip` content), with the same content as the macOS
/// hover `help`. Carries the composed "{date}: {status}" VoiceOver label (web square `aria-label`) and
/// the summary as its accessibility value.
struct UptimeDaySquareView: View {
    let square: ResolvedUptimeSquare

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false
    @State private var isShowingDetail = false

    private static let side: CGFloat = 12

    var body: some View {
        Button { isShowingDetail.toggle() } label: {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(square.status.color.opacity(isHovering ? 1 : 0.85))
                .frame(width: Self.side, height: Self.side)
                .contentShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(TSAnimation.fast(reduceMotion: reduceMotion)) { isHovering = hovering }
        }
        .help(Text(verbatim: helpText))
        .accessibilityLabel(Text(verbatim: square.accessibilityLabel))
        .accessibilityValue(Text(verbatim: square.summary ?? ""))
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $isShowingDetail) {
            UptimeDayDetailView(square: square).presentationCompactAdaptation(.popover)
        }
    }

    /// The macOS hover tooltip text — "{date}: {status}" plus the summary on a second line when present.
    private var helpText: String {
        guard let summary = square.summary, !summary.isEmpty else { return square.accessibilityLabel }
        return "\(square.accessibilityLabel)\n\(summary)"
    }
}

// MARK: - UptimeDayDetailView (web `Tooltip` content)

/// The popover content for one day — the native peer of the web `Tooltip` body: the date (bold), the
/// status label, and the optional summary beneath a divider (web `day.summary` block).
struct UptimeDayDetailView: View {
    let square: ResolvedUptimeSquare

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: square.dateText)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: square.statusLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            if let summary = square.summary, !summary.isEmpty {
                Divider().overlay(Color.TS.border)
                Text(verbatim: summary)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 240, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - UptimeHeatmapEmptyView (native — never a blank box)

/// The friendly empty state shown in the grid region when the window has no days (web renders a bare
/// empty grid; the native HIG calls for a labelled empty rather than a blank box). A compact icon + title
/// + message, spoken as one VoiceOver element.
struct UptimeHeatmapEmptyView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "calendar")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - UptimeHeatmapContentView (web `UptimeHeatmap` body)

/// The rolling status grid — the native peer of the web `UptimeHeatmap` body. A glass panel (web
/// `GlassPanel`) holding the heading + uptime caption header, the wrapping square grid (or the friendly
/// empty state), and the optional footnote. A pure function of the bound model's resolved values.
struct UptimeHeatmapContentView: View {
    let model: UptimeHeatmapModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.isEmpty {
                    UptimeHeatmapEmptyView(title: model.emptyTitle, message: model.emptyMessage)
                } else {
                    grid
                }
                if let footnote = model.footnote, !footnote.isEmpty {
                    Text(verbatim: footnote)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The header row — the heading (web `h3`) and, when the window is non-empty, the tier-tinted uptime
    /// caption (web `{fmtPercent} uptime`).
    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: model.heading)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if let caption = model.uptimeCaption, let tier = model.tier {
                Text(verbatim: caption)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .monospacedDigit()
                    .foregroundStyle(tier.color)
            }
        }
    }

    /// The wrapping square grid (web `flex flex-wrap`), labelled "Daily status history" (web grid
    /// `aria-label`) as one VoiceOver container its squares nest under.
    private var grid: some View {
        UptimeHeatmapFlowLayout(spacing: TSSpacing.xs) {
            ForEach(model.resolvedSquares) { square in
                UptimeDaySquareView(square: square)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.gridAccessibilityLabel))
    }
}

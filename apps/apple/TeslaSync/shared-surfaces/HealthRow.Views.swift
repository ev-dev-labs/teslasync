//
//  HealthRow.Views.swift
//  TeslaSync — P4 shared surface · 0197 · HealthRow (Apple)
//
//  The presentational pieces of the single-line health summary row: the status → semantic-tone token
//  projection (the web `*-400` dot/text hues) and the content view — the native peer of the web
//  composition (the status dot, the optional decorative icon, the truncating label, the status-tinted
//  summary, and the trailing chevron, wrapped as a link / button when the source supplies `to` /
//  `onClick`). All chrome is token-driven (P1/S9); the hover tint honours Reduce Motion; no raw hex, no
//  Tailwind ports.
//
//  Web-parity detail, reproduced faithfully:
//    • the status drives BOTH the leading dot's fill and the summary text's colour (web `DOT_FOR_STATUS`
//      + `TEXT_FOR_STATUS`), mapped to the shared ``TSTone`` tokens so it recolours across themes.
//    • the label is the single flexible, truncating run (web `flex-1 truncate`); the summary holds its
//      intrinsic width (web `shrink-0`), so a long label truncates before the summary is squeezed.
//    • the chevron renders only when the row is navigable (web `(to || onClick) && <ChevronRight/>`).
//    • interactive rows reveal a faint hover fill (web `hover:bg-white/[0.04]`, the `surfaceGlass`
//      token); inert summary rows have none.
//

import SwiftUI

// MARK: - HealthRowStatus → semantic tone tokens (web dot/text hues)

extension HealthRowStatus {
    /// The semantic tone — the theme-aware token projection of the web status hues (`healthy → success`,
    /// `degraded → warning`, `unhealthy → danger`, `unknown → neutral`, `maintenance → info`). Reuses
    /// the shared ``TSTone`` so the dot + summary recolour across light / dark / high-contrast, where
    /// the web fixed `*-400` hues did not.
    var tone: TSTone {
        switch self {
        case .healthy: .success
        case .degraded: .warning
        case .unhealthy: .danger
        case .unknown: .neutral
        case .maintenance: .info
        }
    }

    /// The resolved status colour for the dot fill + the summary text (web `DOT_FOR_STATUS` /
    /// `TEXT_FOR_STATUS`).
    var color: Color {
        tone.color
    }
}

// MARK: - HealthRowContentView (web composition)

/// The health row — the native peer of the web `HealthRow` body. A pure function of its projection +
/// the optional icon slot + the activation closure: it renders the status dot, the decorative icon, the
/// truncating label, the status-tinted summary, and the chevron, and wraps the body in a link / button
/// element when the source supplies `to` / `onClick`.
struct HealthRowContentView: View {
    let projection: HealthRowProjection
    let accessibilityLabel: String
    let accessibilityHint: String?
    let icon: AnyView?
    let perform: (@MainActor () -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false

    var body: some View {
        if projection.isNavigable, let perform {
            Button(action: perform) { rowBody }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: accessibilityLabel))
                .accessibilityHint(hintText)
                .accessibilityAddTraits(projection.accessibilityIsLink ? .isLink : [])
        } else {
            rowBody
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: accessibilityLabel))
        }
    }

    private var hintText: Text {
        accessibilityHint.map { Text(verbatim: $0) } ?? Text(verbatim: "")
    }

    // MARK: Row body (dot · icon · label · summary · chevron)

    private var rowBody: some View {
        HStack(spacing: TSSpacing.md) {
            dot
            if projection.showsIcon, let icon {
                icon
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityHidden(true)
            }
            Text(projection.label)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(projection.summary)
                .font(Font.TS.caption)
                .foregroundStyle(projection.status.color)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            if projection.showsChevron {
                chevron
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.md)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .background(hoverBackground)
        .onHover { hovering in
            withAnimation(TSAnimation.fast(reduceMotion: reduceMotion)) { isHovering = hovering }
        }
    }

    private var dot: some View {
        Circle()
            .fill(projection.status.color)
            .frame(width: 10, height: 10)
            .accessibilityHidden(true)
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    /// The faint hover fill on interactive rows (web `hover:bg-white/[0.04]`); inert rows have none.
    @ViewBuilder
    private var hoverBackground: some View {
        if projection.isNavigable {
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.surfaceGlass)
                .opacity(isHovering ? 1 : 0)
        }
    }
}

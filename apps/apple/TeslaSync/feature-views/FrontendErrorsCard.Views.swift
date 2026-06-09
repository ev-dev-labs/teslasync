//
//  FrontendErrorsCard.Views.swift
//  TeslaSync — P4 feature view · 0243 · FrontendErrorsCard (Apple)
//
//  The presentational subviews composed by `FrontendErrorsCard`, reproducing the web body regions:
//  the uppercase header (Bug glyph + "Frontend errors (last hour)"), the headline total + caption,
//  the top-offender list (neutral name chip + monospaced route + right-aligned count), and the
//  healthy "no errors" message. All consume the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex. The web `cyan-300` route accent maps to the semantic
//  `Color.TS.accent`; the neutral `<Badge>` is reproduced as a scoped chip so the dynamic component
//  name renders verbatim (the shared atomic Badge is keyed for localized prose, not data).
//

import SwiftUI

// MARK: - Header (web uppercase muted row + Bug glyph)

/// The uppercase section header — the SF Symbol peer of the web lucide `Bug` plus the muted, wide-
/// tracked title.
struct FrontendErrorsHeader: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "ladybug")
                .font(.system(size: 12, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: FrontendErrorsStrings.string("frontendErrors.title", "Frontend errors (last hour)"))
                .font(Font.TS.caption)
                .tracking(0.5)
                .textCase(.uppercase)
        }
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Headline (web 2xl total + caption)

/// The headline total + the muted "reported by browser sessions" caption (web `text-2xl tabular`
/// number beside the small caption).
struct FrontendErrorsHeadline: View {
    let totalText: String

    private var subtitle: String {
        FrontendErrorsStrings.string("frontendErrors.reportedBy", "reported by browser sessions")
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: totalText)
                .font(Font.TS.title)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: subtitle)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FrontendErrorsAccessibility.headline(totalText, subtitle)))
    }
}

// MARK: - Offender list (web `top.map` <li> rows with divide-y)

/// The top-offender list — one row per offender with a hairline divider between rows (web
/// `divide-y`).
struct FrontendErrorsOffenderList: View {
    let offenders: [FrontendErrorsOffender]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(offenders.enumerated()), id: \.element.id) { index, offender in
                if index > 0 {
                    Rectangle()
                        .fill(Color.TS.border.opacity(0.6))
                        .frame(height: 1)
                }
                FrontendErrorsOffenderRow(offender: offender)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One offender row: the neutral name chip + the monospaced route (accent, truncating) on the left,
/// the right-aligned tabular count on the right.
struct FrontendErrorsOffenderRow: View {
    let offender: FrontendErrorsOffender

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                FrontendErrorsNameChip(name: offender.name)
                Text(verbatim: offender.route)
                    .font(Font.TS.caption.monospaced())
                    .foregroundStyle(Color.TS.accent)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text(verbatim: offender.count)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .layoutPriority(1)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FrontendErrorsAccessibility.offender(
            name: offender.name,
            route: offender.route,
            count: offender.count
        )))
    }
}

/// The neutral name chip — the scoped peer of the web `<Badge variant="neutral">`, styled from the
/// shared `TSTone.neutral` token but rendering the dynamic component name verbatim (data, not prose).
struct FrontendErrorsNameChip: View {
    let name: String

    var body: some View {
        Text(verbatim: name)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(TSTone.neutral.color)
            .lineLimit(1)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(TSTone.neutral.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(TSTone.neutral.color.opacity(0.3), lineWidth: 1))
            .fixedSize(horizontal: true, vertical: false)
    }
}

// MARK: - Healthy "no errors" body (web `top.length === 0` message)

/// The resolved-but-no-offenders body (web `top.length === 0`) — the friendly "no errors" message
/// under the headline. The surrounding header + headline keep this from ever being a blank box.
struct FrontendErrorsNoErrorsBody: View {
    var body: some View {
        Text(verbatim: FrontendErrorsStrings.string(
            "frontendErrors.noErrors",
            "No frontend errors reported in the last hour."
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

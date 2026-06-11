//
//  UserCell.Views.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  The presentational subviews composed by `UserCell`: the muted em-dash empty cell, the populated
//  row (the composed Avatar surface alongside the display name and the optional muted email line),
//  and the composed `UserCellContent` that switches between them and folds the cell into a single
//  VoiceOver element. All colour + type come from the P1/S9 tokens; no Tailwind ports, no raw hex,
//  no ad-hoc text styles.
//

import SwiftUI

// MARK: - Empty cell (web `user-cell-empty` em-dash)

/// The empty cell — a muted em-dash, the web `<span className="text-[var(--text-muted)]">—</span>`.
/// Keeps empty rows scannable in dense tables rather than collapsing to nothing.
struct UserCellEmpty: View {
    var body: some View {
        Text(verbatim: UserCellProjection.emptyGlyph)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Populated row (web avatar + name + optional email)

/// The populated cell — the composed Avatar surface (always tooltip-wrapped, as the web sets
/// `showTooltip`) alongside the display name, with the optional muted email line beneath. The name
/// and email truncate with a tail ellipsis, the parity of the web `truncate` on a `min-w-0` column.
struct UserCellRow: View {
    let populated: UserCellPopulated

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Avatar(
                userId: populated.avatarUserID,
                name: populated.displayName,
                src: populated.avatarURL,
                size: populated.size,
                showTooltip: true
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: populated.displayName)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let email = populated.email {
                    Text(verbatim: email)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
        }
    }
}

// MARK: - Composed cell content

/// The composed cell — the empty em-dash or the populated row, folded into one VoiceOver element
/// whose label is the display name (or the em-dash) and whose value is the email line when shown.
/// Folding the children into a single element avoids voicing the name twice (once for the avatar,
/// once for the visible label). The pure render of `UserCellResolved`.
struct UserCellContent: View {
    let resolved: UserCellResolved
    let label: String
    let value: String

    var body: some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityValue(Text(verbatim: value))
    }

    @ViewBuilder
    private var content: some View {
        switch resolved {
        case .empty:
            UserCellEmpty()
        case let .populated(populated):
            UserCellRow(populated: populated)
        }
    }
}

//
//  UserCell.Previews.swift
//  TeslaSync — P4 shared surface · 0110 · UserCell (Apple)
//
//  Xcode previews for each render branch + variant (empty cell, name, email local-part fallback,
//  id fallback, the email line, sizes, and the remote-image avatar). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ cell: UserCell, label: String) -> some View {
        HStack(spacing: TSSpacing.md) {
            cell
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    #Preview("Render branches") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(UserCell(user: nil), label: "nil → em-dash")
            staged(UserCell(user: UserCellUser()), label: "no fields → em-dash")
            staged(UserCell(user: UserCellUser(id: "u-1", name: "Alice Adams")), label: "name")
            staged(
                UserCell(user: UserCellUser(email: "jane.smith@example.com")),
                label: "email local-part"
            )
            staged(UserCell(user: UserCellUser(id: "subject-abc")), label: "id fallback")
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Email line + sizes") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(
                UserCell(
                    user: UserCellUser(id: "u-1", name: "Alice Adams", email: "alice@example.com"),
                    showEmail: true
                ),
                label: "showEmail"
            )
            staged(
                UserCell(
                    user: UserCellUser(id: "u-1", name: "Alice Adams", email: "alice@example.com")
                ),
                label: "showEmail off (hidden)"
            )
            staged(
                UserCell(user: UserCellUser(id: "u-2", name: "Grace Hopper"), size: .md),
                label: "size md"
            )
            staged(
                UserCell(user: UserCellUser(id: "u-3", name: "Ada Lovelace"), size: .lg),
                label: "size lg"
            )
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Avatar image") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(
                UserCell(
                    user: UserCellUser(
                        id: "u-4",
                        name: "Katherine Johnson",
                        avatarURL: "https://invalid.example/avatar.png"
                    ),
                    size: .lg
                ),
                label: "image → fallback disc"
            )
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }
#endif

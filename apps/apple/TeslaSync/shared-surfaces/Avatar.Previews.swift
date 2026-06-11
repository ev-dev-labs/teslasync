//
//  Avatar.Previews.swift
//  TeslaSync — P4 shared surface · 0076 · Avatar (Apple)
//
//  Xcode previews for each render branch + variant (sizes, shapes, presence, kinds, attribution,
//  and the remote-image fallback). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ avatar: Avatar, label: String) -> some View {
        HStack(spacing: TSSpacing.md) {
            avatar
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    #Preview("Sizes — initials") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(Avatar(name: "Ada Lovelace", size: .xs), label: "xs")
            staged(Avatar(name: "Ada Lovelace", size: .sm), label: "sm")
            staged(Avatar(name: "Ada Lovelace", size: .md), label: "md")
            staged(Avatar(name: "Ada Lovelace", size: .lg), label: "lg")
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Hashed colours") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(Avatar(name: "Grace Hopper", size: .lg), label: "Grace Hopper")
            staged(Avatar(name: "John Doe", size: .lg), label: "John Doe")
            staged(Avatar(name: "Cher", size: .lg), label: "Cher (single word)")
            staged(Avatar(userId: "u-2", size: .lg), label: "id only (no name)")
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Presence + shapes") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(Avatar(name: "Ada Lovelace", size: .lg, status: .online), label: "online")
            staged(Avatar(name: "Ada Lovelace", size: .lg, status: .idle), label: "idle")
            staged(Avatar(name: "Ada Lovelace", size: .lg, status: .offline), label: "offline")
            staged(
                Avatar(name: "Ada Lovelace", size: .lg, shape: .rounded, status: .online),
                label: "rounded"
            )
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Glyphs + tooltip") {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            staged(Avatar(size: .lg, kind: .user), label: "anonymous user")
            staged(Avatar(size: .lg, kind: .bot), label: "bot (Helix)")
            staged(
                Avatar(name: "Ada Lovelace", size: .lg, showTooltip: true),
                label: "tooltip"
            )
            staged(
                Avatar(name: "Ada Lovelace", src: "https://invalid.example/x.png", size: .lg),
                label: "image → fallback"
            )
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }
#endif

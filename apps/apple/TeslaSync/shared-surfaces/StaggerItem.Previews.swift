//
//  StaggerItem.Previews.swift
//  TeslaSync — P4 shared surface · 0194 · StaggerItem (Apple)
//
//  Xcode previews for every real branch of the staggered-entrance item: the single-item full-motion
//  entrance, the index-driven cascade across a small list, the reduced-motion variant (content settled in
//  its final state with no movement), and the empty-content leaf. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleCard(_ title: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.car")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    #Preview("Single item — full motion") {
        staged("one item · lifts + fades in over 350 ms") {
            StaggerItem {
                sampleCard("Battery health")
            }
        }
    }

    #Preview("Cascade — indexed list") {
        staged("five items · 0.06 s cascade step") {
            VStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 5, id: \.self) { index in
                    StaggerItem(index: index) {
                        sampleCard("Row \(index + 1)")
                    }
                }
            }
        }
    }

    #Preview("Reduced motion — final state") {
        staged("reduce motion on · no movement") {
            VStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { index in
                    StaggerItem(
                        model: StaggerItemModel(input: StaggerItemInput(index: index), reduceMotion: true)
                    ) {
                        sampleCard("Row \(index + 1)")
                    }
                }
            }
        }
    }

    #Preview("Empty-content leaf") {
        staged("nothing to stagger · never a blank box") {
            StaggerItem {
                StaggerItemEmptyContent()
            }
        }
    }
#endif

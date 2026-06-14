//
//  StaggerContainer.Previews.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  Xcode previews for every real branch of the staggered-entrance container: the full-motion cascade across
//  a small list, the reduced-motion variant (children settled in their final state with no movement), a
//  child opting in outside any container (the inert, fully-visible default), and the empty-content leaf.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
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

    #Preview("Cascade — full motion") {
        staged("five children · 0.06 s cascade step") {
            StaggerContainer {
                ForEach(0 ..< 5, id: \.self) { index in
                    sampleCard("Row \(index + 1)")
                        .staggerChild(index: index)
                }
            }
        }
    }

    #Preview("Reduced motion — final state") {
        staged("reduce motion on · no movement") {
            StaggerContainer(
                model: StaggerContainerModel(input: StaggerContainerInput(), reduceMotion: true)
            ) {
                ForEach(0 ..< 3, id: \.self) { index in
                    sampleCard("Row \(index + 1)")
                        .staggerChild(index: index)
                }
            }
        }
    }

    #Preview("Stray child — inert default") {
        staged("staggerChild outside a container · fully visible") {
            sampleCard("Standalone row")
                .staggerChild(index: 2)
        }
    }

    #Preview("Empty-content leaf") {
        staged("nothing to stagger · never a blank box") {
            StaggerContainer {
                StaggerContainerEmptyContent()
            }
        }
    }
#endif

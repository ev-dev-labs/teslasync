//
//  PatternsSlide.Views.swift
//  TeslaSync — P4 feature view · 0064 · PatternsSlide (Apple)
//
//  The presentational sub-views composed by PatternsSlide.swift: the spring pop-in, the two icon
//  cards (favourite day / peak hour), the three-up metric row item, and the loading skeleton chrome.
//  Built on the shared design tokens (P1/S9) + feedback skeleton atom; no networking, no business
//  logic. Native parity of the web slide's inner blocks.
//

import SwiftUI

// MARK: - Spring pop-in (web emoji `scale: 0 → 1` spring)

/// Scales + fades its content in with a spring, the native parity of the web `motion.span`
/// `{ type: 'spring' }` entrance. Static under Reduce Motion (renders immediately at full size).
struct PatternsPopIn<Content: View>: View {
    private let content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        content()
            .scaleEffect(shown ? 1 : 0.4)
            .opacity(shown ? 1 : 0)
            .onAppear {
                if reduceMotion {
                    shown = true
                } else {
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.6)) { shown = true }
                }
            }
    }
}

// MARK: - Icon card (web `bg-white/[0.05] … flex items-center gap-4` block)

/// An icon + label-over-value card, the native parity of the web favourite-day / peak-hour blocks.
struct PatternsIconCard: View {
    let systemImage: String
    let tint: Color
    let label: String
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            Image(systemName: systemImage)
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(tint)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(verbatim: value)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label) \(value)"))
    }
}

// MARK: - Metric column (web three-up `flex justify-between` row item)

/// A big value over a small caption — one of the three summary metrics in the bottom row.
struct PatternsMetric: View {
    let value: String
    let caption: String

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: value)
                .font(.system(size: 28, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(verbatim: caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(value) \(caption)"))
    }
}

// MARK: - Loading chrome (web skeleton — slide silhouette)

/// The initial-fetch skeleton: a chip-sized glyph block, a title bar, the two cards, and the three
/// metric bars, sized to the slide silhouette. Built from the shared `TSSkeleton` shimmer atom.
struct PatternsLoadingChrome: View {
    var body: some View {
        VStack(spacing: TSSpacing.x2xl) {
            TSSkeleton(width: 64, height: 48, cornerRadius: TSRadius.md)
            TSSkeleton(width: 220, height: 16)
            VStack(spacing: TSSpacing.lg) {
                TSSkeleton(height: 84, cornerRadius: TSRadius.lg)
                TSSkeleton(height: 84, cornerRadius: TSRadius.lg)
                HStack(spacing: TSSpacing.lg) {
                    TSSkeleton(height: 48)
                    TSSkeleton(height: 48)
                    TSSkeleton(height: 48)
                }
            }
            .frame(maxWidth: 380)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(PatternsStrings.text("patterns.loading", "Loading driving patterns"))
    }
}

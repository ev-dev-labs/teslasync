//
//  StatusBar.States.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The cross-segment state chrome the P4 contract requires: the Reduce-Motion-aware spinner (shared by the
//  live + background segments), the orthogonal offline / stale / error chips (the freshness + connectivity +
//  backend-reachability surfaces), and the loading skeleton. Every state renders concretely — never a blank
//  box. Copy is pre-localized on the presentation (P1/S10); chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Spinner (shared by live + background)

/// A continuously rotating SF Symbol — the native peer of the web `animate-spin`. Honors Reduce Motion by
/// rendering the glyph statically. Decorative (the surrounding control owns the accessibility label).
public struct StatusBarSpinningSymbol: View {
    let systemName: String
    let spinning: Bool
    let reduceMotion: Bool
    @State private var angle: Double = 0

    public init(systemName: String, spinning: Bool, reduceMotion: Bool) {
        self.systemName = systemName
        self.spinning = spinning
        self.reduceMotion = reduceMotion
    }

    public var body: some View {
        Image(systemName: systemName)
            .rotationEffect(.degrees(angle))
            .onAppear(perform: startIfNeeded)
            .accessibilityHidden(true)
    }

    private func startIfNeeded() {
        guard spinning, !reduceMotion else { return }
        withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
            angle = 360
        }
    }
}

// MARK: - State chips (offline / stale / error + retry)

/// The orthogonal state chips — offline (no connectivity), stale (live past freshness), and error (backend
/// unreachable) with a retry affordance. Each pairs a tone with an icon so color is never the sole encoder.
public struct StatusBarStateChips: View {
    private let presentation: StatusBarPresentation
    private let onRetry: () -> Void

    public init(presentation: StatusBarPresentation, onRetry: @escaping () -> Void) {
        self.presentation = presentation
        self.onRetry = onRetry
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if presentation.isOffline {
                StatusBarStateChip(systemName: "wifi.slash", label: presentation.offlineChipLabel, tone: .critical)
            }
            if presentation.isStale {
                StatusBarStateChip(
                    systemName: "clock.badge.exclamationmark",
                    label: presentation.staleChipLabel,
                    tone: .caution
                )
            }
            if presentation.isError {
                StatusBarErrorChip(
                    label: presentation.errorChipLabel,
                    retryLabel: presentation.retryLabel,
                    onRetry: onRetry
                )
            }
        }
    }
}

/// A single tone-paired state chip — icon + label inside a tinted pill.
public struct StatusBarStateChip: View {
    let systemName: String
    let label: String
    let tone: StatusBarTone

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemName).font(Font.TS.caption).accessibilityHidden(true)
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(tone.color.opacity(0.12))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// The error chip — a critical pill plus a retry button (web `QueryError` retry affordance).
public struct StatusBarErrorChip: View {
    let label: String
    let retryLabel: String
    let onRetry: () -> Void

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            StatusBarStateChip(systemName: "exclamationmark.triangle.fill", label: label, tone: .critical)
            Button(action: onRetry) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise").font(Font.TS.caption).accessibilityHidden(true)
                    Text(verbatim: retryLabel).font(Font.TS.caption).fontWeight(.medium)
                }
                .foregroundStyle(Color.TS.accent)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
    }
}

// MARK: - Loading skeleton

/// The first-paint skeleton chrome — shimmer pills standing in for the data segments while the initial
/// fetch resolves. Reduce-Motion renders them static.
public struct StatusBarLoadingChrome: View {
    let iconOnly: Bool
    let reduceMotion: Bool

    public init(iconOnly: Bool, reduceMotion: Bool) {
        self.iconOnly = iconOnly
        self.reduceMotion = reduceMotion
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            StatusBarSkeletonPill(width: iconOnly ? 18 : 64, reduceMotion: reduceMotion)
            StatusBarSkeletonPill(width: iconOnly ? 18 : 72, reduceMotion: reduceMotion)
        }
        .accessibilityElement(children: .ignore)
    }
}

/// A single shimmer pill — a token-tinted rounded rectangle that pulses unless Reduce Motion is on.
public struct StatusBarSkeletonPill: View {
    let width: CGFloat
    let reduceMotion: Bool
    @State private var pulse = false

    public init(width: CGFloat, reduceMotion: Bool) {
        self.width = width
        self.reduceMotion = reduceMotion
    }

    public var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textPrimary.opacity(pulse ? 0.14 : 0.06))
            .frame(width: width, height: 12)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
            .accessibilityHidden(true)
    }
}

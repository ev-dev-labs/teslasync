//
//  StatHeroSlide.swift
//  TeslaSync — P4 feature view · 0068 · StatHeroSlide (Apple)
//
//  The composable "Year in Review" hero slide — the SwiftUI parity of
//  features/analytics/components/review/StatHeroSlide.tsx. Renders every state from the web
//  source's surface contract (loading / empty / error / stale / offline / content) and the animated
//  hero (emoji spring-in, big counting number, unit, comparison line), binding through
//  `StatHeroSlideModel` (P1/S8). No networking lives here.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension StatHeroSlideStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - StatHeroSlide (the feature surface)

/// The composable Year in Review hero slide — the SwiftUI parity of
/// `features/analytics/components/review/StatHeroSlide.tsx`. Renders every state (loading / empty /
/// error / stale / offline / content) and the animated headline stat inside a centered, full-bleed
/// slide, binding through `StatHeroSlideModel` (P1/S8). No networking lives here.
public struct StatHeroSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = StatHeroSlideSurface.slug

    @State private var model: StatHeroSlideModel

    public init(model: StatHeroSlideModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
            .overlay(alignment: .top) { statusBar }
            .onAppear {
                model.start()
                model.autoRefreshIfStale()
            }
            .onDisappear { model.stop() }
            .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
            .accessibilityElement(children: .contain)
    }
}

// MARK: - Content states

private extension StatHeroSlide {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let config = model.config {
                StatHeroSlideContent(config: config)
            } else {
                emptyState
            }
        }
    }

    /// Friendly skeleton that mirrors the hero composition (emoji block, number, unit, comparison) so
    /// the initial load is never a blank box.
    var loadingChrome: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(width: 96, height: 96, cornerRadius: TSRadius.lg)
            TSSkeleton(width: 220, height: 56, cornerRadius: TSRadius.md)
            TSSkeleton(width: 120, height: 22, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 260, height: 16, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.x3xl)
        .accessibilityElement()
        .accessibilityLabel(StatHeroSlideStrings.text("statHero.loading", "Loading year in review"))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                StatHeroSlideStrings.text("statHero.noData", "No year-in-review data")
            } icon: {
                Image(systemName: "calendar")
            }
        } description: {
            StatHeroSlideStrings.text(
                "statHero.emptyHint",
                "Drive through the year to build up your recap."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.statusDanger)
            StatHeroSlideStrings.text("statHero.errorTitle", "Couldn't load year in review")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button { model.refresh() } label: {
                StatHeroSlideStrings.text("statHero.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(StatHeroSlideStrings.text("statHero.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.x3xl)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness / connectivity chip (stale + offline states)

private extension StatHeroSlide {
    @ViewBuilder
    var statusBar: some View {
        if model.connection != .live {
            connectivityChip
                .padding(.top, TSSpacing.lg)
        }
    }

    var connectivityChip: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "statHero.offlineBanner" : "statHero.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known recap"
            : "Reconnecting — recap may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            StatHeroSlideStrings.text(key, fallback)
                .font(Font.TS.caption)
                .lineLimit(1)
            Button { model.refresh() } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(StatHeroSlideStrings.text("statHero.refresh", "Refresh"))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Hero content (web centered slide: emoji / number / unit / comparison)

/// The animated hero, reproducing the web slide's staged entrance: the emoji springs in (scale +
/// rotation), then the number, unit, and comparison rise and fade in on a cascade. Honors Reduce
/// Motion (everything shown instantly) and Dynamic Type (the glyph + number scale with the user's
/// text size).
private struct StatHeroSlideContent: View {
    let config: StatHeroSlideConfig

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var emojiSize: CGFloat = 72
    @ScaledMetric(relativeTo: .largeTitle) private var numberSize: CGFloat = 60
    @State private var appeared = false

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Text(verbatim: config.emoji)
                .font(.system(size: emojiSize))
                .scaleEffect(emojiScale)
                .rotationEffect(.degrees(emojiRotation))
                .animation(emojiAnimation, value: appeared)
                .accessibilityHidden(true)

            Text(verbatim: config.value)
                .font(.system(size: numberSize, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .modifier(riseIn(offset: 40, delay: 0.3, duration: 0.5))

            if !config.unit.isEmpty {
                Text(verbatim: config.unit)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textSecondary)
                    .modifier(riseIn(offset: 20, delay: 0.6, duration: 0.4))
            }

            if !config.comparison.isEmpty {
                Text(verbatim: config.comparison)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 360)
                    .padding(.top, TSSpacing.sm)
                    .modifier(riseIn(offset: 20, delay: 0.9, duration: 0.4))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, TSSpacing.x3xl)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: config.accessibilityLabel))
        .onAppear { appeared = true }
    }

    private var emojiScale: CGFloat {
        reduceMotion ? 1 : (appeared ? 1 : 0)
    }

    private var emojiRotation: Double {
        reduceMotion ? 0 : (appeared ? 0 : -20)
    }

    /// Web `transition={{ type: 'spring', stiffness: 200, damping: 15 }}` for the emoji.
    private var emojiAnimation: Animation? {
        reduceMotion ? nil : .interpolatingSpring(stiffness: 200, damping: 15)
    }

    private func riseIn(offset: CGFloat, delay: Double, duration: Double) -> StatHeroRiseIn {
        StatHeroRiseIn(shown: appeared, reduceMotion: reduceMotion, offset: offset, delay: delay, duration: duration)
    }
}

/// The shared rise-and-fade entrance the number, unit, and comparison use (web `motion.div` with a
/// `y` offset + opacity on a per-element delay). One modifier keeps the three cascading elements DRY.
private struct StatHeroRiseIn: ViewModifier {
    let shown: Bool
    let reduceMotion: Bool
    let offset: CGFloat
    let delay: Double
    let duration: Double

    func body(content: Content) -> some View {
        content
            .opacity(reduceMotion ? 1 : (shown ? 1 : 0))
            .offset(y: reduceMotion ? 0 : (shown ? 0 : offset))
            .animation(reduceMotion ? nil : .easeOut(duration: duration).delay(delay), value: shown)
    }
}

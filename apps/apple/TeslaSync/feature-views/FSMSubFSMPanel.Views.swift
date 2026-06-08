//
//  FSMSubFSMPanel.Views.swift
//  TeslaSync — P4 feature view · 0230 · FSMSubFSMPanel (Apple)
//
//  The presentational subviews composed by `FSMSubFSMPanel`: the responsive 1/2-column
//  grid of sub-FSM cards (web `Grid cols={{ default: 1, md: 2 }}`), the per-session card
//  (the icon chip, the label + active pulse, the inlined `StateBadge` port, and the
//  relative start timestamp), and the loading / empty / error chrome. All consume the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  The web `StateBadge` is a sibling component (`./StateBadge`) with no shared native
//  counterpart, so its appearance (a tinted pill with a coloured dot + the raw state text)
//  is reproduced here as a private subview mapping the semantic variant to a platform tone.
//

import SwiftUI

// MARK: - Variant → platform tone (ADR-006 semantic mapping)

extension FSMSubFSMVariant {
    /// The platform status tone for this semantic variant — the native side of the web
    /// `BadgeVariant` → Tailwind colour map, expressed through the shared `TSTone` tokens.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .danger: .danger
        case .info: .info
        case .neutral: .neutral
        }
    }
}

// MARK: - Data body (web non-empty render: the responsive grid of session cards)

/// The resolved panel body — the 1/2-column grid of sub-FSM cards, wrapped in the shared
/// fade-in (web `FadeIn`). `.adaptive` reproduces the web `cols={{ default: 1, md: 2 }}`:
/// one column on a compact width, two once the width allows.
struct FSMSubFSMContent: View {
    let rows: [FSMSubFSMRow]

    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(rows) { row in
                    FSMSubFSMCard(row: row)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }
}

// MARK: - Session card (web per-sub `<div class="flex items-center gap-3 …">`)

/// One sub-FSM card — the icon chip (green-tinted while active, web `bg-green-500/10`), the
/// session label + the pulsing active dot, the inlined state badge, and the relative
/// session-start timestamp.
struct FSMSubFSMCard: View {
    let row: FSMSubFSMRow

    private var sessionLabel: String {
        row.kind == .drive
            ? FSMSubFSMStrings.string("fsm.activeDrive", "Drive Session")
            : FSMSubFSMStrings.string("fsm.activeCharge", "Charge Session")
    }

    private var iconName: String {
        // Web `sub.type === 'drive' ? Car : Zap`.
        row.kind == .drive ? "car.fill" : "bolt.fill"
    }

    private var relativeStart: String {
        FSMSubFSMTimestamp.relative(fromISO: row.startTime, now: Date(), locale: .current, timeZone: .current)
    }

    private var statusText: String {
        row.isActive
            ? FSMSubFSMStrings.string("fsm.statusActive", "Active")
            : FSMSubFSMStrings.string("fsm.statusIdle", "Idle")
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSIconBox(systemName: iconName, tone: row.isActive ? .success : .neutral)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: sessionLabel)
                        .font(Font.TS.bodySm.weight(.medium))
                        .foregroundStyle(Color.TS.textPrimary)
                    if row.isActive {
                        FSMSubFSMActivePulse()
                    }
                }
                HStack(spacing: TSSpacing.sm) {
                    FSMSubFSMStateBadge(state: row.state, variant: row.variant)
                    Text(verbatim: relativeStart)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FSMSubFSMAccessibility.rowLabel(
            session: sessionLabel,
            status: statusText,
            state: row.state,
            started: relativeStart
        )))
    }
}

// MARK: - State badge (web sibling `StateBadge.tsx`, inlined)

/// The inlined parity of the web `StateBadge` — a tinted pill with a leading coloured dot
/// and the raw, unlocalised state text, coloured by the resolved semantic tone.
struct FSMSubFSMStateBadge: View {
    let state: String
    let variant: FSMSubFSMVariant

    private var tone: TSTone {
        variant.tone
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone.color)
                .frame(width: 6, height: 6)
            Text(verbatim: state)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

// MARK: - Active pulse (web `<span class="… bg-green-400 animate-pulse" />`)

/// The pulsing green dot shown beside an active session label. Static under Reduce Motion.
struct FSMSubFSMActivePulse: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        Circle()
            .fill(Color.TS.statusSuccess)
            .frame(width: 6, height: 6)
            .opacity(pulsing && !reduceMotion ? 0.35 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                    pulsing = true
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton session cards, so the panel keeps its shape while the
/// parent query resolves.
struct FSMSubFSMLoadingView: View {
    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 90, height: 12)
                        TSSkeleton(width: 130, height: 10)
                    }
                    Spacer(minLength: 0)
                }
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: FSMSubFSMStrings.string("fsm.loadingA11y", "Loading active sub-FSMs")))
    }
}

/// The empty render (web `EmptyState`): a friendly state, never a blank panel.
struct FSMSubFSMEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: FSMSubFSMStrings.string("fsm.noSubFSMs", "No active drive or charge sessions"))
            } icon: {
                Image(systemName: "bolt.slash")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct FSMSubFSMErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: FSMSubFSMStrings.string("fsm.errorTitle", "Couldn't load active sub-FSMs"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: FSMSubFSMStrings.string("fsm.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: FSMSubFSMStrings.string("fsm.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

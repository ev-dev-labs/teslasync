//
//  Stepper.Adapter.swift
//  TeslaSync — P4 feature view · 0195 · Stepper (Apple)
//
//  The testable projection core — the SwiftUI parity of
//  features/onboarding/components/Stepper.tsx. Everything here is pure +
//  dependency-free (no store, no bundle, no rendered view) so the per-step
//  state ladder (web `stateOf`), the indicator/tone mapping, the CTA gating,
//  the stable row keys, and the VoiceOver summary are unit tested in isolation.
//
//  The web component is a presentational leaf: it receives a `steps` array and
//  renders an ordered list. Each row is in one of three states — `done` (green
//  check), `current` (cyan spinner, the FIRST not-done step), or `pending`
//  (muted index). A row renders its CTA only while `current`. This file ports
//  that mapping; the empty/loading/error/stale/offline chrome required by the
//  P4 states contract is resolved in the Model.
//
//  Type names are namespaced to the surface (`Stepper*`) because the app target
//  already defines an unrelated `OnboardingStep` (FleetApiSection.Models.swift);
//  the web `OnboardingStep`/`StepperProps` shapes map to `StepperStep` here.
//

import Foundation

// MARK: - Step state (web `'done' | 'current' | 'pending'`)

/// The resolved state of a single step (web `stateOf`). Drives the indicator
/// glyph, the tone, the title/description emphasis, and whether the CTA shows.
public enum StepperStepState: String, Sendable, Equatable, CaseIterable {
    case done
    case current
    case pending
}

// MARK: - Input value types (web `OnboardingStep` / `cta`)

/// The call-to-action a step exposes while it is the current step (web
/// `OnboardingStep.cta`). The web `onClick`/`href`/`to` all collapse to a single
/// keyed activation in native — the onboarding page (the bound source) decides
/// whether that navigates or runs — so only the display `label` and the
/// `isDisabled` flag (web `cta.disabled`) live on the value type.
public struct StepperStepCTA: Sendable, Equatable {
    public var label: String
    public var isDisabled: Bool

    public init(label: String, isDisabled: Bool = false) {
        self.label = label
        self.isDisabled = isDisabled
    }
}

/// One onboarding step (web `OnboardingStep`): the stable `key`, the localized
/// `title` + `description` (already localized by the caller, exactly as on the
/// web where they arrive as `t(...)` strings), whether the underlying anchor is
/// satisfied (`isDone`, web `done`), and the optional CTA.
///
/// The web `icon?` prop is declared but never read by the component's render
/// (the indicator is purely state-driven), so it is intentionally not modelled
/// here — porting it would add behavior the source does not have.
public struct StepperStep: Sendable, Equatable, Identifiable {
    public var key: String
    public var title: String
    public var description: String
    public var isDone: Bool
    public var cta: StepperStepCTA?

    public var id: String {
        key
    }

    public init(
        key: String,
        title: String,
        description: String,
        isDone: Bool,
        cta: StepperStepCTA? = nil
    ) {
        self.key = key
        self.title = title
        self.description = description
        self.isDone = isDone
        self.cta = cta
    }
}

// MARK: - Indicator glyph (web `<Check/>` / `<Loader2/>` / `<span>{idx+1}</span>`)

/// What the leading circle renders for a row — the green check (done), the
/// working spinner (current), or the 1-based index number (pending).
public enum StepperIndicatorKind: Sendable, Equatable {
    case check
    case spinner
    case number(Int)
}

// MARK: - Projection row (web list item)

/// One display-ready step row: its identity (web list `key`), 1-based position
/// within the list, the resolved state, the localized copy, the CTA (only
/// surfaced while current), and the layout flags the view needs (last row →
/// no connector). Derived view affordances (indicator glyph, semantic tone,
/// connector fill) are computed so the view stays declarative.
public struct StepperRow: Sendable, Equatable, Identifiable {
    public let id: String
    public let position: Int
    public let total: Int
    public let state: StepperStepState
    public let title: String
    public let description: String
    public let cta: StepperStepCTA?
    public let isLast: Bool

    public init(
        id: String,
        position: Int,
        total: Int,
        state: StepperStepState,
        title: String,
        description: String,
        cta: StepperStepCTA?,
        isLast: Bool
    ) {
        self.id = id
        self.position = position
        self.total = total
        self.state = state
        self.title = title
        self.description = description
        self.cta = cta
        self.isLast = isLast
    }

    /// The leading-circle glyph (web ternary on state). Pending shows the
    /// 1-based index, matching web `{idx + 1}`.
    public var indicator: StepperIndicatorKind {
        switch state {
        case .done: .check
        case .current: .spinner
        case .pending: .number(position)
        }
    }

    /// The semantic tone (web emerald/cyan/muted) the view maps to design tokens.
    public var tone: StepperTone {
        switch state {
        case .done: .success
        case .current: .accent
        case .pending: .muted
        }
    }

    /// The connector below this row is "complete" (web emerald/40) only when the
    /// row itself is done; otherwise it is the muted surface line.
    public var connectorIsComplete: Bool {
        state == .done
    }

    /// The CTA renders only while the row is the current step and carries a CTA
    /// (web `state === 'current' && step.cta`).
    public var showsCTA: Bool {
        state == .current && cta != nil
    }
}

/// Surface-local semantic tone, mapped to design tokens at the view boundary so
/// the projection stays free of SwiftUI. Mirrors the three web color families
/// (emerald = success, cyan = accent, neutral = muted).
public enum StepperTone: Sendable, Equatable {
    case success
    case accent
    case muted
}

// MARK: - Projection (web `steps.map(...)` + `stateOf`)

/// Pure projection from the input steps to display rows. Reproduces the web
/// `stateOf` ladder verbatim and preserves order + the per-step `key` as the
/// stable SwiftUI identity.
public enum StepperProjection {
    /// The web `stateOf(steps, index)`: a step is `done` when its own flag is
    /// set; otherwise the FIRST not-done step is `current` and every other
    /// not-done step is `pending`. A done step that follows the current step
    /// still reads as `done`.
    public static func state(for steps: [StepperStep], at index: Int) -> StepperStepState {
        if steps[index].isDone { return .done }
        let firstPending = steps.firstIndex(where: { !$0.isDone })
        return firstPending == index ? .current : .pending
    }

    /// Maps the input steps to display rows, preserving order and computing the
    /// 1-based position, the resolved state, and the last-row flag.
    public static func rows(from steps: [StepperStep]) -> [StepperRow] {
        let total = steps.count
        return steps.enumerated().map { index, step in
            StepperRow(
                id: step.key,
                position: index + 1,
                total: total,
                state: state(for: steps, at: index),
                title: step.title,
                description: step.description,
                cta: step.cta,
                isLast: index == total - 1
            )
        }
    }
}

// MARK: - Copy catalog (web `t(key, default)` — every string the surface resolves)

/// One localizable string: its catalog key plus the web English fallback.
/// Keeping the pair as a value lets the view resolve through the P1/S10 facade
/// while tests assert the key set without a bundle.
public struct StepperText: Sendable, Equatable {
    public let key: String
    public let fallback: String

    public init(_ key: String, _ fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    public func resolved(_ localize: (String, String) -> String) -> String {
        localize(key, fallback)
    }
}

/// The surface's full copy catalog. The first entry is the one string extracted
/// from the web source (the `<ol aria-label="Onboarding steps">` label); the
/// rest back the native chrome + accessibility the P4 states contract requires.
/// Step titles/descriptions are caller-localized user data and are NOT catalog
/// keys (same as the web, where they arrive pre-localized as props).
public enum StepperCopy {
    /// Web source key — the ordered-list accessibility label.
    public static let listLabel = StepperText("onboarding.stepper.label", "Onboarding steps")

    // Per-state words for the VoiceOver row summary.
    public static let stateDone = StepperText("onboarding.stepper.state.done", "Completed")
    public static let stateCurrent = StepperText("onboarding.stepper.state.current", "In progress")
    public static let statePending = StepperText("onboarding.stepper.state.pending", "Not started")

    /// VoiceOver position template — formatted with the 1-based index + total.
    public static let positionFormat = StepperText("onboarding.stepper.position", "Step %1$d of %2$d")

    // Empty state (no steps left to configure).
    public static let emptyTitle = StepperText("onboarding.stepper.empty.title", "You're all set")
    public static let emptyMessage = StepperText(
        "onboarding.stepper.empty.message",
        "There are no onboarding steps left to complete."
    )

    // Loading / error chrome.
    public static let loading = StepperText("onboarding.stepper.loading", "Loading setup steps…")
    public static let errorMessage = StepperText(
        "onboarding.stepper.error.message",
        "Could not load your onboarding steps."
    )
    public static let retry = StepperText("onboarding.stepper.retry", "Retry")

    // Stale + offline chips.
    public static let stale = StepperText("onboarding.stepper.stale", "Setup status may be out of date")
    public static let offline = StepperText(
        "onboarding.stepper.offline",
        "Offline — showing last known setup status"
    )

    /// Every catalog entry — used by the keys-coverage unit test.
    public static let all: [StepperText] = [
        listLabel, stateDone, stateCurrent, statePending, positionFormat,
        emptyTitle, emptyMessage, loading, errorMessage, retry, stale, offline
    ]

    /// The localized state word for a row's VoiceOver summary.
    public static func stateWord(for state: StepperStepState) -> StepperText {
        switch state {
        case .done: stateDone
        case .current: stateCurrent
        case .pending: statePending
        }
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver strings for a step so the spoken content is asserted
/// without rendering the view.
public enum StepperAccessibility {
    /// The localized "Step N of M" clause, formatted from the catalog template.
    public static func position(format: String, position: Int, total: Int) -> String {
        String(format: format, position, total)
    }

    /// The row's combined VoiceOver label: the title, the position clause, the
    /// state word, then the supporting description.
    public static func stepSummary(
        title: String,
        position: String,
        stateWord: String,
        description: String
    ) -> String {
        "\(title), \(position), \(stateWord). \(description)"
    }
}

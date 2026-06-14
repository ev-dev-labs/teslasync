//
//  OnboardingWizard.Adapter.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The Foundation-only core for the first-run intro — the SwiftUI parity of
//  `components/feedback/OnboardingWizard.tsx`. This file owns the surface identity (the diagnostics slug),
//  the step identity (the web `steps[]` of four entries), the semantic accent + SF-Symbol mapping of each
//  step (the native peers of the per-step lucide icon + hex accent), the localized-prose descriptor catalog,
//  the view-ready ``OnboardingWizardProjection`` (the indicator row, the resolved title/body, the
//  Next-vs-Get-Started decision), and the pure ``OnboardingWizardProjector`` that derives them. No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<OnboardingWizard>` is a PURE presentational component — it has no fetch,
//  no React-Query cache, and no Promise (the prompt's "Data sources: none"). It therefore has NO loading,
//  error, stale, or offline branch; inventing such chrome would fabricate states the source does not have.
//  This surface reproduces only the source's REAL branches: `dismissed` (the web `if (!visible) return null`)
//  and `presented` (the modal for `steps[currentStep]` across all four steps, with the indicator-completion
//  rule `i <= currentStep`, the active-dot rule `i === currentStep`, and the last-step Get-Started swap).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum OnboardingWizardSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "OnboardingWizard"
}

// MARK: - Localization resolver seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The production
/// app passes the P1/S10 facade (``OnboardingWizardStrings/string(_:_:)``); the pure tests pass an identity
/// resolver so the projection is deterministic without a bundle. Keeping it a plain closure lets the core
/// derive fully-resolved, view-ready prose with no dependency on `NSLocalizedString`.
public typealias OnboardingWizardResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Step identity (web `steps[]`)

/// One of the four onboarding steps — the native peer of an index into the web `steps[]` array. Ordered to
/// match the source (Welcome → Connect → Configure → All-Set).
public enum OnboardingWizardStep: Int, CaseIterable, Sendable, Equatable {
    case welcome
    case connect
    case configure
    case allSet
}

// MARK: - Accent (web per-step hex → semantic token kind)

/// The semantic accent of a step — the native peer of the web per-step hex (`#00f0ff`, `#10b981`, `#f59e0b`,
/// `#8b5cf6`). Kept as a token *kind* here (Foundation-only); the view layer resolves it to a P1/S9 `Color`
/// so no raw hex lives in native code. The mapping preserves the source's intent: brand-cyan welcome,
/// success-green connect, warning-amber configure, highlight-violet finish.
public enum OnboardingWizardAccent: Sendable, Equatable, CaseIterable {
    /// Web `#00f0ff` brand cyan → `Color.TS.accent`.
    case primary
    /// Web `#10b981` green → `Color.TS.statusSuccess`.
    case success
    /// Web `#f59e0b` amber → `Color.TS.statusWarning`.
    case warning
    /// Web `#8b5cf6` violet → `Color.TS.chartSeriesPower`.
    case highlight
}

// MARK: - Step descriptor (catalog row)

/// The static description of a step — its localized title/body keys (+ English fallbacks for test/preview
/// bundles), its semantic accent, and its SF Symbol. The SF Symbols are the native peers of the web lucide
/// glyphs: `Zap → bolt.fill`, `Car → car.fill`, `Settings → gearshape.fill`, `CheckCircle →
/// checkmark.circle.fill`.
public struct OnboardingWizardStepDescriptor: Sendable, Equatable, Identifiable {
    public var id: OnboardingWizardStep {
        step
    }

    public let step: OnboardingWizardStep
    public let titleKey: String
    public let titleFallback: String
    public let bodyKey: String
    public let bodyFallback: String
    public let accent: OnboardingWizardAccent
    /// The SF Symbol name — the native peer of the step's lucide icon.
    public let symbolName: String

    public init(
        step: OnboardingWizardStep,
        titleKey: String,
        titleFallback: String,
        bodyKey: String,
        bodyFallback: String,
        accent: OnboardingWizardAccent,
        symbolName: String
    ) {
        self.step = step
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.bodyKey = bodyKey
        self.bodyFallback = bodyFallback
        self.accent = accent
        self.symbolName = symbolName
    }
}

// MARK: - Step catalog (web `steps[]` data)

/// The four onboarding steps — the verbatim native port of the web `const steps: OnboardingStep[]`. Each row
/// carries the localized prose keys (+ the source's English copy as the deterministic fallback), the semantic
/// accent, and the SF Symbol peer of the lucide icon.
public enum OnboardingWizardStepCatalog {
    public static let entries: [OnboardingWizardStepDescriptor] = [
        OnboardingWizardStepDescriptor(
            step: .welcome,
            titleKey: "onboardingWizard.welcome.title",
            titleFallback: "Welcome to TeslaSync",
            bodyKey: "onboardingWizard.welcome.body",
            bodyFallback: "Your all-in-one Tesla fleet management dashboard. Track drives, monitor battery "
                + "health, analyze energy usage, and control your vehicles — all in one place.",
            accent: .primary,
            symbolName: "bolt.fill"
        ),
        OnboardingWizardStepDescriptor(
            step: .connect,
            titleKey: "onboardingWizard.connect.title",
            titleFallback: "Connect Your Tesla",
            bodyKey: "onboardingWizard.connect.body",
            bodyFallback: "Head to Settings and link your Tesla account via OAuth. TeslaSync will securely "
                + "poll your vehicle data and keep everything in sync automatically.",
            accent: .success,
            symbolName: "car.fill"
        ),
        OnboardingWizardStepDescriptor(
            step: .configure,
            titleKey: "onboardingWizard.configure.title",
            titleFallback: "Configure Settings",
            bodyKey: "onboardingWizard.configure.body",
            bodyFallback: "Customize your polling interval, distance units, energy cost per kWh, notification "
                + "preferences, and MQTT integration to match your setup.",
            accent: .warning,
            symbolName: "gearshape.fill"
        ),
        OnboardingWizardStepDescriptor(
            step: .allSet,
            titleKey: "onboardingWizard.allSet.title",
            titleFallback: "You're All Set!",
            bodyKey: "onboardingWizard.allSet.body",
            bodyFallback: "Your dashboard is ready. Explore drives, charging sessions, efficiency analytics, "
                + "and more. You can always revisit settings to fine-tune your experience.",
            accent: .highlight,
            symbolName: "checkmark.circle.fill"
        )
    ]

    /// The number of steps (web `steps.length`).
    public static var count: Int {
        entries.count
    }

    /// The descriptor for a step — total over ``OnboardingWizardStep`` (every case has a catalog row).
    public static func descriptor(for step: OnboardingWizardStep) -> OnboardingWizardStepDescriptor {
        entries.first { $0.step == step } ?? entries[0]
    }

    /// The descriptor at a (clamped) index — the web `steps[currentStep]`.
    public static func descriptor(atIndex index: Int) -> OnboardingWizardStepDescriptor {
        entries[OnboardingWizardProjector.clampIndex(index)]
    }
}

// MARK: - Primary action (web Next vs Get Started)

/// The trailing button's role — the native peer of the web `currentStep < steps.length - 1 ? 'Next' :
/// 'Get Started'`. `advance` shows the "Next ▸" affordance; `finish` shows "Get Started".
public enum OnboardingWizardPrimaryAction: Sendable, Equatable {
    /// Not the last step — advances to the next (web `Next` + chevron).
    case advance
    /// The last step — completes onboarding (web `Get Started`).
    case finish
}

/// The outcome of a primary-button tap — the native peer of the web `handleNext`: `move(to:)` when there is
/// a next step, `finish` on the last step (which the web routes to `handleClose`).
public enum OnboardingWizardAdvance: Sendable, Equatable {
    case move(to: Int)
    case finish
}

// MARK: - Indicator (web step-indicator dots)

/// One step-indicator dot — the native peer of a web indicator `<div>`. `isComplete` is the web
/// `i <= currentStep` (filled with the brand accent); `isActive` is the web `i === currentStep` (the wider,
/// glowing current dot).
public struct OnboardingWizardIndicator: Sendable, Equatable, Identifiable {
    public let id: Int
    public let isComplete: Bool
    public let isActive: Bool

    public init(id: Int, isComplete: Bool, isActive: Bool) {
        self.id = id
        self.isComplete = isComplete
        self.isActive = isActive
    }
}

// MARK: - Projection (view-ready)

/// The resolved, view-ready modal — everything the SwiftUI body needs as a pure function of `currentStep`
/// (no derivation in the view). `title`/`body`/`progressLabel` are already localized; `indicators` is the
/// web indicator row; `primaryAction` is the web Next-vs-Get-Started decision; `accent`/`symbolName` drive
/// the icon tile.
public struct OnboardingWizardProjection: Sendable, Equatable {
    public let stepIndex: Int
    public let stepCount: Int
    public let title: String
    public let body: String
    public let accent: OnboardingWizardAccent
    public let symbolName: String
    public let indicators: [OnboardingWizardIndicator]
    public let primaryAction: OnboardingWizardPrimaryAction
    /// Localized "Step N of M" — the spoken progress (native a11y addition).
    public let progressLabel: String

    public init(
        stepIndex: Int,
        stepCount: Int,
        title: String,
        body: String,
        accent: OnboardingWizardAccent,
        symbolName: String,
        indicators: [OnboardingWizardIndicator],
        primaryAction: OnboardingWizardPrimaryAction,
        progressLabel: String
    ) {
        self.stepIndex = stepIndex
        self.stepCount = stepCount
        self.title = title
        self.body = body
        self.accent = accent
        self.symbolName = symbolName
        self.indicators = indicators
        self.primaryAction = primaryAction
        self.progressLabel = progressLabel
    }
}

// MARK: - Projector (web render body)

/// The pure projection from `currentStep` to the view-ready modal — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: no fetch, no clock, just the source's render rules.
/// Unit tested across the indicator completion/active logic, the Next-vs-Get-Started swap, the `handleNext`
/// outcome, and the index clamp.
public enum OnboardingWizardProjector {
    /// Clamps an arbitrary step index into the valid `0 ..< count` range so an out-of-range value can never
    /// crash `steps[currentStep]` (defensive — the model only ever advances within range).
    public static func clampIndex(_ index: Int) -> Int {
        let upper = max(0, OnboardingWizardStepCatalog.count - 1)
        return min(max(0, index), upper)
    }

    /// Whether the given step is the last — the web `currentStep === steps.length - 1`.
    public static func isLastStep(currentStep: Int, stepCount: Int = OnboardingWizardStepCatalog.count) -> Bool {
        currentStep >= stepCount - 1
    }

    /// The trailing button's role — the web `currentStep < steps.length - 1 ? Next : Get Started`.
    public static func primaryAction(
        currentStep: Int,
        stepCount: Int = OnboardingWizardStepCatalog.count
    ) -> OnboardingWizardPrimaryAction {
        isLastStep(currentStep: currentStep, stepCount: stepCount) ? .finish : .advance
    }

    /// The outcome of a primary-button tap — the verbatim port of the web `handleNext`: advance while there
    /// is a next step, otherwise finish (which the model maps to `handleClose`).
    public static func nextOutcome(
        currentStep: Int,
        stepCount: Int = OnboardingWizardStepCatalog.count
    ) -> OnboardingWizardAdvance {
        if currentStep < stepCount - 1 {
            return .move(to: currentStep + 1)
        }
        return .finish
    }

    /// The indicator row — for each dot `i`, `isComplete = i <= currentStep` (the web fill rule) and
    /// `isActive = i == currentStep` (the wider, glowing current dot).
    public static func indicators(
        currentStep: Int,
        stepCount: Int = OnboardingWizardStepCatalog.count
    ) -> [OnboardingWizardIndicator] {
        (0 ..< max(0, stepCount)).map { index in
            OnboardingWizardIndicator(
                id: index,
                isComplete: index <= currentStep,
                isActive: index == currentStep
            )
        }
    }

    /// Resolves the whole modal from `currentStep` + the localization resolver — the native peer of the web
    /// component's render decision for `steps[currentStep]`.
    public static func resolve(
        currentStep: Int,
        resolve: OnboardingWizardResolve
    ) -> OnboardingWizardProjection {
        let index = clampIndex(currentStep)
        let count = OnboardingWizardStepCatalog.count
        let descriptor = OnboardingWizardStepCatalog.descriptor(atIndex: index)
        let progressTemplate = resolve("onboardingWizard.progress", "Step %1$d of %2$d")
        return OnboardingWizardProjection(
            stepIndex: index,
            stepCount: count,
            title: resolve(descriptor.titleKey, descriptor.titleFallback),
            body: resolve(descriptor.bodyKey, descriptor.bodyFallback),
            accent: descriptor.accent,
            symbolName: descriptor.symbolName,
            indicators: indicators(currentStep: index, stepCount: count),
            primaryAction: primaryAction(currentStep: index, stepCount: count),
            progressLabel: String(format: progressTemplate, index + 1, count)
        )
    }
}

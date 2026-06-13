using System.Collections.Generic;
using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata, the persisted-flag contract and the i18n keys for the OnboardingWizard surface — the native
/// analogue of the module-level <c>steps</c> array, the <c>ONBOARDED_KEY</c> localStorage flag, the
/// <c>broadcast({ type: 'onboarded' })</c> cross-instance message and the 1500&#160;ms reveal delay in
/// web/src/components/feedback/OnboardingWizard.tsx. The web component hard-codes its copy as English literals (it
/// uses no <c>t()</c>); the native port keys every one of those literals (with the web string as the verbatim
/// fallback) so the surface stays free of inline strings and resolves through the i18n facade. Carries the
/// diagnostics slug, the surface / control automation ids, the Segoe Fluent glyphs standing in for the web Lucide
/// icons (<c>Zap</c> / <c>Car</c> / <c>Settings</c> / <c>CheckCircle</c> per step, plus <c>ChevronRight</c> /
/// <c>X</c>), the per-step accent ramp (web <c>#00f0ff</c> / <c>#10b981</c> / <c>#f59e0b</c> / <c>#8b5cf6</c>), the
/// cyan step-indicator token (web <c>COLOR.CYAN</c>), and the pure onboarded-flag helper. UI-free so it is asserted
/// headlessly.
/// </summary>
public static class OnboardingWizardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "OnboardingWizard";

    /// <summary>The automation id Narrator and UI-automation resolve the wizard dialog by.</summary>
    public const string SurfaceAutomationId = "onboarding-wizard";

    /// <summary>The automation id for the step-indicator strip (web the dots row).</summary>
    public const string StepIndicatorAutomationId = "onboarding-wizard-steps";

    /// <summary>The automation id for the "Skip" button (web <c>handleClose</c> link).</summary>
    public const string SkipAutomationId = "onboarding-wizard-skip";

    /// <summary>The automation id for the primary "Next" / "Get Started" call-to-action (web <c>handleNext</c>).</summary>
    public const string PrimaryAutomationId = "onboarding-wizard-primary";

    /// <summary>The automation id for the dismiss ("X") button (web <c>handleClose</c>).</summary>
    public const string CloseAutomationId = "onboarding-wizard-close";

    /// <summary>Segoe Fluent "ChromeClose" glyph — the native stand-in for the web Lucide <c>X</c> dismiss icon.</summary>
    public const string CloseGlyph = "\uE711";

    /// <summary>Segoe Fluent "ChevronRight" glyph — the native stand-in for the web Lucide <c>ChevronRight</c> next icon.</summary>
    public const string NextGlyph = "\uE76C";

    /// <summary>The storage key the onboarded flag is persisted under (web <c>ONBOARDED_KEY</c>).</summary>
    public const string OnboardedStorageKey = "teslasync-onboarded";

    /// <summary>The value written when onboarding completes (web <c>setItem(ONBOARDED_KEY, 'true')</c>).</summary>
    public const string OnboardedStorageValue = "true";

    /// <summary>The cross-instance "onboarding finished" broadcast message type (web <c>{ type: 'onboarded' }</c>).</summary>
    public const string BroadcastMessageType = "onboarded";

    /// <summary>The reveal delay in milliseconds (web <c>setTimeout(() =&gt; setVisible(true), 1500)</c>).</summary>
    public const int RevealDelayMs = 1500;

    /// <summary>Token key for the cyan step-indicator fill — the brand accent (web <c>COLOR.CYAN</c>).</summary>
    public const string StepIndicatorColorKey = "TsColorAccentColor";

    /// <summary>Fallback for the step-indicator fill when the token is absent (web <c>COLOR.CYAN = #00f0ff</c>).</summary>
    public const string StepIndicatorColorFallback = "#00F0FF";

    /// <summary>The number of steps in the wizard (web <c>steps.length</c>).</summary>
    public const int StepCount = 4;

    /// <summary>i18n key for the "Skip" action (web literal <c>Skip</c>).</summary>
    public const string SkipKey = "translation.onboardingWizard.skip";

    /// <summary>English fallback for <see cref="SkipKey"/> — the web literal, verbatim.</summary>
    public const string SkipFallback = "Skip";

    /// <summary>i18n key for the "Next" action (web literal <c>Next</c>).</summary>
    public const string NextKey = "translation.onboardingWizard.next";

    /// <summary>English fallback for <see cref="NextKey"/> — the web literal, verbatim.</summary>
    public const string NextFallback = "Next";

    /// <summary>i18n key for the final "Get Started" action (web literal <c>Get Started</c>).</summary>
    public const string GetStartedKey = "translation.onboardingWizard.getStarted";

    /// <summary>English fallback for <see cref="GetStartedKey"/> — the web literal, verbatim.</summary>
    public const string GetStartedFallback = "Get Started";

    /// <summary>i18n key for the dismiss-control accessible name (web the unlabelled <c>X</c> button).</summary>
    public const string CloseKey = "translation.onboardingWizard.close";

    /// <summary>English fallback for <see cref="CloseKey"/> — the native accessible name for the web <c>X</c> control.</summary>
    public const string CloseFallback = "Close";

    /// <summary>i18n key for the step-progress accessible label (native a11y over the web visual dots).</summary>
    public const string StepProgressKey = "translation.onboardingWizard.stepProgress";

    /// <summary>English fallback for <see cref="StepProgressKey"/> — a positional "Step {current} of {total}" template.</summary>
    public const string StepProgressFallback = "Step {0} of {1}";

    /// <summary>The reveal delay (web <c>1500</c> ms) the view waits after mount before presenting the wizard.</summary>
    public static TimeSpan RevealDelay => TimeSpan.FromMilliseconds(RevealDelayMs);

    /// <summary>
    /// The four wizard steps, in web order (the module-level <c>steps</c> array,
    /// web/src/components/feedback/OnboardingWizard.tsx L15-44): welcome, connect, configure, done. Each row
    /// mirrors a web step's title / description (keyed, with the web literal as the fallback), its Lucide icon
    /// (mapped to a Segoe Fluent glyph), and its accent colour.
    /// </summary>
    public static IReadOnlyList<OnboardingWizardStep> Steps { get; } = new[]
    {
        new OnboardingWizardStep(
            0,
            "translation.onboardingWizard.step1.title", "Welcome to TeslaSync",
            "translation.onboardingWizard.step1.description",
            "Your all-in-one Tesla fleet management dashboard. Track drives, monitor battery health, analyze energy usage, and control your vehicles — all in one place.",
            "\uE945", // Segoe Fluent — LightningBolt (web Lucide Zap)
            "#00F0FF"),
        new OnboardingWizardStep(
            1,
            "translation.onboardingWizard.step2.title", "Connect Your Tesla",
            "translation.onboardingWizard.step2.description",
            "Head to Settings and link your Tesla account via OAuth. TeslaSync will securely poll your vehicle data and keep everything in sync automatically.",
            "\uE804", // Segoe Fluent — Car (web Lucide Car)
            "#10B981"),
        new OnboardingWizardStep(
            2,
            "translation.onboardingWizard.step3.title", "Configure Settings",
            "translation.onboardingWizard.step3.description",
            "Customize your polling interval, distance units, energy cost per kWh, notification preferences, and MQTT integration to match your setup.",
            "\uE713", // Segoe Fluent — Setting (web Lucide Settings)
            "#F59E0B"),
        new OnboardingWizardStep(
            3,
            "translation.onboardingWizard.step4.title", "You're All Set!",
            "translation.onboardingWizard.step4.description",
            "Your dashboard is ready. Explore drives, charging sessions, efficiency analytics, and more. You can always revisit settings to fine-tune your experience.",
            "\uE930", // Segoe Fluent — CheckCircle (web Lucide CheckCircle)
            "#8B5CF6"),
    };

    /// <summary>
    /// Whether a raw persisted onboarding token marks the user as already onboarded — the native port of the web
    /// <c>if (!onboarded)</c> truthiness guard (web/src/components/feedback/OnboardingWizard.tsx L51-52). Any
    /// non-empty stored value (the web writes <c>'true'</c>) means onboarded; a null / empty token (a fresh or
    /// cleared store) means not onboarded, so the wizard reveals.
    /// </summary>
    /// <param name="raw">The raw stored token, or null when no value is recorded.</param>
    public static bool IsOnboarded(string? raw) => !string.IsNullOrEmpty(raw);

    /// <summary>Resolve the "Skip" label through the i18n facade (web literal <c>Skip</c>).</summary>
    public static string SkipLabel(ILocalizer localizer) => Require(localizer).GetString(SkipKey, SkipFallback);

    /// <summary>Resolve the dismiss-control accessible name through the i18n facade.</summary>
    public static string CloseLabel(ILocalizer localizer) => Require(localizer).GetString(CloseKey, CloseFallback);

    /// <summary>
    /// Resolve the primary call-to-action label for <paramref name="isLastStep"/> — "Get Started" on the final
    /// step, otherwise "Next" (web <c>currentStep &lt; steps.length - 1 ? 'Next' : 'Get Started'</c>).
    /// </summary>
    public static string PrimaryActionLabel(bool isLastStep, ILocalizer localizer) =>
        isLastStep
            ? Require(localizer).GetString(GetStartedKey, GetStartedFallback)
            : localizer.GetString(NextKey, NextFallback);

    /// <summary>
    /// Resolve the localized step-progress accessible label for a 1-based <paramref name="stepNumber"/> of
    /// <paramref name="stepCount"/> — the native a11y narration over the web's purely visual dot row.
    /// </summary>
    public static string StepProgressLabel(int stepNumber, int stepCount, ILocalizer localizer) =>
        string.Format(
            CultureInfo.CurrentCulture,
            Require(localizer).GetString(StepProgressKey, StepProgressFallback),
            stepNumber,
            stepCount);

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// One wizard step's immutable metadata — the native mirror of a single entry in the web module-level
/// <c>steps</c> array (web/src/components/feedback/OnboardingWizard.tsx L15-44): its zero-based
/// <see cref="Index"/>, its title / description (keyed, with the web literal as the verbatim fallback), the Segoe
/// Fluent <see cref="Glyph"/> standing in for the web Lucide icon, and the per-step <see cref="AccentHex"/> (the
/// web <c>color</c>). Pure data (no WinUI types) so the wizard projection is asserted headlessly.
/// </summary>
/// <param name="Index">The zero-based step index (web array position).</param>
/// <param name="TitleKey">The i18n key for the step title.</param>
/// <param name="TitleFallback">The verbatim web title literal, used when the key is absent.</param>
/// <param name="DescriptionKey">The i18n key for the step description.</param>
/// <param name="DescriptionFallback">The verbatim web description literal, used when the key is absent.</param>
/// <param name="Glyph">The Segoe Fluent glyph mapping the web Lucide icon.</param>
/// <param name="AccentHex">The step accent colour (web <c>color</c>), as an uppercase <c>#RRGGBB</c> string.</param>
public sealed record OnboardingWizardStep(
    int Index,
    string TitleKey,
    string TitleFallback,
    string DescriptionKey,
    string DescriptionFallback,
    string Glyph,
    string AccentHex)
{
    /// <summary>The localized step title (web <c>step.title</c>).</summary>
    public string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>The localized step description (web <c>step.description</c>).</summary>
    public string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DescriptionKey, DescriptionFallback);
    }
}

/// <summary>
/// A single step-indicator dot's render state — the native projection of the web dot map
/// (web/src/components/feedback/OnboardingWizard.tsx L111-123). <see cref="IsFilled"/> is the web
/// <c>i &lt;= currentStep</c> (cyan vs faint) fill; <see cref="IsActive"/> is the web <c>i === currentStep</c>
/// (the wider, glowing current dot).
/// </summary>
/// <param name="Index">The zero-based dot index.</param>
/// <param name="IsFilled">Whether the dot is filled — web <c>i &lt;= currentStep</c>.</param>
/// <param name="IsActive">Whether the dot is the active (current) dot — web <c>i === currentStep</c>.</param>
public readonly record struct OnboardingDot(int Index, bool IsFilled, bool IsActive);

/// <summary>
/// The fully projected, render-ready view of the wizard — everything the web <c>OnboardingWizard</c> derives
/// before returning JSX (web/src/components/feedback/OnboardingWizard.tsx L81-166): whether the wizard is shown
/// (<see cref="IsPresenting"/> — the web <c>visible</c> gate: not onboarded and past the reveal delay), the
/// current step's localized <see cref="Title"/> / <see cref="Description"/>, its <see cref="Glyph"/> /
/// <see cref="AccentHex"/>, whether this is the final step (<see cref="IsLastStep"/>), the
/// <see cref="PrimaryActionLabel"/> ("Next" vs "Get Started"), the <see cref="SkipLabel"/> /
/// <see cref="CloseLabel"/>, the a11y <see cref="StepProgressLabel"/>, and the step-indicator
/// <see cref="Dots"/>. Pure value type so every field is asserted headlessly. <see cref="Dots"/> is derived (not
/// stored) so projection equality stays value-based and the view-model can skip no-op reprojections.
/// </summary>
public readonly record struct OnboardingWizardProjection
{
    private OnboardingWizardProjection(
        bool isPresenting,
        int currentStepIndex,
        int stepCount,
        string title,
        string description,
        string glyph,
        string accentHex,
        bool isLastStep,
        string primaryActionLabel,
        string skipLabel,
        string closeLabel,
        string stepProgressLabel)
    {
        IsPresenting = isPresenting;
        CurrentStepIndex = currentStepIndex;
        StepCount = stepCount;
        Title = title;
        Description = description;
        Glyph = glyph;
        AccentHex = accentHex;
        IsLastStep = isLastStep;
        PrimaryActionLabel = primaryActionLabel;
        SkipLabel = skipLabel;
        CloseLabel = closeLabel;
        StepProgressLabel = stepProgressLabel;
    }

    /// <summary>Whether the wizard is shown — the web <c>visible</c> gate (not onboarded, past the reveal delay).</summary>
    public bool IsPresenting { get; }

    /// <summary>The zero-based current step (web <c>currentStep</c>).</summary>
    public int CurrentStepIndex { get; }

    /// <summary>The total number of steps (web <c>steps.length</c>).</summary>
    public int StepCount { get; }

    /// <summary>The localized current-step title (web <c>step.title</c>); also the surface's accessible name.</summary>
    public string Title { get; }

    /// <summary>The localized current-step description (web <c>step.description</c>); also the accessible description.</summary>
    public string Description { get; }

    /// <summary>The Segoe Fluent glyph for the current step (web <c>step.icon</c>).</summary>
    public string Glyph { get; }

    /// <summary>The current step's accent colour as an uppercase <c>#RRGGBB</c> string (web <c>step.color</c>).</summary>
    public string AccentHex { get; }

    /// <summary>Whether this is the final step (web <c>currentStep === steps.length - 1</c>).</summary>
    public bool IsLastStep { get; }

    /// <summary>The primary action label — "Next" or, on the final step, "Get Started".</summary>
    public string PrimaryActionLabel { get; }

    /// <summary>The localized "Skip" label (web literal <c>Skip</c>).</summary>
    public string SkipLabel { get; }

    /// <summary>The localized dismiss-control accessible name (web the unlabelled <c>X</c>).</summary>
    public string CloseLabel { get; }

    /// <summary>The localized step-progress accessible label, e.g. "Step 2 of 4".</summary>
    public string StepProgressLabel { get; }

    /// <summary>The 1-based current step number (for accessible narration).</summary>
    public int StepNumber => CurrentStepIndex + 1;

    /// <summary>The accessible name a screen reader announces for the surface — the current-step title.</summary>
    public string AccessibleName => Title;

    /// <summary>The accessible description a screen reader announces for the surface — the current-step description.</summary>
    public string AccessibleDescription => Description;

    /// <summary>
    /// The step-indicator dots — derived from the current step so the projection stays a pure value (web dot map,
    /// L111-123: each dot is filled when <c>i &lt;= currentStep</c> and active when <c>i === currentStep</c>).
    /// </summary>
    public IReadOnlyList<OnboardingDot> Dots => BuildDots(CurrentStepIndex, StepCount);

    /// <summary>
    /// Build the step-indicator dot states for <paramref name="currentStepIndex"/> of
    /// <paramref name="stepCount"/> (web dot map): filled up to and including the current dot, with the current
    /// dot marked active.
    /// </summary>
    public static IReadOnlyList<OnboardingDot> BuildDots(int currentStepIndex, int stepCount)
    {
        if (stepCount <= 0)
        {
            return Array.Empty<OnboardingDot>();
        }

        var dots = new OnboardingDot[stepCount];
        for (var i = 0; i < stepCount; i++)
        {
            dots[i] = new OnboardingDot(i, i <= currentStepIndex, i == currentStepIndex);
        }

        return dots;
    }

    /// <summary>
    /// Project the wizard inputs into a render-ready value, reproducing the web component
    /// (web/src/components/feedback/OnboardingWizard.tsx L81-166): the requested step is clamped into range, the
    /// current step's localized title / description / glyph / accent are resolved, the primary label switches to
    /// "Get Started" on the final step, and every label flows through the i18n facade.
    /// </summary>
    /// <param name="isPresenting">Whether the wizard is currently shown (web <c>visible</c>).</param>
    /// <param name="currentStep">The requested current step (web <c>currentStep</c>); clamped into range.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static OnboardingWizardProjection Project(bool isPresenting, int currentStep, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var stepCount = OnboardingWizardRegistration.StepCount;
        var index = Math.Clamp(currentStep, 0, stepCount - 1);
        var step = OnboardingWizardRegistration.Steps[index];
        var isLast = index == stepCount - 1;

        return new OnboardingWizardProjection(
            isPresenting: isPresenting,
            currentStepIndex: index,
            stepCount: stepCount,
            title: step.Title(localizer),
            description: step.Description(localizer),
            glyph: step.Glyph,
            accentHex: step.AccentHex,
            isLastStep: isLast,
            primaryActionLabel: OnboardingWizardRegistration.PrimaryActionLabel(isLast, localizer),
            skipLabel: OnboardingWizardRegistration.SkipLabel(localizer),
            closeLabel: OnboardingWizardRegistration.CloseLabel(localizer),
            stepProgressLabel: OnboardingWizardRegistration.StepProgressLabel(index + 1, stepCount, localizer));
    }
}

/// <summary>
/// PII-safe diagnostics for the OnboardingWizard surface (P1/S11 diagnostics contract). The wizard carries no
/// user content (only the local onboarded flag and the current step index), so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug — never the step the user reached or whether they
/// skipped — mirroring the web component, which persists the flag locally and emits no telemetry. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class OnboardingWizardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public OnboardingWizardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been presented.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was presented, emitting <c>view.opened slug=OnboardingWizard</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={OnboardingWizardRegistration.Slug}"));
    }
}

using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="OnboardingWizard"/> view — the native port of the web
/// <c>OnboardingWizard</c> body (web/src/components/feedback/OnboardingWizard.tsx L46-169). It binds the P1/S8
/// <see cref="IOnboardingStore"/> (the web localStorage onboarded flag + cross-tab broadcast), holds the wizard's
/// own ephemeral state — the current step (web <c>currentStep</c>) and whether the post-mount reveal delay has
/// elapsed (web <c>visible</c> after the 1500&#160;ms <c>setTimeout</c>) — recomputes the pure
/// <see cref="OnboardingWizardProjection"/> whenever any input moves, and raises <see cref="PropertyChanged"/> so
/// the view animates the wizard in / out and re-renders the active step. <see cref="Reveal"/> ends the reveal
/// delay (the web timer firing), <see cref="Advance"/> walks the steps then finishes (the web <c>handleNext</c>),
/// and <see cref="Skip"/> / <see cref="Dismiss"/> persist completion (the web <c>handleClose</c>), all of which
/// re-project. The wizard is presented only while NOT onboarded — so a completion (local or a sibling instance's
/// broadcast) immediately collapses it, even if the reveal delay had already elapsed. <see cref="Dispose"/>
/// unsubscribes from the store (the web effect cleanup). The view performs no I/O of its own; the fade / scale
/// animation (and its reduce-motion handling) is a view concern.
/// </summary>
public sealed class OnboardingWizardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IOnboardingStore _store;
    private OnboardingWizardProjection _projection;
    private int _currentStep;
    private bool _revealed;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the P1/S8 onboarded-flag seam.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="store">The onboarded-flag seam (web localStorage flag + broadcast).</param>
    public OnboardingWizardViewModel(ILocalizer localizer, IOnboardingStore store)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(store);

        _localizer = localizer;
        _store = store;

        _projection = Compute();
        _store.Changed += OnStoreChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>OnboardingWizard</c>).</summary>
    public static string Slug => OnboardingWizardRegistration.Slug;

    /// <summary>The current render projection (presentation gate + current-step content + dots + action labels).</summary>
    public OnboardingWizardProjection Projection => _projection;

    /// <summary>Whether the wizard is shown (web <c>visible</c>: not onboarded and past the reveal delay).</summary>
    public bool IsPresenting => _projection.IsPresenting;

    /// <summary>Whether the post-mount reveal delay has elapsed (web <c>visible</c> timer fired).</summary>
    public bool IsRevealed => _revealed;

    /// <summary>Whether onboarding has already completed (web onboarded flag truthy).</summary>
    public bool IsOnboarded => _store.IsOnboarded;

    /// <summary>The zero-based current step (web <c>currentStep</c>).</summary>
    public int CurrentStepIndex => _projection.CurrentStepIndex;

    /// <summary>The localized current-step title (web <c>step.title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized current-step description (web <c>step.description</c>).</summary>
    public string Description => _projection.Description;

    /// <summary>The Segoe Fluent glyph for the current step (web <c>step.icon</c>).</summary>
    public string Glyph => _projection.Glyph;

    /// <summary>The current step's accent colour as an uppercase <c>#RRGGBB</c> string (web <c>step.color</c>).</summary>
    public string AccentHex => _projection.AccentHex;

    /// <summary>Whether this is the final step (web <c>currentStep === steps.length - 1</c>).</summary>
    public bool IsLastStep => _projection.IsLastStep;

    /// <summary>The primary action label — "Next" or, on the final step, "Get Started".</summary>
    public string PrimaryActionLabel => _projection.PrimaryActionLabel;

    /// <summary>The localized "Skip" label (web literal <c>Skip</c>).</summary>
    public string SkipLabel => _projection.SkipLabel;

    /// <summary>The localized dismiss-control accessible name (web the unlabelled <c>X</c>).</summary>
    public string CloseLabel => _projection.CloseLabel;

    /// <summary>The localized step-progress accessible label, e.g. "Step 2 of 4".</summary>
    public string StepProgressLabel => _projection.StepProgressLabel;

    /// <summary>The accessible name a screen reader announces for the surface (the current-step title).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The accessible description a screen reader announces for the surface (the current-step description).</summary>
    public string AccessibleDescription => _projection.AccessibleDescription;

    /// <summary>The step-indicator dot states for the current step (web dot map).</summary>
    public IReadOnlyList<OnboardingDot> Dots => _projection.Dots;

    /// <summary>
    /// End the post-mount reveal delay — the web 1500&#160;ms <c>setTimeout(() =&gt; setVisible(true))</c> firing
    /// (web/src/components/feedback/OnboardingWizard.tsx L52-56). Idempotent: once revealed it stays revealed.
    /// The wizard still only presents while not onboarded, so revealing after a completion is a no-op.
    /// </summary>
    public void Reveal()
    {
        if (_disposed || _revealed)
        {
            return;
        }

        _revealed = true;
        Reproject();
    }

    /// <summary>
    /// Advance to the next step, or finish on the final step — the web <c>handleNext</c>
    /// (web/src/components/feedback/OnboardingWizard.tsx L73-79): while not on the last step the step index
    /// increments; on the last step it completes onboarding (the web <c>handleClose</c>).
    /// </summary>
    public void Advance()
    {
        if (_disposed)
        {
            return;
        }

        if (_currentStep < OnboardingWizardRegistration.StepCount - 1)
        {
            _currentStep++;
            Reproject();
        }
        else
        {
            Dismiss();
        }
    }

    /// <summary>Skip the wizard — the web "Skip" link, which calls <c>handleClose</c> (L143-148).</summary>
    public void Skip() => Dismiss();

    /// <summary>
    /// Complete onboarding — the web <c>handleClose</c> (web/src/components/feedback/OnboardingWizard.tsx
    /// L67-71): persist the onboarded flag and broadcast it (the store's <see cref="IOnboardingStore.Complete"/>),
    /// which marks the surface onboarded and collapses it. Covers every dismiss path (X, Skip, Esc, backdrop,
    /// and "Get Started").
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        _store.Complete();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.Changed -= OnStoreChanged;
        GC.SuppressFinalize(this);
    }

    private OnboardingWizardProjection Compute() =>
        OnboardingWizardProjection.Project(
            isPresenting: _revealed && !_store.IsOnboarded,
            currentStep: _currentStep,
            localizer: _localizer);

    private void OnStoreChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

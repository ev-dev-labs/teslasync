using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="InstallPrompt"/> view — the native port of the web
/// <c>InstallPrompt</c> body (web/src/components/feedback/InstallPrompt.tsx L36-142). It binds the P1/S8
/// <see cref="IInstallAvailabilitySource"/> (the web <c>beforeinstallprompt</c> / <c>appinstalled</c> / standalone
/// state) and <see cref="IInstallDismissalStore"/> (the web localStorage dismissal + cross-tab broadcast),
/// recomputes the pure <see cref="InstallPromptProjection"/> whenever either source moves, and raises
/// <see cref="PropertyChanged"/> so the view animates the prompt in / out. <see cref="InstallAsync"/> presents the
/// platform affordance (the web <c>handleInstall</c>) and <see cref="Dismiss"/> persists the dismissal (the web
/// <c>handleDismiss</c>), both of which re-render the prompt away. <see cref="Dispose"/> unsubscribes from both
/// sources (the web effect cleanup). The view performs no I/O of its own; the slide / fade animation (and its
/// reduce-motion handling) is a view concern.
/// </summary>
public sealed class InstallPromptViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IInstallAvailabilitySource _availability;
    private readonly IInstallDismissalStore _dismissal;
    private InstallPromptProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the two P1/S8 seams.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="availability">The platform installability seam (web <c>beforeinstallprompt</c> / standalone state).</param>
    /// <param name="dismissal">The dismissal-persistence seam (web localStorage timestamp + broadcast).</param>
    public InstallPromptViewModel(
        ILocalizer localizer,
        IInstallAvailabilitySource availability,
        IInstallDismissalStore dismissal)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(availability);
        ArgumentNullException.ThrowIfNull(dismissal);

        _localizer = localizer;
        _availability = availability;
        _dismissal = dismissal;

        _projection = Compute();
        _availability.Changed += OnSeamChanged;
        _dismissal.Changed += OnSeamChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>InstallPrompt</c>).</summary>
    public static string Slug => InstallPromptRegistration.Slug;

    /// <summary>The current render projection (visibility + localized title / subtitle + action labels).</summary>
    public InstallPromptProjection Projection => _projection;

    /// <summary>Whether the prompt is shown (web <c>visible</c>: installable, not standalone, not dismissed).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized prompt title (web <c>installPrompt.title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized prompt subtitle (web <c>installPrompt.subtitle</c>).</summary>
    public string Subtitle => _projection.Subtitle;

    /// <summary>The localized "Install" action label (web <c>installPrompt.install</c>).</summary>
    public string InstallLabel => _projection.InstallLabel;

    /// <summary>The localized dismiss-control accessible name (web <c>installPrompt.dismiss</c>).</summary>
    public string DismissLabel => _projection.DismissLabel;

    /// <summary>The accessible name a screen reader announces for the surface (the title).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The accessible description a screen reader announces for the surface (the subtitle).</summary>
    public string Description => _projection.Description;

    /// <summary>
    /// Present the platform install affordance and resolve the user's choice — the web <c>handleInstall</c>
    /// (web/src/components/feedback/InstallPrompt.tsx L64-72). The availability seam consumes its one-shot
    /// affordance and raises its change event, which reprojects and collapses the prompt. Never throws: a
    /// presenter failure is treated as a declined choice so the surface still settles.
    /// </summary>
    public async Task<InstallChoiceOutcome> InstallAsync()
    {
        if (_disposed || !_availability.CanInstall)
        {
            return InstallChoiceOutcome.Dismissed;
        }

        try
        {
            return await _availability.PromptAsync().ConfigureAwait(false);
        }
        catch (Exception)
        {
            // The web awaits prompt()/userChoice without surfacing errors; a presenter failure must not crash the
            // surface — settle as a declined choice (the affordance state is owned by the seam).
            return InstallChoiceOutcome.Dismissed;
        }
    }

    /// <summary>
    /// Persist a dismissal (web <c>handleDismiss</c> -> localStorage write + <c>broadcast('install.dismissed')</c>).
    /// The dismissal seam raises its change event, which reprojects and collapses the prompt.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        _dismissal.Dismiss();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _availability.Changed -= OnSeamChanged;
        _dismissal.Changed -= OnSeamChanged;
        GC.SuppressFinalize(this);
    }

    private InstallPromptProjection Compute() =>
        InstallPromptProjection.Project(
            _availability.CanInstall,
            _availability.IsInstalled,
            _dismissal.IsDismissedRecently,
            _localizer);

    private void OnSeamChanged(object? sender, EventArgs e) => Reproject();

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

using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// The tour-completion store the launcher binds to (P1/S8 state-holder seam) — the native analogue of the web
/// localStorage helpers in <c>web/src/lib/tourRegistry.ts</c> (<c>isTourCompleted</c>, <c>resetAllTours</c>,
/// <c>markTourListSeen</c>). The view never touches storage directly: a shell adapter (or a test fake) backs
/// this seam so the launcher logic is asserted headlessly.
/// </summary>
public interface ITourCompletionStore
{
    /// <summary>True when the tour is completed (or skipped) at <paramref name="version"/> (web <c>isTourCompleted</c>).</summary>
    /// <param name="tourId">The tour id.</param>
    /// <param name="version">The tour's current completion version.</param>
    bool IsCompleted(string tourId, int version);

    /// <summary>Clear every per-tour completion flag (web <c>resetAllTours</c>).</summary>
    void ResetAll();

    /// <summary>Record that the launcher has been opened at least once (web <c>markTourListSeen</c>).</summary>
    void MarkListSeen();
}

/// <summary>
/// The current-location port the launcher binds to (P1/S8 state-holder seam) — the native analogue of the web
/// <c>useLocation()</c> hook the component reads <c>pathname</c> from to highlight the tour "recommended for
/// this page". A shell adapter supplies the current path; a test fake supplies a fixed value.
/// </summary>
public interface ITourLauncherLocation
{
    /// <summary>The current location path (web <c>location.pathname</c>).</summary>
    string Path { get; }
}

/// <summary>Event payload carrying the tour id a start action targets (web <c>dispatchTourStart(id)</c>).</summary>
public sealed class TourStartEventArgs : EventArgs
{
    /// <summary>Creates the payload for <paramref name="tourId"/>.</summary>
    /// <param name="tourId">The tour id to start.</param>
    public TourStartEventArgs(string tourId)
    {
        ArgumentNullException.ThrowIfNull(tourId);
        TourId = tourId;
    }

    /// <summary>The tour id to start (web <c>def.id</c>).</summary>
    public string TourId { get; }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TourLauncher"/> view — the native port of the web
/// component (web/src/features/onboarding/TourLauncher.tsx). The web component owns its <c>open</c> state and
/// lists the static tour registry, marking completed tours and the route-recommended tour; starting a tour
/// closes the modal and dispatches the start event, and a reset clears all completion flags and re-renders.
/// This holder reproduces that: it owns the <see cref="IsOpen"/> flag, projects the render-ready
/// <see cref="Display"/> through <see cref="TourLauncherProjection"/> from the catalogue + the bound
/// <see cref="ITourCompletionStore"/> + the bound <see cref="ITourLauncherLocation"/>, and exposes the commands
/// (<see cref="Open"/>, <see cref="Close"/>, <see cref="StartTour"/>, <see cref="ResetAll"/>) that raise the
/// parent-owned callbacks as events (the web <c>onClose</c> + <c>dispatchTourStart</c>). There is no fetch, so
/// there is no loading / error / stale / offline branch to model (the web source has none). The view never
/// performs HTTP or storage. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TourLauncherViewModel : INotifyPropertyChanged
{
    private readonly IReadOnlyList<TourLauncherEntry> _tours;
    private readonly ITourCompletionStore _completion;
    private readonly ITourLauncherLocation _location;
    private readonly ILocalizer _localizer;
    private readonly TourLauncherDiagnostics _diagnostics;

    private TourLauncherDisplay _display;
    private bool _isOpen;

    /// <summary>Creates the holder over the i18n facade, the completion + location seams, an optional catalogue and diagnostics.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="completion">The completion store (web localStorage helpers seam).</param>
    /// <param name="location">The current-location port (web <c>useLocation</c> seam).</param>
    /// <param name="tours">The tour catalogue; defaults to <see cref="TourLauncherCatalog.DefaultTours"/>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public TourLauncherViewModel(
        ILocalizer localizer,
        ITourCompletionStore completion,
        ITourLauncherLocation location,
        IReadOnlyList<TourLauncherEntry>? tours = null,
        TourLauncherDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(completion);
        ArgumentNullException.ThrowIfNull(location);

        _localizer = localizer;
        _completion = completion;
        _location = location;
        _tours = tours ?? TourLauncherCatalog.DefaultTours;
        _diagnostics = diagnostics ?? new TourLauncherDiagnostics();
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised to start a tour (web <c>dispatchTourStart(id)</c>); the host promotes it to the active tour.</summary>
    public event EventHandler<TourStartEventArgs>? TourStartRequested;

    /// <summary>Raised when the launcher should close (web <c>onClose()</c>).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The projected, render-ready display for the current completion + route inputs.</summary>
    public TourLauncherDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>True while the launcher modal is open (web <c>open</c> state).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set
        {
            if (_isOpen == value)
            {
                return;
            }

            _isOpen = value;
            Raise(nameof(IsOpen));
        }
    }

    /// <summary>
    /// Open the launcher (web global open-event handler): record that the list has been seen, re-project so the
    /// rows reflect the current completion + route, raise <see cref="IsOpen"/>, and emit the <c>view.opened</c>
    /// diagnostic.
    /// </summary>
    public void Open()
    {
        _completion.MarkListSeen();
        Display = Project();
        IsOpen = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>Close the launcher (web <c>onClose()</c>): lower <see cref="IsOpen"/> and raise the close request.</summary>
    public void Close()
    {
        if (!_isOpen)
        {
            return;
        }

        IsOpen = false;
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Start a tour (web <c>handleStart</c>): close the launcher, record the start, and raise
    /// <see cref="TourStartRequested"/> so the host promotes it to the active tour.
    /// </summary>
    /// <param name="tourId">The tour id to start.</param>
    public void StartTour(string tourId)
    {
        ArgumentNullException.ThrowIfNull(tourId);

        IsOpen = false;
        _diagnostics.RecordTourStarted();
        TourStartRequested?.Invoke(this, new TourStartEventArgs(tourId));
    }

    /// <summary>
    /// Reset every tour's completion (web <c>handleResetAll</c>): clear the completion store, record the reset,
    /// and re-project so the rows drop their completed badges. The launcher stays open.
    /// </summary>
    public void ResetAll()
    {
        _completion.ResetAll();
        _diagnostics.RecordToursReset();
        Display = Project();
    }

    /// <summary>
    /// Re-resolve every label and re-project the current inputs — the native analogue of react-i18next
    /// re-rendering after the active language changes, or the host signalling a route change.
    /// </summary>
    public void Reload() => Display = Project();

    private TourLauncherDisplay Project() =>
        TourLauncherProjection.Project(_tours, _completion, _location.Path, _localizer);

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

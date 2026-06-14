using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SafetyPage</c> view — the native port of the web page's data flow
/// (web/src/features/settings/pages/SafetyPage.tsx). It reads the safety-settings snapshot through the injected
/// <see cref="ISafetySettingsSource"/> (web <c>useSettings</c>) and projects it through <see cref="SafetyProjection"/>
/// so the view is a thin renderer. The web page has a single rendered state — the deterministic, AI-OFF-safe listing —
/// which it draws unconditionally from the defaults-merged hook, so this holder is always in
/// <see cref="SafetyState.Success"/>: it renders the web defaults immediately and re-projects with the install's real
/// values once the read resolves; a failed read leaves the defaults listing in place (never blank). Observable so the
/// view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class SafetyPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISafetySettingsSource _source;
    private readonly ILocalizer _localizer;
    private readonly SafetyPageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;
    private bool _isFetching;

    private SafetySettingsSnapshot _settings = SafetySettingsSnapshot.Default;
    private SafetyDisplay _display;

    /// <summary>Creates the holder over its data source, localizer and (optional) diagnostics.</summary>
    /// <param name="source">The safety-settings-read data port (web <c>useSettings</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SafetyPageViewModel(
        ISafetySettingsSource source,
        ILocalizer localizer,
        SafetyPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new SafetyPageDiagnostics();
        _display = SafetyProjection.Project(new SafetyModel(_settings), localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (always <see cref="SafetyState.Success"/>).</summary>
    public SafetyState State => _display.State;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SafetyDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)read of the safety-settings snapshot is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the safety-settings read and re-project with the resolved values.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        try
        {
            var settings = await _source.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _settings = settings;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception)
        {
            // web: useSettings hands back the defaults-merged object; a failed read still renders the deterministic
            // listing (never blank), so fall back to the web defaults rather than surfacing an error state.
            _settings = SafetySettingsSnapshot.Default;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the safety-settings read (web auto-refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private void Reproject() => Display = SafetyProjection.Project(new SafetyModel(_settings), _localizer);

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

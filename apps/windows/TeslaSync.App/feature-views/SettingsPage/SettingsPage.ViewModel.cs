using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SettingsPage</c> view — the native port of the web page's data flow
/// (web/src/features/settings/pages/SettingsPage.tsx). It reads the settings payload through the injected
/// <see cref="ISettingsFeed"/> (web <c>useSettings</c>) and projects the result through <see cref="SettingsProjection"/>
/// so the view is a thin renderer. It surfaces the two web data states (loading → success): while the first read is in
/// flight the page shows the loading spinner, and once it resolves — on success or failure, mirroring the web, where
/// <c>useSettings</c> only gates <c>isLoading</c> and the static settings content always renders afterwards — the
/// content shows. Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SettingsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISettingsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly SettingsDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _loading = true;
    private bool _hasLoaded;
    private bool _isFetching;

    private SettingsState _state;
    private SettingsDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The settings-read data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SettingsPageViewModel(ISettingsFeed feed, ILocalizer localizer, SettingsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new SettingsDiagnostics();
        _display = SettingsProjection.Project(SettingsModel.Initial, localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / success).</summary>
    public SettingsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SettingsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)read of the settings payload is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the settings read.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLoaded)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            _ = await _feed.FetchAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _loading = false;
            _hasLoaded = true;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception)
        {
            // web: useSettings only gates the initial spinner; once the query resolves — success or error — the
            // static settings content always renders, so a failed read still leaves the body visible (never blank).
            _loading = false;
            _hasLoaded = true;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the settings read (web auto-refetch).</summary>
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

    private void Reproject()
    {
        var display = SettingsProjection.Project(new SettingsModel(Loading: _loading), _localizer);
        Display = display;
        State = display.State;
    }

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

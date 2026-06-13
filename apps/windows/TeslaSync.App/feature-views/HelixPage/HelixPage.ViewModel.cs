using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HelixPage"/> — the native port of the web page's lone
/// query composition (<c>const { isLoading } = useSettings()</c> in
/// web/src/features/settings/pages/HelixPage.tsx). It binds the settings document read (web <c>useSettings</c> →
/// <c>GET /settings</c>) through the shared <see cref="IAiSettingsSource"/> (P1/S8 state-holder seam) and projects
/// the single page-tier flag the page needs: <see cref="IsLoading"/>, the web query's <c>isLoading</c> the page
/// hands to its <c>PageContainer</c> (true while the first fetch is in flight with no cache, false once any value /
/// empty / error resolves). The view is a thin renderer; it never performs HTTP. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class HelixPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAiSettingsSource _source;

    private CancellationTokenSource? _settingsCts;
    private bool _isLoading = true;
    private bool _isRefreshing;
    private bool _disposed;

    /// <summary>Creates the holder over its settings data source (web <c>useSettings</c> port).</summary>
    /// <param name="source">The two-source AI-settings data port the read streams through.</param>
    public HelixPageViewModel(IAiSettingsSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        _source = source;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Whether the first settings fetch is still in flight with nothing cached (web <c>useSettings().isLoading</c>) —
    /// the page renders its loading spinner instead of the embedded Helix form while this is true.
    /// </summary>
    public bool IsLoading
    {
        get => _isLoading;
        private set => Set(ref _isLoading, value);
    }

    /// <summary>Whether a manual refresh is currently re-running the settings read (web query <c>isRefetching</c>).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>Run (or re-run) the cache-then-network settings load (web initial <c>useSettings</c> query).</summary>
    /// <param name="cancellationToken">A token that cancels the in-flight load.</param>
    public Task LoadAsync(CancellationToken cancellationToken = default) => StreamSettingsAsync(cancellationToken);

    /// <summary>Manually re-run the settings read (web <c>query.refetch()</c>) without resetting to the loading state.</summary>
    /// <param name="cancellationToken">A token that cancels the in-flight refresh.</param>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        try
        {
            await StreamSettingsAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    private async Task StreamSettingsAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _settingsCts, cancellationToken);
        try
        {
            await foreach (var result in _source.StreamSettingsAsync(cts.Token).ConfigureAwait(false))
            {
                // Web isLoading is true only for the pending first emission with no cache; every value / empty /
                // error emission resolves the page out of its loading spinner.
                IsLoading = result.Status == LoadStatus.Loading;
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _settingsCts);
        GC.SuppressFinalize(this);
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

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

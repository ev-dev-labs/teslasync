using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RecentlyViewedWidget"/> view — the native port
/// of the web <c>RecentlyViewedWidget</c>'s <c>useRecentPages</c> composition
/// (web/src/features/dashboard/components/RecentlyViewedWidget.tsx). It reads the newest-first snapshot from
/// the bound <see cref="IRecentlyViewedSource"/>, projects it through <see cref="RecentlyViewedProjection"/>
/// capped at the display limit, and re-projects whenever the source raises
/// <see cref="IRecentlyViewedSource.Changed"/> (the web <c>subscribeRecentPages</c> effect), flipping
/// <see cref="State"/> between <see cref="RecentlyViewedState.Ready"/> and
/// <see cref="RecentlyViewedState.Empty"/>. The read is synchronous (the store is in-process), so there is no
/// loading / error / stale / offline state — see <see cref="RecentlyViewedState"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class RecentlyViewedViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRecentlyViewedSource _source;
    private readonly ILocalizer _localizer;
    private readonly int _limit;
    private readonly Func<DateTimeOffset> _clock;

    private RecentlyViewedDisplay _display = RecentlyViewedDisplay.None;
    private RecentlyViewedState _state = RecentlyViewedState.Empty;
    private bool _disposed;

    /// <summary>Creates the holder over its source, localizer, display cap and clock.</summary>
    /// <param name="source">The recent-pages state-holder seam (the canonical or a test fake).</param>
    /// <param name="localizer">The i18n facade resolving the title, empty hint and relative-time labels.</param>
    /// <param name="limit">Maximum rows shown (web <c>RECENT_PAGES_DISPLAY_LIMIT</c>).</param>
    /// <param name="clock">Test seam for "now" — defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public RecentlyViewedViewModel(
        IRecentlyViewedSource source,
        ILocalizer localizer,
        int limit = RecentlyViewedRegistration.DisplayLimit,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _limit = Math.Max(0, limit);
        _clock = clock ?? (() => DateTimeOffset.Now);

        _source.Changed += OnSourceChanged;
        Reproject();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public RecentlyViewedState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready rows (newest first, capped at the display limit).</summary>
    public RecentlyViewedDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasRows));
        }
    }

    /// <summary>True when at least one row resolved (web truthy <c>entries.length &gt; 0</c>).</summary>
    public bool HasRows => _display.HasRows;

    /// <summary>Localized panel title (web <c>recentPages.widgetTitle</c>).</summary>
    public string Title => _localizer.GetString("recentPages.widgetTitle", "Recently Viewed");

    /// <summary>
    /// Localized empty-state hint (web <c>recentPages.empty</c>). Shown as a plain, non-actionable paragraph
    /// — the web component deliberately avoids a CTA empty state because the action (visit a page) is the
    /// rest of the app.
    /// </summary>
    public string EmptyMessage =>
        _localizer.GetString("recentPages.empty", "Pages you visit will appear here for quick access.");

    /// <summary>
    /// Re-read the source and re-project against the current clock — refreshes the relative-time labels and
    /// the <see cref="State"/>. Invoked on every source change and available to the host on demand.
    /// </summary>
    public void Refresh() => Reproject();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private void Reproject()
    {
        var entries = _source.GetEntries(_limit);
        Display = RecentlyViewedProjection.Project(entries, _limit, _clock(), _localizer);
        State = _display.HasRows ? RecentlyViewedState.Ready : RecentlyViewedState.Empty;
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

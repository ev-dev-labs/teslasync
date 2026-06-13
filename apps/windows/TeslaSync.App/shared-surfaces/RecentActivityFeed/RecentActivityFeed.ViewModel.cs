using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.RecentActivityFeedSurface;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="RecentActivityFeed"/> view — the native port of
/// the web component's render closure (web/src/components/data-display/RecentActivityFeed.tsx). It observes the
/// bound <see cref="IRecentActivityFeedSource"/> (the P1/S8 seam carrying the presentational input), projects each
/// change through <see cref="RecentActivityFeedProjection"/> — resolving every label through the injected
/// <see cref="ILocalizer"/> (P1/S10) — into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency so it is
/// verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class RecentActivityFeedViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRecentActivityFeedSource _source;
    private readonly ILocalizer _localizer;
    private RecentActivityFeedDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and i18n facade, projecting the initial frame.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10); never null.</param>
    public RecentActivityFeedViewModel(IRecentActivityFeedSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The diagnostics slug this surface registers under (<c>RecentActivityFeed</c>).</summary>
    public static string Slug => RecentActivityFeedRegistration.Slug;

    /// <summary>The render-ready projection of the current input.</summary>
    public RecentActivityFeedDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, ShowEmptyStateChangedArgs);
        }
    }

    /// <summary>True while the feed shows its empty notice (web <c>entries.length === 0</c>).</summary>
    public bool ShowEmptyState => _display.ShowEmptyState;

    /// <summary>Detach from the data seam (idempotent).</summary>
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

    private void OnSourceChanged(object? sender, EventArgs e) => Display = Project();

    private RecentActivityFeedDisplay Project() =>
        RecentActivityFeedProjection.Project(_source.Input, _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs ShowEmptyStateChangedArgs = new(nameof(ShowEmptyState));
}

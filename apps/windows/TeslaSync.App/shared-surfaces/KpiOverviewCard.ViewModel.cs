using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.KpiOverviewCardSurface;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="KpiOverviewCard"/> view — the native port of
/// the web card + ComparisonHeader bodies (web/src/components/data-display/KpiOverviewCard.tsx,
/// web/src/components/data-display/ComparisonHeader.tsx). It observes the bound
/// <see cref="IKpiOverviewCardSource"/> (the P1/S8 seam carrying the presentational inputs), projects each
/// change through <see cref="KpiOverviewCardProjection"/> into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency so it is
/// verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class KpiOverviewCardViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IKpiOverviewCardSource _source;
    private KpiOverviewCardDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam, projecting the initial frame.</summary>
    /// <param name="source">The presentational-input seam (P1/S8); never null.</param>
    public KpiOverviewCardViewModel(IKpiOverviewCardSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        _source = source;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The diagnostics slug this surface registers under (<c>KpiOverviewCard</c>).</summary>
    public static string Slug => KpiOverviewCardRegistration.Slug;

    /// <summary>The render-ready projection of the current input.</summary>
    public KpiOverviewCardDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, ShowEmptyStateChangedArgs);
        }
    }

    /// <summary>True while the grid resolves to no tiles and the empty state is shown.</summary>
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

    private KpiOverviewCardDisplay Project() => KpiOverviewCardProjection.Project(_source.Input);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs ShowEmptyStateChangedArgs = new(nameof(ShowEmptyState));
}

using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="ElevationProfile"/> view — the native port
/// of the web <c>ElevationProfile</c> component body (web/src/components/charts/ElevationProfile.tsx). It
/// observes the bound <see cref="IElevationProfileSource"/> (the P1/S8 seam that carries the
/// data / currentIndex / distanceUnit "props"), projects each change through
/// <see cref="ElevationProfileProjection"/> into a render-ready <see cref="Display"/>, and raises the
/// <see cref="IndexSelected"/> output event when the view reports a click on a sample — the analogue of the
/// web <c>onClickIndex(data[idx].index)</c> callback. It carries no view-framework dependency so it is
/// verified headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class ElevationProfileViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IElevationProfileSource _source;
    private readonly ILocalizer _localizer;
    private ElevationProfileDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    public ElevationProfileViewModel(IElevationProfileSource source, ILocalizer localizer)
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

    /// <summary>
    /// Raised when the view reports a click on a sample, carrying the sample's original index — the native
    /// analogue of the web <c>onClickIndex</c> callback. The host (e.g. the replay page) reacts by moving
    /// the playhead, which flows back in through <see cref="IElevationProfileSource.CurrentIndex"/>.
    /// </summary>
    public event EventHandler<int>? IndexSelected;

    /// <summary>The diagnostics slug this surface registers under (<c>ElevationProfile</c>).</summary>
    public static string Slug => ElevationProfileRegistration.Slug;

    /// <summary>The render-ready projection of the current series, cursor and unit.</summary>
    public ElevationProfileDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, StateChangedArgs);
            PropertyChanged?.Invoke(this, HasDataChangedArgs);
            PropertyChanged?.Invoke(this, TitleChangedArgs);
            PropertyChanged?.Invoke(this, SubtitleChangedArgs);
            PropertyChanged?.Invoke(this, EmptyMessageChangedArgs);
            PropertyChanged?.Invoke(this, AccessibleSummaryChangedArgs);
        }
    }

    /// <summary>Which render branch is showing (web empty vs populated).</summary>
    public ElevationProfileState State => _display.State;

    /// <summary>True while the populated chart is showing (web <c>data.length &gt; 0</c>).</summary>
    public bool HasData => _display.State == ElevationProfileState.Ready;

    /// <summary>The localized chart title (web <c>replay.elevation.title</c>).</summary>
    public string Title => _display.Title;

    /// <summary>The gain/loss subtitle shown in the populated state (empty in the empty state).</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>The localized empty-state message (web <c>replay.elevation.noData</c>).</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>The localized accessible chart summary (web <c>ariaLabel</c>).</summary>
    public string AccessibleSummary => _display.AccessibleSummary;

    /// <summary>
    /// Report a click on the sample at <paramref name="arrayPosition"/> in the current series. Mirrors the
    /// web <c>handleClick</c> (L61-L71): a position outside <c>[0, count)</c> is ignored, otherwise the
    /// sample's original index is raised on <see cref="IndexSelected"/>.
    /// </summary>
    public void RequestSelect(int arrayPosition)
    {
        var samples = _source.Samples;
        if (arrayPosition >= 0 && arrayPosition < samples.Count)
        {
            IndexSelected?.Invoke(this, samples[arrayPosition].Index);
        }
    }

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

    private ElevationProfileDisplay Project() => ElevationProfileProjection.Project(
        _source.Samples,
        _source.CurrentIndex,
        _source.DistanceUnit,
        _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs StateChangedArgs = new(nameof(State));
    private static readonly PropertyChangedEventArgs HasDataChangedArgs = new(nameof(HasData));
    private static readonly PropertyChangedEventArgs TitleChangedArgs = new(nameof(Title));
    private static readonly PropertyChangedEventArgs SubtitleChangedArgs = new(nameof(Subtitle));
    private static readonly PropertyChangedEventArgs EmptyMessageChangedArgs = new(nameof(EmptyMessage));
    private static readonly PropertyChangedEventArgs AccessibleSummaryChangedArgs = new(nameof(AccessibleSummary));
}

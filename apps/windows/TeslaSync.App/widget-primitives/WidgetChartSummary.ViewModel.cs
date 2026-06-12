using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.WidgetPrimitives;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="WidgetChartSummary"/> view — the native port of
/// the web component body (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx). It observes the bound
/// <see cref="IWidgetChartSummarySource"/> (the P1/S8 props seam), projects each change through
/// <see cref="WidgetChartSummaryProjection"/> into a render-ready <see cref="Display"/>, and raises
/// <see cref="INotifyPropertyChanged"/> so the view re-renders. It carries no view-framework dependency, so it is
/// verified headlessly; the WinUI view marshals its notifications onto the dispatcher. <see cref="Dispose"/>
/// unsubscribes from the source (the web effect cleanup).
/// </summary>
public sealed class WidgetChartSummaryViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));

    private readonly ILocalizer _localizer;
    private readonly IWidgetChartSummarySource _source;
    private WidgetChartSummaryDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and props seam (P1/S8), projecting the initial frame.</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The props state-holder seam (web component props).</param>
    public WidgetChartSummaryViewModel(ILocalizer localizer, IWidgetChartSummarySource source)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>WidgetChartSummary</c>).</summary>
    public static string Slug => WidgetChartSummaryRegistration.Slug;

    /// <summary>The render-ready projection of the current inputs.</summary>
    public WidgetChartSummaryDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
        }
    }

    /// <summary>Whether the empty state is shown in place of the stats / chart (web <c>isEmpty</c>).</summary>
    public bool IsEmpty => _display.IsEmpty;

    /// <summary>The resolved empty message (caller override or the localized default).</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>The optional empty-state glyph (native form of web <c>emptyIcon</c>); null renders no icon.</summary>
    public string? EmptyIconGlyph => _display.EmptyIconGlyph;

    /// <summary>The projected stat cells (web <c>stats.map(…)</c>).</summary>
    public IReadOnlyList<StatCellDisplay> Stats => _display.Stats;

    /// <summary>Whether the stat row should be drawn (web <c>stats.length &gt; 0</c>).</summary>
    public bool ShowStats => _display.ShowStats;

    /// <summary>Whether the primitive is in compact mode (web <c>compact</c>).</summary>
    public bool Compact => _display.Compact;

    /// <summary>Whether the chart slot should be drawn below the stats (web <c>{!compact &amp;&amp; …}</c>).</summary>
    public bool ShowChart => _display.ShowChart;

    /// <summary>Detach from the props seam (idempotent).</summary>
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

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        WidgetChartSummaryDisplay next = Project();
        if (next != _display)
        {
            Display = next;
        }
    }

    private WidgetChartSummaryDisplay Project() =>
        WidgetChartSummaryProjection.Project(_source.Current, _localizer);
}

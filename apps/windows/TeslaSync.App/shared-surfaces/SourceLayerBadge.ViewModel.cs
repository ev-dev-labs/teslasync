using System.ComponentModel;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SourceLayerBadge"/> view — the native port of the web
/// component body (web/src/components/data-display/SourceLayerBadge.tsx). It binds the
/// <see cref="ISourceLayerBadgeSource"/> (the P1/S8 source-layer seam), recomputes the pure
/// <see cref="SourceLayerBadgeProjection"/> whenever the sample moves, and raises <see cref="PropertyChanged"/>
/// so the view re-renders. <see cref="Layer"/> / <see cref="Label"/> / <see cref="Tooltip"/> reproduce the web
/// render values. <see cref="Dispose"/> unsubscribes from the source (the web effect cleanup). The view performs
/// no I/O of its own.
/// </summary>
public sealed class SourceLayerBadgeViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ISourceLayerBadgeSource _source;
    private readonly bool _showLabel;
    private SourceLayerBadgeProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and source-layer seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The source-layer state-holder seam (web <c>source</c> / <c>ageMs</c> props).</param>
    /// <param name="showLabel">Whether the label is spelled out (web <c>showLabel</c>); defaults to false (the web default).</param>
    public SourceLayerBadgeViewModel(
        ILocalizer localizer,
        ISourceLayerBadgeSource source,
        bool showLabel = false)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);

        _localizer = localizer;
        _source = source;
        _showLabel = showLabel;

        _projection = Compute();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>SourceLayerBadge</c>).</summary>
    public static string Slug => SourceLayerBadgeRegistration.Slug;

    /// <summary>The current render projection (layer + token + label + brush + width + tooltip + a11y).</summary>
    public SourceLayerBadgeProjection Projection => _projection;

    /// <summary>The resolved source layer (web <c>STYLE[key] ?? unknown</c>).</summary>
    public SourceLayer Layer => _projection.Layer;

    /// <summary>The lowercase source token (web <c>data-source</c>).</summary>
    public string SourceToken => _projection.SourceToken;

    /// <summary>The compact glyph/label (web <c>style.label</c>).</summary>
    public string Label => _projection.Label;

    /// <summary>The generated design-token brush key the badge tints from (web <c>style.tint</c>).</summary>
    public string AccentBrushKey => _projection.AccentBrushKey;

    /// <summary>Whether the label is spelled out — drives the wider min-width (web <c>showLabel</c>).</summary>
    public bool ShowLabel => _projection.ShowLabel;

    /// <summary>The badge minimum width in DIPs (web <c>min-w</c>).</summary>
    public double MinWidth => _projection.MinWidth;

    /// <summary>The localized relative value age (web <c>formatAge(ageMs)</c>), or null when no age is known.</summary>
    public string? AgeText => _projection.AgeText;

    /// <summary>The composed hover / Narrator tooltip (web <c>tooltip</c>).</summary>
    public string Tooltip => _projection.Tooltip;

    /// <summary>The accessible name the automation peer reports.</summary>
    public string AutomationName => _projection.AutomationName;

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

    private SourceLayerBadgeProjection Compute() =>
        SourceLayerBadgeProjection.Project(_source.Current, _showLabel, _localizer);

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

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

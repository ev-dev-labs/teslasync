using System.ComponentModel;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FreshnessIndicator"/> view — the native port of the
/// web component body and the <c>useIsStale</c> hook (web/src/components/data-display/FreshnessIndicator.tsx). It
/// binds the <see cref="IFreshnessIndicatorSource"/> (the P1/S8 timestamp seam) and the
/// <see cref="IMotionPreferenceSource"/> (web <c>prefers-reduced-motion</c>), recomputes the pure
/// <see cref="FreshnessIndicatorProjection"/> whenever the sample or the reduce-motion preference moves, and
/// raises <see cref="PropertyChanged"/> so the view re-renders. <see cref="NotifyTimeChanged"/> re-projects
/// against the current clock so the relative-age label advances (web's 10s <c>setInterval</c> tick, owned by the
/// view). <see cref="IsStale"/> / <see cref="IsOffline"/> / <see cref="AgeLabel"/> reproduce the web
/// <c>useIsStale</c> return value. <see cref="Dispose"/> unsubscribes from both sources (the web effect
/// cleanups). The view performs no I/O of its own.
/// </summary>
public sealed class FreshnessIndicatorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IFreshnessIndicatorSource _source;
    private readonly IMotionPreferenceSource _motion;
    private readonly FreshnessIndicatorSize _size;
    private readonly bool _showLabel;
    private readonly int _staleThreshold;
    private readonly int _offlineThreshold;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Func<DateTimeOffset, string> _formatTimestamp;
    private readonly IDisposable _motionSubscription;
    private FreshnessIndicatorProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, freshness seam and motion-preference seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The freshness state-holder seam (web <c>timestamp</c> prop).</param>
    /// <param name="motion">The reduce-motion preference source (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="size">The size variant (web <c>size</c>); defaults to <see cref="FreshnessIndicatorSize.Small"/>.</param>
    /// <param name="showLabel">Whether the relative label is shown (web <c>showLabel</c>); defaults to true.</param>
    /// <param name="staleThreshold">Seconds before the data point is stale (web <c>staleThreshold</c>); defaults to the web 120.</param>
    /// <param name="offlineThreshold">Seconds before the data point is offline (web <c>offlineThreshold</c>); defaults to the web 600.</param>
    /// <param name="clock">The clock the relative age is measured against; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    /// <param name="formatTimestamp">
    /// The locale-aware formatter for the reading-time tooltip (web <c>title={timestamp}</c>); defaults to the
    /// shared <see cref="DateTimeFormatting"/> full variant.
    /// </param>
    public FreshnessIndicatorViewModel(
        ILocalizer localizer,
        IFreshnessIndicatorSource source,
        IMotionPreferenceSource motion,
        FreshnessIndicatorSize size = FreshnessIndicatorSize.Small,
        bool showLabel = true,
        int staleThreshold = FreshnessIndicatorRegistration.DefaultStaleThresholdSeconds,
        int offlineThreshold = FreshnessIndicatorRegistration.DefaultOfflineThresholdSeconds,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? formatTimestamp = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _source = source;
        _motion = motion;
        _size = size;
        _showLabel = showLabel;
        _staleThreshold = staleThreshold;
        _offlineThreshold = offlineThreshold;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _formatTimestamp = formatTimestamp ?? (ts => DateTimeFormatting.Format(ts, DateTimeVariant.Full, ts));

        _projection = Compute();
        _source.Changed += OnSourceChanged;
        _motionSubscription = _motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>FreshnessIndicator</c>).</summary>
    public static string Slug => FreshnessIndicatorRegistration.Slug;

    /// <summary>The current render projection (status + brush + label + sizes + pulse + a11y).</summary>
    public FreshnessIndicatorProjection Projection => _projection;

    /// <summary>The resolved freshness status (web <c>status</c>).</summary>
    public FreshnessStatus Status => _projection.Status;

    /// <summary>The generated design-token brush key the dot tints from.</summary>
    public string AccentBrushKey => _projection.AccentBrushKey;

    /// <summary>The localized relative-age label (web <c>formatAge</c> / <c>useIsStale().ageLabel</c>).</summary>
    public string AgeLabel => _projection.Label;

    /// <summary>Whether the relative label is shown (web <c>showLabel</c>).</summary>
    public bool ShowLabel => _projection.ShowLabel;

    /// <summary>Whether the dot pulses (web fresh-dot <c>animate-pulse</c>): fresh and motion allowed.</summary>
    public bool Pulse => _projection.Pulse;

    /// <summary>Whether the data point is at or past the stale threshold (web <c>useIsStale().isStale</c>).</summary>
    public bool IsStale => _projection.IsStale;

    /// <summary>Whether the data point is at or past the offline threshold (web <c>useIsStale().isOffline</c>).</summary>
    public bool IsOffline => _projection.IsOffline;

    /// <summary>The hover / Narrator tooltip — the formatted reading time, or empty (web <c>title={timestamp}</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The accessible name the automation peer reports.</summary>
    public string AutomationName => _projection.AutomationName;

    /// <summary>The resolved size variant (web <c>size</c>).</summary>
    public FreshnessIndicatorSize Size => _projection.Size;

    /// <summary>
    /// Re-project against the current clock so the relative-age label advances — the web 10s
    /// <c>setInterval</c> tick, driven by the view's timer.
    /// </summary>
    public void NotifyTimeChanged() => Reproject();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        _motionSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private FreshnessIndicatorProjection Compute() =>
        FreshnessIndicatorProjection.Project(
            _source.Current,
            _size,
            _showLabel,
            _staleThreshold,
            _offlineThreshold,
            _motion.ReduceMotion,
            _clock(),
            _localizer,
            _formatTimestamp);

    private void OnSourceChanged(object? sender, EventArgs e) => Reproject();

    private void OnReduceMotionChanged(bool reduceMotion) => Reproject();

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

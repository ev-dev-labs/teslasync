using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DataFreshness"/> view — the native port of the web
/// component body (web/src/components/data-display/DataFreshness.tsx L110-233). It binds the
/// <see cref="IDataFreshnessSource"/> (the P1/S8 query seam) and the <see cref="IMotionPreferenceSource"/>
/// (web <c>useMotionPreference</c>), recomputes the pure <see cref="DataFreshnessProjection"/> whenever the
/// snapshot or the reduce-motion preference moves, and raises <see cref="PropertyChanged"/> so the view
/// re-renders. <see cref="RequestRefresh"/> forwards a manual refresh while one is not already in flight (web
/// <c>handleClick</c> = <c>onRefresh &amp;&amp; !isFetching</c>); <see cref="NotifyTimeChanged"/> re-projects
/// against the current clock so the relative-age label advances (web's 30s <c>setInterval</c> tick, owned by
/// the view). <see cref="Dispose"/> unsubscribes from both sources (the web effect cleanups). The view performs
/// no I/O of its own.
/// </summary>
public sealed class DataFreshnessViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDataFreshnessSource _source;
    private readonly IMotionPreferenceSource _motion;
    private readonly Func<DateTimeOffset> _clock;
    private readonly Func<DateTimeOffset, string> _formatTime;
    private readonly bool _compact;
    private readonly IDisposable _motionSubscription;
    private DataFreshnessProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, freshness seam and motion-preference seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The freshness state-holder seam (web query result).</param>
    /// <param name="motion">The reduce-motion preference source (web <c>useMotionPreference</c>).</param>
    /// <param name="compact">Whether the chip is in the icon-only compact mode (web <c>compact</c>).</param>
    /// <param name="clock">The clock the relative age is measured against; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    /// <param name="formatTime">
    /// The locale-aware time formatter for the last-updated tooltip (web <c>useDateFormat().formatTime</c>);
    /// defaults to the shared <see cref="DateTimeFormatting"/> time variant.
    /// </param>
    public DataFreshnessViewModel(
        ILocalizer localizer,
        IDataFreshnessSource source,
        IMotionPreferenceSource motion,
        bool compact = false,
        Func<DateTimeOffset>? clock = null,
        Func<DateTimeOffset, string>? formatTime = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _source = source;
        _motion = motion;
        _compact = compact;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _formatTime = formatTime ?? (ts => DateTimeFormatting.Format(ts, DateTimeVariant.Time, ts));

        _projection = Compute();
        _source.Changed += OnSourceChanged;
        _motionSubscription = _motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>DataFreshness</c>).</summary>
    public static string Slug => DataFreshnessRegistration.Slug;

    /// <summary>The current render projection (status + brush + glyph + labels + motion flags).</summary>
    public DataFreshnessProjection Projection => _projection;

    /// <summary>The resolved freshness status (web <c>status</c>).</summary>
    public DataFreshnessStatus Status => _projection.Status;

    /// <summary>The generated design-token brush key the dot, icon and text tint from.</summary>
    public string AccentBrushKey => _projection.AccentBrushKey;

    /// <summary>The Segoe Fluent glyph for the current status.</summary>
    public string IconGlyph => _projection.IconGlyph;

    /// <summary>The localized relative-time / status label (web <c>relativeTime</c>).</summary>
    public string RelativeText => _projection.RelativeText;

    /// <summary>Whether the relative-time text is shown (false in compact mode).</summary>
    public bool ShowText => _projection.ShowText;

    /// <summary>The hover / Narrator tooltip (web <c>title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The accessible name (web <c>aria-label</c>).</summary>
    public string AutomationName => _projection.AutomationName;

    /// <summary>The ARIA role (web <c>role</c>): button when refreshable, otherwise status.</summary>
    public string Role => _projection.Role;

    /// <summary>Whether the chip is an interactive refresh affordance.</summary>
    public bool Interactive => _projection.Interactive;

    /// <summary>Whether the refresh glyph spins (fetching and motion allowed).</summary>
    public bool Spin => _projection.Spin;

    /// <summary>Whether the dot shows the expanding ping ring (fetching and motion allowed).</summary>
    public bool Ping => _projection.Ping;

    /// <summary>Whether the dot pulses (background refetch and motion allowed).</summary>
    public bool PulseDot => _projection.PulseDot;

    /// <summary>The ARIA live urgency the surface declares (always polite).</summary>
    public string LiveSetting => _projection.LiveSetting;

    /// <summary>Whether a manual refresh affordance is offered (web <c>onRefresh</c> present).</summary>
    public bool CanRefresh => _source.CanRefresh;

    /// <summary>
    /// Forward a manual refresh to the seam — the web <c>handleClick</c> (<c>if (onRefresh &amp;&amp; !isFetching)
    /// onRefresh()</c>): a no-op when no refresh is offered or a fetch is already in flight.
    /// </summary>
    public void RequestRefresh()
    {
        if (_disposed)
        {
            return;
        }

        if (_source.CanRefresh && !_source.Current.IsFetching)
        {
            _source.Refresh();
        }
    }

    /// <summary>
    /// Re-project against the current clock so the relative-age label advances — the web 30s
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

    private DataFreshnessProjection Compute() =>
        DataFreshnessProjection.Project(
            _source.Current,
            _compact,
            _source.CanRefresh,
            _motion.ReduceMotion,
            _clock(),
            _localizer,
            _formatTime);

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

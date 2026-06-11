using System.ComponentModel;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveIndicator"/> view — the native port of the web
/// component body (web/src/components/data-display/LiveIndicator.tsx L45-L112). It binds the
/// <see cref="ILiveIndicatorSource"/> (the P1/S8 <c>useLiveConnection</c> seam) and the
/// <see cref="IMotionPreferenceSource"/> (the <c>prefers-reduced-motion</c> seam), recomputes the pure
/// <see cref="LiveIndicatorProjection"/> for the surface's <see cref="Variant"/> whenever the live-pipeline read or
/// the reduce-motion preference moves, and raises <see cref="PropertyChanged"/> so the view re-renders.
/// <see cref="NotifyTimeChanged"/> re-projects against the current clock so the connected freshness stamp
/// advances (the web parent re-rendering with a fresh <c>Date.now()</c>). <see cref="Dispose"/> unsubscribes from
/// both seams (the web effect cleanups). The view performs no I/O of its own.
/// </summary>
public sealed class LiveIndicatorViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ILiveIndicatorSource _source;
    private readonly IMotionPreferenceSource _motion;
    private readonly LiveIndicatorVariant _variant;
    private readonly Func<DateTimeOffset> _clock;
    private readonly IDisposable _motionSubscription;
    private LiveIndicatorProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, live-connection seam and motion-preference seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="source">The live-connection state-holder seam (web <c>useLiveConnection</c>).</param>
    /// <param name="motion">The reduce-motion preference source (web <c>prefers-reduced-motion</c>).</param>
    /// <param name="variant">The visual variant the surface renders (web <c>variant</c>, default <see cref="LiveIndicatorVariant.Pill"/>).</param>
    /// <param name="clock">The clock the freshness stamp is measured against; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public LiveIndicatorViewModel(
        ILocalizer localizer,
        ILiveIndicatorSource source,
        IMotionPreferenceSource motion,
        LiveIndicatorVariant variant = LiveIndicatorVariant.Pill,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _source = source;
        _motion = motion;
        _variant = variant;
        _clock = clock ?? (() => DateTimeOffset.Now);

        _projection = Compute();
        _source.Changed += OnSourceChanged;
        _motionSubscription = _motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>LiveIndicator</c>).</summary>
    public static string Slug => LiveIndicatorRegistration.Slug;

    /// <summary>The current render projection (status + brush + glyph + labels + variant flags + motion flag).</summary>
    public LiveIndicatorProjection Projection => _projection;

    /// <summary>The visual variant the surface renders (web <c>variant</c>).</summary>
    public LiveIndicatorVariant Variant => _variant;

    /// <summary>The resolved live-pipeline health (web <c>status</c>).</summary>
    public LiveConnectionState Status => _projection.Status;

    /// <summary>The generated design-token brush key the dot, icon and label tint from.</summary>
    public string AccentBrushKey => _projection.AccentBrushKey;

    /// <summary>The Segoe Fluent glyph for the current status.</summary>
    public string IconGlyph => _projection.IconGlyph;

    /// <summary>The localized status label (web <c>cfg[status].label</c>).</summary>
    public string Label => _projection.Label;

    /// <summary>Whether the icon spins (reconnecting and motion allowed).</summary>
    public bool Spin => _projection.Spin;

    /// <summary>Whether the bare colored dot is drawn (web <c>variant === 'dot'</c>).</summary>
    public bool ShowDot => _projection.ShowDot;

    /// <summary>Whether the chip icon is drawn (web chip variants).</summary>
    public bool ShowIcon => _projection.ShowIcon;

    /// <summary>Whether the chip label is drawn (web chip variants).</summary>
    public bool ShowLabel => _projection.ShowLabel;

    /// <summary>Whether the connected freshness stamp is drawn (web pill + connected + lastMessageAt).</summary>
    public bool ShowTimestamp => _projection.ShowTimestamp;

    /// <summary>The freshness relative-time text (web <c>formatRelativeTime(lastMessageAt)</c>).</summary>
    public string RelativeText => _projection.RelativeText;

    /// <summary>Whether this is the bare-dot variant — the view shows the label as a tooltip (web <c>title</c>).</summary>
    public bool DotOnly => _projection.DotOnly;

    /// <summary>The accessible name (web <c>aria-label</c>): the status label.</summary>
    public string AutomationName => _projection.AutomationName;

    /// <summary>The ARIA role the surface exposes (web <c>role="status"</c>).</summary>
    public string Role => _projection.Role;

    /// <summary>The ARIA live urgency the surface declares (always polite).</summary>
    public string LiveSetting => _projection.LiveSetting;

    /// <summary>
    /// Re-project against the current clock so the connected freshness stamp advances — the web parent
    /// re-rendering the indicator with a fresh <c>Date.now()</c>, driven by the view's timer.
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

    private LiveIndicatorProjection Compute() =>
        LiveIndicatorProjection.Project(_source.Current, _variant, _motion.ReduceMotion, _clock(), _localizer);

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

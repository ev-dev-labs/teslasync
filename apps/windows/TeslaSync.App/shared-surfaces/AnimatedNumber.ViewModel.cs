using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AnimatedNumber"/> view — the native port of the web
/// component body (web/src/components/data-display/AnimatedNumber.tsx). The web component's only state is the
/// animated display value plus the (CSS-evaluated) motion preference; this holder mirrors that by tracking the
/// current target <see cref="Value"/> and the reduce-motion flag from the shared
/// <see cref="IMotionPreferenceSource"/> (P1/S8 seam, reused from the AIThinkingIndicator surface). It exposes
/// the projected <see cref="AnimatedNumberProjection"/> the view tweens from and raises
/// <see cref="PropertyChanged"/> when the host pushes a new value (web <c>value</c> prop change, which restarts
/// the tween) or when the user toggles reduce-motion at runtime (so the view can start/stop its count-up). The
/// view performs no I/O of its own. <see cref="Dispose"/> unsubscribes from the motion source (the web
/// media-query listener cleanup).
/// </summary>
public sealed class AnimatedNumberViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly int _decimals;
    private readonly string _prefix;
    private readonly string _suffix;
    private readonly double _durationSeconds;
    private readonly IDisposable _motionSubscription;
    private bool _reduceMotion;
    private double _value;
    private AnimatedNumberProjection _projection;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over the full set of web props and the reduce-motion source (P1/S8 seam).
    /// </summary>
    /// <param name="value">The initial target value (web <c>value</c>).</param>
    /// <param name="decimals">The fraction-digit count (web <c>decimals</c>).</param>
    /// <param name="prefix">The leading text (web <c>prefix</c>), or null for none.</param>
    /// <param name="suffix">The trailing text (web <c>suffix</c>), or null for none.</param>
    /// <param name="durationSeconds">The tween duration in seconds (web <c>duration</c>).</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public AnimatedNumberViewModel(
        double value,
        int decimals,
        string? prefix,
        string? suffix,
        double durationSeconds,
        IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(motion);

        _value = value;
        _decimals = decimals;
        _prefix = prefix ?? string.Empty;
        _suffix = suffix ?? string.Empty;
        _durationSeconds = durationSeconds;
        _reduceMotion = motion.ReduceMotion;
        _projection = AnimatedNumberProjection.Project(_value, _decimals, _prefix, _suffix, _durationSeconds, _reduceMotion);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>
    /// Creates the holder with the web prop defaults (<c>duration = 1</c>, <c>decimals = 0</c>, no prefix/suffix)
    /// and the supplied reduce-motion source.
    /// </summary>
    /// <param name="value">The initial target value (web <c>value</c>).</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public AnimatedNumberViewModel(double value, IMotionPreferenceSource motion)
        : this(
            value,
            AnimatedNumberRegistration.DefaultDecimals,
            prefix: null,
            suffix: null,
            AnimatedNumberRegistration.DefaultDurationSeconds,
            motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>AnimatedNumber</c>).</summary>
    public static string Slug => AnimatedNumberRegistration.Slug;

    /// <summary>The current render projection (validated inputs + motion flag + formatting).</summary>
    public AnimatedNumberProjection Projection => _projection;

    /// <summary>The current target value (web <c>value</c>).</summary>
    public double Value => _value;

    /// <summary>The fraction-digit count the number is rendered with.</summary>
    public int Decimals => _projection.Decimals;

    /// <summary>The leading text rendered before the number.</summary>
    public string Prefix => _projection.Prefix;

    /// <summary>The trailing text rendered after the number.</summary>
    public string Suffix => _projection.Suffix;

    /// <summary>The tween duration in seconds.</summary>
    public double DurationSeconds => _projection.DurationSeconds;

    /// <summary>Whether the count-up currently animates (false under reduced motion / zero duration).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>The fully formatted final readout / accessible name.</summary>
    public string FormattedTarget => _projection.FormattedTarget;

    /// <summary>
    /// Push a new target value (web <c>value</c> prop change). Re-projects and raises <see cref="PropertyChanged"/>
    /// so the view restarts the count-up from <see cref="AnimatedNumberRegistration.StartValue"/>. A no-op when the
    /// value is unchanged.
    /// </summary>
    /// <param name="value">The new target value.</param>
    public void SetValue(double value)
    {
        if (_value.Equals(value))
        {
            return;
        }

        _value = value;
        Reproject(valueChanged: true);
    }

    /// <summary>Stop listening to the motion source (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _motionSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnReduceMotionChanged(bool reduceMotion)
    {
        if (_reduceMotion == reduceMotion)
        {
            return;
        }

        _reduceMotion = reduceMotion;
        Reproject(valueChanged: false);
    }

    private void Reproject(bool valueChanged)
    {
        var next = AnimatedNumberProjection.Project(_value, _decimals, _prefix, _suffix, _durationSeconds, _reduceMotion);
        if (next == _projection)
        {
            return;
        }

        bool animateChanged = next.Animate != _projection.Animate;
        bool targetChanged = !string.Equals(next.FormattedTarget, _projection.FormattedTarget, StringComparison.Ordinal);
        _projection = next;

        Raise(nameof(Projection));
        if (valueChanged)
        {
            Raise(nameof(Value));
        }

        if (animateChanged)
        {
            Raise(nameof(Animate));
        }

        if (targetChanged)
        {
            Raise(nameof(FormattedTarget));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

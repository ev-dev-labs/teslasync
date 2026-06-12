using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="StaggerItem"/> view — the native port of the web
/// component body (web/src/components/motion/StaggerItem.tsx). The web component's only state is the
/// (CSS/JS-evaluated) motion preference that selects between the animating and the instant-settle variants; this
/// holder mirrors that by tracking the reduce-motion flag from the shared <see cref="IMotionPreferenceSource"/>
/// (P1/S8 seam, reused from the AIThinkingIndicator surface) over a fixed default entrance duration. It exposes
/// the projected <see cref="StaggerItemProjection"/> the view animates from and raises
/// <see cref="PropertyChanged"/> when the user toggles reduce-motion at runtime (so the view can start or skip
/// its entrance). The view performs no I/O of its own. <see cref="Dispose"/> unsubscribes from the motion source
/// (the web media-query listener cleanup).
/// </summary>
public sealed class StaggerItemViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly int _defaultDurationMs;
    private readonly IDisposable _motionSubscription;
    private bool _reduceMotion;
    private StaggerItemProjection _projection;
    private bool _disposed;

    /// <summary>
    /// Creates the holder with the web default entrance duration (<see cref="StaggerItemRegistration.DefaultDurationMs"/>,
    /// the <c>useMotionPreference(350)</c> argument) and the supplied reduce-motion source.
    /// </summary>
    /// <param name="motion">The reduce-motion preference source.</param>
    public StaggerItemViewModel(IMotionPreferenceSource motion)
        : this(StaggerItemRegistration.DefaultDurationMs, motion)
    {
    }

    /// <summary>Creates the holder over an explicit default entrance duration and the reduce-motion source (P1/S8 seam).</summary>
    /// <param name="defaultDurationMs">The requested entrance duration in milliseconds (web <c>useMotionPreference</c> argument).</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public StaggerItemViewModel(int defaultDurationMs, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(motion);

        _defaultDurationMs = defaultDurationMs;
        _reduceMotion = motion.ReduceMotion;
        _projection = StaggerItemProjection.Project(_defaultDurationMs, _reduceMotion);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>StaggerItem</c>).</summary>
    public static string Slug => StaggerItemRegistration.Slug;

    /// <summary>The current render projection (effective duration + motion flag + from/to endpoints).</summary>
    public StaggerItemProjection Projection => _projection;

    /// <summary>Whether the entrance currently animates (false under reduced motion / zero duration).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>The effective entrance duration in milliseconds.</summary>
    public int DurationMs => _projection.DurationMs;

    /// <summary>The effective entrance duration in seconds (web <c>transition.duration</c>).</summary>
    public double DurationSeconds => _projection.DurationSeconds;

    /// <summary>The opacity the entrance starts from.</summary>
    public double FromOpacity => _projection.FromOpacity;

    /// <summary>The vertical offset (pixels) the entrance starts from.</summary>
    public double FromOffsetY => _projection.FromOffsetY;

    /// <summary>The opacity the child settles at.</summary>
    public double ToOpacity => _projection.ToOpacity;

    /// <summary>The vertical offset the child settles at.</summary>
    public double ToOffsetY => _projection.ToOffsetY;

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
        var next = StaggerItemProjection.Project(_defaultDurationMs, _reduceMotion);
        if (next == _projection)
        {
            return;
        }

        bool animateChanged = next.Animate != _projection.Animate;
        _projection = next;

        Raise(nameof(Projection));
        if (animateChanged)
        {
            Raise(nameof(Animate));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

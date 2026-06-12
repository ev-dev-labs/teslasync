using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CarAnimation"/> silhouette view — the native port
/// of the web component body (web/src/components/motion/CarAnimation.tsx). The web component's only inputs are
/// its <c>size</c> prop plus the CSS-evaluated motion preference; this holder mirrors that by tracking the
/// current size and the reduce-motion flag from the shared <see cref="IMotionPreferenceSource"/> (P1/S8 seam,
/// reused from the AIThinkingIndicator surface). It exposes the projected <see cref="CarAnimationProjection"/>
/// the view renders and raises <see cref="PropertyChanged"/> when the host re-drives the size (web <c>size</c>
/// change) or when the user toggles reduce-motion at runtime (so the view can start/stop the animations). The
/// label is resolved through the <see cref="ILocalizer"/> (web <c>t('carAnimation.tesla', …)</c>). The view
/// performs no I/O of its own. <see cref="Dispose"/> unsubscribes from the motion source (the web media-query
/// listener cleanup).
/// </summary>
public sealed class CarAnimationViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDisposable _motionSubscription;
    private double _size;
    private bool _reduceMotion;
    private CarAnimationProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web prop, the i18n facade and the reduce-motion source (P1/S8 seam).</summary>
    /// <param name="size">The initial width (web <c>size</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public CarAnimationViewModel(double size, ILocalizer localizer, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _size = size;
        _reduceMotion = motion.ReduceMotion;
        _projection = CarAnimationProjection.Project(_size, _reduceMotion, _localizer);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>Creates the holder with the web prop default (<c>size = 120</c>) and the supplied seams.</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public CarAnimationViewModel(ILocalizer localizer, IMotionPreferenceSource motion)
        : this(CarAnimationRegistration.CarDefaultSize, localizer, motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>CarAnimation</c>).</summary>
    public static string Slug => CarAnimationRegistration.Slug;

    /// <summary>The current render projection (sizing + motion flag + accessible name).</summary>
    public CarAnimationProjection Projection => _projection;

    /// <summary>The rendered width in pixels (web <c>w = size</c>).</summary>
    public double Width => _projection.Width;

    /// <summary>The rendered height in pixels (web <c>h = size * 0.4</c>).</summary>
    public double Height => _projection.Height;

    /// <summary>Whether the illustration animates (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>The accessible name the image exposes (web <c>aria-label={t('carAnimation.tesla', …)}</c>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>Push a new size (web <c>size</c> prop change); re-projects and raises changes. No-op if unchanged.</summary>
    /// <param name="size">The new width.</param>
    public void SetSize(double size)
    {
        if (_size.Equals(size))
        {
            return;
        }

        _size = size;
        Reproject();
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
        Reproject();
    }

    private void Reproject()
    {
        CarAnimationProjection next = CarAnimationProjection.Project(_size, _reduceMotion, _localizer);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargingBolt"/> view — the native port of the web
/// <c>ChargingBolt</c> body. Tracks the current size and the reduce-motion flag from the shared
/// <see cref="IMotionPreferenceSource"/>, exposes the projected <see cref="ChargingBoltProjection"/> and raises
/// <see cref="PropertyChanged"/> on a size or runtime motion change. The label resolves through the
/// <see cref="ILocalizer"/> (web <c>t('carAnimation.charging', …)</c>).
/// </summary>
public sealed class ChargingBoltViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDisposable _motionSubscription;
    private double _size;
    private bool _reduceMotion;
    private ChargingBoltProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web prop, the i18n facade and the reduce-motion source.</summary>
    /// <param name="size">The initial size (web <c>size</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public ChargingBoltViewModel(double size, ILocalizer localizer, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _size = size;
        _reduceMotion = motion.ReduceMotion;
        _projection = ChargingBoltProjection.Project(_size, _reduceMotion, _localizer);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>Creates the holder with the web prop default (<c>size = 32</c>) and the supplied seams.</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public ChargingBoltViewModel(ILocalizer localizer, IMotionPreferenceSource motion)
        : this(CarAnimationRegistration.ChargingBoltDefaultSize, localizer, motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current render projection (size + motion flag + accessible name).</summary>
    public ChargingBoltProjection Projection => _projection;

    /// <summary>The rendered square side in pixels (web <c>size</c>).</summary>
    public double Size => _projection.Size;

    /// <summary>Whether the bolt animates (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>The accessible name the image exposes (web <c>aria-label={t('carAnimation.charging', …)}</c>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>Push a new size (web <c>size</c> prop change); re-projects and raises changes. No-op if unchanged.</summary>
    /// <param name="size">The new size.</param>
    public void SetSize(double size)
    {
        if (_size.Equals(size))
        {
            return;
        }

        _size = size;
        Reproject();
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
        Reproject();
    }

    private void Reproject()
    {
        ChargingBoltProjection next = ChargingBoltProjection.Project(_size, _reduceMotion, _localizer);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BatteryFillAnimation"/> view — the native port of
/// the web <c>BatteryFillAnimation</c> body. Tracks the current level and size and the reduce-motion flag from
/// the shared <see cref="IMotionPreferenceSource"/>, exposes the projected <see cref="BatteryFillProjection"/>
/// and raises <see cref="PropertyChanged"/> on a level / size or runtime motion change. The gauge is decorative
/// (web: no <c>aria-label</c>), so this holder takes no <see cref="ILocalizer"/>.
/// </summary>
public sealed class BatteryFillViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDisposable _motionSubscription;
    private double _level;
    private double _size;
    private bool _reduceMotion;
    private BatteryFillProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web props and the reduce-motion source.</summary>
    /// <param name="level">The initial battery level percentage (web <c>level</c>).</param>
    /// <param name="size">The initial size (web <c>size</c>).</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public BatteryFillViewModel(double level, double size, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(motion);

        _level = level;
        _size = size;
        _reduceMotion = motion.ReduceMotion;
        _projection = BatteryFillProjection.Project(_level, _size, _reduceMotion);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>Creates the holder with the web prop defaults (<c>level = 80</c>, <c>size = 48</c>) and the motion source.</summary>
    /// <param name="motion">The reduce-motion preference source.</param>
    public BatteryFillViewModel(IMotionPreferenceSource motion)
        : this(CarAnimationRegistration.BatteryDefaultLevel, CarAnimationRegistration.BatteryDefaultSize, motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current render projection (sizing + fill width + colour band + motion flag).</summary>
    public BatteryFillProjection Projection => _projection;

    /// <summary>The fill rectangle's target width in viewBox units (web <c>fillWidth * (38 / (48*0.6-4))</c>).</summary>
    public double FillWidth => _projection.FillWidth;

    /// <summary>The classified fill band (web <c>COLOR.GOOD/WARN/BAD</c> ternary).</summary>
    public BatteryFillBand Band => _projection.Band;

    /// <summary>Whether the gauge animates (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>Push a new battery level (web <c>level</c> prop change); re-projects and raises changes. No-op if unchanged.</summary>
    /// <param name="level">The new battery level percentage.</param>
    public void SetLevel(double level)
    {
        if (_level.Equals(level))
        {
            return;
        }

        _level = level;
        Reproject();
    }

    /// <summary>Push a new size (web <c>size</c> prop change); re-projects and raises changes. No-op if unchanged.</summary>
    /// <param name="size">The new size.</param>
    public void SetSize(double size)
    {
        if (_size.Equals(size))
        {
            return;
        }

        _size = size;
        Reproject();
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
        Reproject();
    }

    private void Reproject()
    {
        BatteryFillProjection next = BatteryFillProjection.Project(_level, _size, _reduceMotion);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WheelSpin"/> view — the native port of the web
/// <c>WheelSpin</c> body. Tracks the current size and the reduce-motion flag from the shared
/// <see cref="IMotionPreferenceSource"/>, exposes the projected <see cref="WheelSpinProjection"/> and raises
/// <see cref="PropertyChanged"/> on a size or runtime motion change. The label resolves through the
/// <see cref="ILocalizer"/> (web <c>t('carAnimation.loading', …)</c>).
/// </summary>
public sealed class WheelSpinViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDisposable _motionSubscription;
    private double _size;
    private bool _reduceMotion;
    private WheelSpinProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web prop, the i18n facade and the reduce-motion source.</summary>
    /// <param name="size">The initial size (web <c>size</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public WheelSpinViewModel(double size, ILocalizer localizer, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _size = size;
        _reduceMotion = motion.ReduceMotion;
        _projection = WheelSpinProjection.Project(_size, _reduceMotion, _localizer);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>Creates the holder with the web prop default (<c>size = 24</c>) and the supplied seams.</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public WheelSpinViewModel(ILocalizer localizer, IMotionPreferenceSource motion)
        : this(CarAnimationRegistration.WheelSpinDefaultSize, localizer, motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current render projection (size + motion flag + accessible name).</summary>
    public WheelSpinProjection Projection => _projection;

    /// <summary>The rendered square side in pixels (web <c>size</c>).</summary>
    public double Size => _projection.Size;

    /// <summary>Whether the wheel spins (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>The accessible name the image exposes (web <c>aria-label={t('carAnimation.loading', …)}</c>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>Push a new size (web <c>size</c> prop change); re-projects and raises changes. No-op if unchanged.</summary>
    /// <param name="size">The new size.</param>
    public void SetSize(double size)
    {
        if (_size.Equals(size))
        {
            return;
        }

        _size = size;
        Reproject();
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
        Reproject();
    }

    private void Reproject()
    {
        WheelSpinProjection next = WheelSpinProjection.Project(_size, _reduceMotion, _localizer);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

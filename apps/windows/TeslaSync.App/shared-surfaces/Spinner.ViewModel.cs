using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Spinner"/> view — the native port of the web
/// component body (web/src/components/feedback/Spinner.tsx). The web component's only inputs are its props
/// (<c>size</c>, <c>label</c>) plus the CSS-evaluated motion preference; this holder mirrors that by tracking the
/// current <see cref="SpinnerSize"/> and label and the reduce-motion flag from the shared
/// <see cref="IMotionPreferenceSource"/> (P1/S8 seam, reused from the AIThinkingIndicator surface). It exposes the
/// projected <see cref="SpinnerProjection"/> the view renders and raises <see cref="PropertyChanged"/> when the
/// host re-drives a prop (web <c>size</c> / <c>label</c> change) or when the user toggles reduce-motion at runtime
/// (so the view can start/stop the self-drawing bolt). The default accessible label is resolved through the
/// <see cref="ILocalizer"/> (web <c>label ?? 'Loading'</c>). The view performs no I/O of its own.
/// <see cref="Dispose"/> unsubscribes from the motion source (the web media-query listener cleanup).
/// </summary>
public sealed class SpinnerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDisposable _motionSubscription;
    private SpinnerSize _size;
    private string? _label;
    private bool _reduceMotion;
    private SpinnerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web props, the i18n facade and the reduce-motion source (P1/S8 seam).</summary>
    /// <param name="size">The initial size (web <c>size</c>).</param>
    /// <param name="label">The initial caption, or null for none (web <c>label</c>).</param>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public SpinnerViewModel(SpinnerSize size, string? label, ILocalizer localizer, IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _size = size;
        _label = label;
        _reduceMotion = motion.ReduceMotion;
        _projection = SpinnerProjection.Project(_size, _label, _reduceMotion, _localizer);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>Creates the holder with the web prop defaults (<c>size = 'md'</c>, no label) and the supplied seams.</summary>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public SpinnerViewModel(ILocalizer localizer, IMotionPreferenceSource motion)
        : this(SpinnerSize.Medium, label: null, localizer, motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Spinner</c>).</summary>
    public static string Slug => SpinnerRegistration.Slug;

    /// <summary>The current render projection (size metrics + motion flag + label + accessible name).</summary>
    public SpinnerProjection Projection => _projection;

    /// <summary>The current size (web <c>size</c>).</summary>
    public SpinnerSize Size => _projection.Size;

    /// <summary>The rendered pixel box of the bolt (web <c>pixels</c>).</summary>
    public int Pixels => _projection.Pixels;

    /// <summary>The bolt stroke width in the 200×200 authoring space (web <c>stroke</c>).</summary>
    public double StrokeWidth => _projection.StrokeWidth;

    /// <summary>Whether the bolt draws itself (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>Whether a visible caption is shown beneath the bolt (web <c>{label &amp;&amp; …}</c>).</summary>
    public bool HasLabel => _projection.HasLabel;

    /// <summary>The visible caption text, or empty when none is shown (web <c>label</c>).</summary>
    public string Label => _projection.Label;

    /// <summary>The accessible name the status region announces (web <c>aria-label={label ?? 'Loading'}</c>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Push a new size (web <c>size</c> prop change). Re-projects and raises <see cref="PropertyChanged"/> so the
    /// view resizes the bolt. A no-op when the size is unchanged.
    /// </summary>
    /// <param name="size">The new size.</param>
    public void SetSize(SpinnerSize size)
    {
        if (_size == size)
        {
            return;
        }

        _size = size;
        Reproject();
    }

    /// <summary>
    /// Push a new caption (web <c>label</c> prop change). Re-projects and raises <see cref="PropertyChanged"/> so
    /// the view updates the caption and the accessible name. A no-op when the label is unchanged.
    /// </summary>
    /// <param name="label">The new caption, or null/blank for none.</param>
    public void SetLabel(string? label)
    {
        if (string.Equals(_label, label, StringComparison.Ordinal))
        {
            return;
        }

        _label = label;
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
        SpinnerProjection next = SpinnerProjection.Project(_size, _label, _reduceMotion, _localizer);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

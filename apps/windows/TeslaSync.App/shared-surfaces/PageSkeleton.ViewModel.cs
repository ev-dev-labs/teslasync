using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PageSkeleton"/> view — the native port of the web
/// building-block bodies (web/src/components/feedback/PageSkeleton.tsx). The web blocks' only inputs are their
/// props (<c>cards</c> / <c>height</c> / <c>rows</c> / <c>cols</c>) plus the CSS-evaluated motion preference; this
/// holder mirrors that by tracking the selected <see cref="PageSkeletonBlock"/>, its
/// <see cref="PageSkeletonParameters"/> and the reduce-motion flag from the shared
/// <see cref="IMotionPreferenceSource"/> (P1/S8 seam, reused from the peer motion-aware surfaces). It exposes the
/// projected <see cref="PageSkeletonProjection"/> the view renders and raises <see cref="PropertyChanged"/> when
/// the host re-drives a prop or when the user toggles reduce-motion at runtime (so the view can start/stop the
/// shimmer). The accessible label is resolved through the <see cref="ILocalizer"/> (web <c>aria-label</c>). The
/// view performs no I/O of its own. <see cref="Dispose"/> unsubscribes from the motion source (the web
/// media-query listener cleanup).
/// </summary>
public sealed class PageSkeletonViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IDisposable _motionSubscription;
    private PageSkeletonBlock _block;
    private PageSkeletonParameters _parameters;
    private bool _reduceMotion;
    private PageSkeletonProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the selected block, its parameters, the i18n facade and the motion source.</summary>
    /// <param name="block">The initial building block (web exported function).</param>
    /// <param name="parameters">The initial block parameters (web props).</param>
    /// <param name="localizer">The i18n facade the accessible label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source (P1/S8 seam).</param>
    public PageSkeletonViewModel(
        PageSkeletonBlock block,
        PageSkeletonParameters parameters,
        ILocalizer localizer,
        IMotionPreferenceSource motion)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(motion);

        _localizer = localizer;
        _block = block;
        _parameters = parameters;
        _reduceMotion = motion.ReduceMotion;
        _projection = PageSkeletonProjection.Project(_block, _parameters, _reduceMotion, _localizer);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <summary>Creates the holder with the web prop defaults for <paramref name="block"/> and the supplied seams.</summary>
    /// <param name="block">The initial building block.</param>
    /// <param name="localizer">The i18n facade the accessible label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public PageSkeletonViewModel(PageSkeletonBlock block, ILocalizer localizer, IMotionPreferenceSource motion)
        : this(block, PageSkeletonParameters.Default, localizer, motion)
    {
    }

    /// <summary>Creates the holder defaulting to the page-header block with the web prop defaults.</summary>
    /// <param name="localizer">The i18n facade the accessible label resolves through.</param>
    /// <param name="motion">The reduce-motion preference source.</param>
    public PageSkeletonViewModel(ILocalizer localizer, IMotionPreferenceSource motion)
        : this(PageSkeletonBlock.PageHeader, PageSkeletonParameters.Default, localizer, motion)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>PageSkeleton</c>).</summary>
    public static string Slug => PageSkeletonRegistration.Slug;

    /// <summary>The current render projection (rows of shimmer blocks + label + automation id + motion flag).</summary>
    public PageSkeletonProjection Projection => _projection;

    /// <summary>The current building block (web exported function).</summary>
    public PageSkeletonBlock Block => _projection.Block;

    /// <summary>The current block parameters (web props).</summary>
    public PageSkeletonParameters Parameters => _parameters;

    /// <summary>The accessible name the status region announces (web <c>aria-label</c>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The automation id stamped on the region (web <c>data-testid</c>).</summary>
    public string AutomationId => _projection.AutomationId;

    /// <summary>Whether the shimmer pulses (false under reduced motion).</summary>
    public bool Animate => _projection.Animate;

    /// <summary>The rows of shimmer blocks the view renders, top to bottom.</summary>
    public IReadOnlyList<SkeletonRow> Rows => _projection.Rows;

    /// <summary>The vertical gap between rows in pixels (web <c>space-y-*</c>).</summary>
    public double RowGap => _projection.RowGap;

    /// <summary>
    /// Switch the rendered building block (web: choose a different exported skeleton). Re-projects and raises
    /// <see cref="PropertyChanged"/> so the view rebuilds. A no-op when the block is unchanged.
    /// </summary>
    /// <param name="block">The new building block.</param>
    public void SetBlock(PageSkeletonBlock block)
    {
        if (_block == block)
        {
            return;
        }

        _block = block;
        Reproject();
    }

    /// <summary>
    /// Push new block parameters (web prop change). Re-projects and raises <see cref="PropertyChanged"/> so the
    /// view rebuilds. A no-op when the parameters are unchanged.
    /// </summary>
    /// <param name="parameters">The new block parameters.</param>
    public void SetParameters(PageSkeletonParameters parameters)
    {
        if (_parameters == parameters)
        {
            return;
        }

        _parameters = parameters;
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
        _projection = PageSkeletonProjection.Project(_block, _parameters, _reduceMotion, _localizer);
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

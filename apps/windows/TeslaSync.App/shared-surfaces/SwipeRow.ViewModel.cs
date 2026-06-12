using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SwipeRow"/> view — the native port of the web
/// component body (web/src/components/mobile/SwipeRow.tsx L103-L143). The web component's inputs are its props
/// (<c>leftAction</c> / <c>rightAction</c> with their <c>onAction</c> callbacks, <c>enabled</c>,
/// <c>revealThreshold</c>) plus the CSS-evaluated coarse-pointer and reduce-motion preferences; this holder mirrors
/// that by tracking the wired action display models + their callbacks and the
/// <see cref="ICoarsePointerSource"/> (web <c>useIsCoarsePointer</c>) and <see cref="IMotionPreferenceSource"/>
/// (web <c>useMotionPreference</c>, reused from the AIThinkingIndicator surface). It exposes the projected
/// <see cref="SwipeRowProjection"/> the view renders and raises <see cref="PropertyChanged"/> when the user toggles
/// the pointer capability or reduce-motion at runtime (so the view can attach / detach the gesture or flip the
/// snap-back transition). The action callbacks are invoked through <see cref="InvokeLeftAction"/> /
/// <see cref="InvokeRightAction"/> (web <c>fireLeft</c> / <c>fireRight</c>). The view performs no I/O of its own.
/// <see cref="Dispose"/> unsubscribes from both preference sources (the web media-query listener cleanup).
/// </summary>
public sealed class SwipeRowViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly Action? _onLeftAction;
    private readonly Action? _onRightAction;
    private readonly SwipeActionModel? _leftAction;
    private readonly SwipeActionModel? _rightAction;
    private readonly bool? _enabled;
    private readonly double _revealThreshold;
    private readonly IDisposable _pointerSubscription;
    private readonly IDisposable _motionSubscription;
    private bool _coarsePointer;
    private bool _reduceMotion;
    private SwipeRowProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over the web props and the coarse-pointer + reduce-motion sources (P1/S8 seams).</summary>
    /// <param name="leftAction">The left-edge action display model, or null (web <c>leftAction</c>).</param>
    /// <param name="onLeftAction">The left action callback, or null (web <c>leftAction.onAction</c>).</param>
    /// <param name="rightAction">The right-edge action display model, or null (web <c>rightAction</c>).</param>
    /// <param name="onRightAction">The right action callback, or null (web <c>rightAction.onAction</c>).</param>
    /// <param name="pointerSource">The coarse-pointer source (web <c>useIsCoarsePointer</c>).</param>
    /// <param name="motion">The reduce-motion source (web <c>useMotionPreference</c>).</param>
    /// <param name="enabled">The explicit touch opt-in (web <c>enabled</c>); null defers to the pointer source.</param>
    /// <param name="revealThreshold">The per-row reveal distance (web <c>revealThreshold</c>); non-positive uses the default.</param>
    public SwipeRowViewModel(
        SwipeActionModel? leftAction,
        Action? onLeftAction,
        SwipeActionModel? rightAction,
        Action? onRightAction,
        ICoarsePointerSource pointerSource,
        IMotionPreferenceSource motion,
        bool? enabled = null,
        double revealThreshold = SwipeRowRegistration.DefaultRevealThreshold)
    {
        ArgumentNullException.ThrowIfNull(pointerSource);
        ArgumentNullException.ThrowIfNull(motion);

        _leftAction = leftAction;
        _onLeftAction = onLeftAction;
        _rightAction = rightAction;
        _onRightAction = onRightAction;
        _enabled = enabled;
        _revealThreshold = revealThreshold > 0 ? revealThreshold : SwipeRowRegistration.DefaultRevealThreshold;
        _coarsePointer = pointerSource.IsCoarsePointer;
        _reduceMotion = motion.ReduceMotion;
        _projection = Project();
        _pointerSubscription = pointerSource.Observe(OnCoarsePointerChanged);
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>SwipeRow</c>).</summary>
    public static string Slug => SwipeRowRegistration.Slug;

    /// <summary>The current render projection (active gating, wired actions, motion flag, thresholds).</summary>
    public SwipeRowProjection Projection => _projection;

    /// <summary>Whether the swipe gesture is wired up (web <c>active</c>); false renders children straight through.</summary>
    public bool IsActive => _projection.IsActive;

    /// <summary>The left-edge action display model, or null (web <c>leftAction</c>).</summary>
    public SwipeActionModel? LeftAction => _projection.LeftAction;

    /// <summary>The right-edge action display model, or null (web <c>rightAction</c>).</summary>
    public SwipeActionModel? RightAction => _projection.RightAction;

    /// <summary>Whether a left-edge action is wired (web <c>leftAction != null</c>).</summary>
    public bool HasLeftAction => _projection.HasLeftAction;

    /// <summary>Whether a right-edge action is wired (web <c>rightAction != null</c>).</summary>
    public bool HasRightAction => _projection.HasRightAction;

    /// <summary>Whether the OS reduce-motion preference is set, collapsing the snap-back to 0 ms (web <c>useMotionPreference</c>).</summary>
    public bool ReduceMotion => _projection.ReduceMotion;

    /// <summary>The reveal distance for this row in px (web <c>revealThreshold</c>).</summary>
    public double RevealThreshold => _projection.RevealThreshold;

    /// <summary>The revealed action panel width / resting peek offset in px (web <c>ACTION_WIDTH</c>).</summary>
    public double ActionWidth => _projection.ActionWidth;

    /// <summary>Fire the left-edge action (web <c>fireLeft</c>: <c>leftAction?.onAction()</c>). A no-op when none is wired.</summary>
    public void InvokeLeftAction() => _onLeftAction?.Invoke();

    /// <summary>Fire the right-edge action (web <c>fireRight</c>: <c>rightAction?.onAction()</c>). A no-op when none is wired.</summary>
    public void InvokeRightAction() => _onRightAction?.Invoke();

    /// <summary>Stop listening to both preference sources (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _pointerSubscription.Dispose();
        _motionSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnCoarsePointerChanged(bool coarsePointer)
    {
        if (_coarsePointer == coarsePointer)
        {
            return;
        }

        _coarsePointer = coarsePointer;
        Reproject();
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

    private SwipeRowProjection Project() =>
        SwipeRowProjection.Project(_enabled, _coarsePointer, _reduceMotion, _leftAction, _rightAction, _revealThreshold);

    private void Reproject()
    {
        SwipeRowProjection next = Project();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}

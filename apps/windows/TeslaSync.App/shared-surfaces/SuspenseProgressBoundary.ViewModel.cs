using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.SuspenseProgressBoundarySurface;

/// <summary>
/// The Suspense → global-progress bridge state holder — the native port of the web
/// <c>ProgressTrackingFallback</c> (the internal fallback wrapper inside
/// <c>web/src/components/feedback/SuspenseProgressBoundary.tsx</c>) bound to the shared progress channel
/// (P1/S8). The web wrapper's only behaviour is a <c>useEffect</c> that calls <c>globalProgress.start()</c>
/// when the fallback mounts (the boundary suspended) and the returned <c>stop()</c> when it unmounts (the lazy
/// import resolved); this holder reproduces exactly that by acquiring a consumer when <see cref="IsPending"/>
/// flips true and releasing it (idempotently) when it flips false or the holder is disposed. It also subscribes
/// to the channel so a host can bind <see cref="IsProgressActive"/> / <see cref="Progress"/> to render the bar
/// (the web <c>TopProgress</c> consumer). It is <see cref="INotifyPropertyChanged"/> so the WinUI surface
/// re-renders on the pending edge; the view performs no I/O of its own and never touches the channel directly.
/// </summary>
public sealed class SuspenseProgressBoundaryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGlobalProgress _progress;
    private readonly IDisposable _subscription;
    private IDisposable? _activeBoundary;
    private bool _isPending;
    private bool _isProgressActive;
    private double _progressValue;
    private bool _disposed;

    /// <summary>Creates the holder and subscribes it to <paramref name="progress"/> (the web mount effect).</summary>
    public SuspenseProgressBoundaryViewModel(IGlobalProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);
        _progress = progress;
        _subscription = progress.Subscribe(OnProgressChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Whether the boundary is suspended (the fallback is mounted). Flipping it true acquires a consumer on the
    /// shared channel (web <c>globalProgress.start()</c>); flipping it false releases the consumer (the web
    /// effect cleanup / returned <c>stop()</c>), which is idempotent.
    /// </summary>
    public bool IsPending
    {
        get => _isPending;
        set => SetPending(value);
    }

    /// <summary>Whether the shared channel currently reports the app busy (web <c>active</c>).</summary>
    public bool IsProgressActive => _isProgressActive;

    /// <summary>The current shared trickle value, 0 → <see cref="GlobalProgress.TrickleTarget"/> (web <c>progress</c>).</summary>
    public double Progress => _progressValue;

    /// <summary>Release any held consumer and stop listening to the channel (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _activeBoundary?.Dispose();
        _activeBoundary = null;
        _subscription.Dispose();
    }

    private void SetPending(bool value)
    {
        if (_isPending == value)
        {
            return;
        }

        _isPending = value;
        if (value)
        {
            // Fallback mounted (the boundary suspended) -> activate the channel, exactly like the web
            // ProgressTrackingFallback's useEffect start().
            _activeBoundary = _progress.Start();
        }
        else
        {
            // The real content resolved (fallback unmounted) -> release the consumer; the stop is idempotent.
            _activeBoundary?.Dispose();
            _activeBoundary = null;
        }

        Raise(nameof(IsPending));
    }

    private void OnProgressChanged(bool active, double progress)
    {
        if (_isProgressActive != active)
        {
            _isProgressActive = active;
            Raise(nameof(IsProgressActive));
        }

        if (_progressValue != progress)
        {
            _progressValue = progress;
            Raise(nameof(Progress));
        }
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}

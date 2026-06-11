namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The avatar image seam the <see cref="AvatarViewModel"/> binds through (P1/S8 state-holder layer) — the
/// native analogue of the web component's <c>&lt;img src onError&gt;</c> with its automatic fallback to
/// initials/glyph (web/src/components/data-display/Avatar.tsx). The web component reads the image
/// declaratively in the DOM and flips an <c>imageFailed</c> state on the <c>onError</c> event; the WinUI view
/// has to source and decode the bitmap and react to a decode failure, so that responsibility is expressed as
/// this small seam. <see cref="HasImage"/> is the native projection of the web
/// <c>showImage = Boolean(src) &amp;&amp; !imageFailed</c>: true only while a non-empty source is present and
/// has not failed to load. The production implementation (wrapping a WinUI <c>BitmapImage</c>) lives with the
/// view; <see cref="StaticAvatarImageSource"/> stands in for headless hosts and unit tests so the image vs
/// initials vs glyph branches can be exercised without a XAML runtime.
/// </summary>
public interface IAvatarImageSource
{
    /// <summary>
    /// True while a usable image is available — a non-empty <c>src</c> that has not failed to load (web
    /// <c>showImage</c>). When false the avatar falls through to initials or the generic glyph.
    /// </summary>
    bool HasImage { get; }

    /// <summary>
    /// Subscribe to changes of <see cref="HasImage"/> — fired when the image fails to load so the avatar can
    /// re-project to its fallback (the web <c>onError =&gt; setImageFailed(true)</c> re-render). Dispose the
    /// returned handle to unsubscribe (the web effect cleanup).
    /// </summary>
    IDisposable Observe(Action onChanged);
}

/// <summary>
/// An <see cref="IAvatarImageSource"/> with a fixed <see cref="HasImage"/> value and no runtime changes — the
/// headless / unit-test default. It lets the projection and view-model be verified for both the image branch
/// and the initials/glyph fallback branch without a bitmap decoder. <see cref="Observe"/> returns an
/// already-inert handle because the value never changes.
/// </summary>
public sealed class StaticAvatarImageSource : IAvatarImageSource
{
    /// <summary>Creates a source that always reports <paramref name="hasImage"/>.</summary>
    public StaticAvatarImageSource(bool hasImage) => HasImage = hasImage;

    /// <summary>A shared source that reports "no image" — the common fallback-branch test default.</summary>
    public static StaticAvatarImageSource None { get; } = new(hasImage: false);

    /// <summary>A shared source that reports "image present".</summary>
    public static StaticAvatarImageSource Present { get; } = new(hasImage: true);

    /// <inheritdoc />
    public bool HasImage { get; }

    /// <inheritdoc />
    public IDisposable Observe(Action onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);
        return NoOpSubscription.Instance;
    }

    private sealed class NoOpSubscription : IDisposable
    {
        public static NoOpSubscription Instance { get; } = new();

        private NoOpSubscription()
        {
        }

        public void Dispose()
        {
            // The value never changes, so nothing was subscribed.
        }
    }
}

/// <summary>
/// A mutable in-memory <see cref="IAvatarImageSource"/> — the headless analogue of the web image element's
/// load lifecycle. It starts with an initial <see cref="HasImage"/> (true when a non-empty <c>src</c> was
/// supplied) and exposes <see cref="MarkFailed"/> to simulate the <c>onError</c> event, flipping
/// <see cref="HasImage"/> to false and notifying observers exactly once. Used by tests to drive the
/// image → fallback transition; the WinUI view ships its own <c>BitmapImage</c>-backed implementation.
/// </summary>
public sealed class MutableAvatarImageSource : IAvatarImageSource
{
    private readonly List<Action> _observers = new();
    private bool _hasImage;

    /// <summary>Creates the source. <paramref name="hasImage"/> is the initial state (web <c>Boolean(src)</c>).</summary>
    public MutableAvatarImageSource(bool hasImage) => _hasImage = hasImage;

    /// <inheritdoc />
    public bool HasImage => _hasImage;

    /// <summary>The number of live observers (test introspection).</summary>
    public int ObserverCount => _observers.Count;

    /// <inheritdoc />
    public IDisposable Observe(Action onChanged)
    {
        ArgumentNullException.ThrowIfNull(onChanged);
        _observers.Add(onChanged);
        return new Subscription(this, onChanged);
    }

    /// <summary>
    /// Simulate the image failing to load (web <c>onError</c>): if currently showing the image, flip
    /// <see cref="HasImage"/> to false and notify observers once. A no-op when there is no image to fail.
    /// </summary>
    public void MarkFailed()
    {
        if (!_hasImage)
        {
            return;
        }

        _hasImage = false;
        foreach (Action observer in _observers.ToArray())
        {
            observer();
        }
    }

    private sealed class Subscription : IDisposable
    {
        private readonly MutableAvatarImageSource _owner;
        private readonly Action _observer;
        private bool _disposed;

        public Subscription(MutableAvatarImageSource owner, Action observer)
        {
            _owner = owner;
            _observer = observer;
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _owner._observers.Remove(_observer);
        }
    }
}

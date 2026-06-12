namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The default <see cref="IScrollOffsetStore"/> — the native analogue of the web component's <c>sessionStorage</c>
/// keyed by <c>teslasync.scroll:{pathname}{search}</c> (web <c>readSaved</c> / <c>writeSaved</c>). It keeps the
/// per-location offsets for the lifetime of the process (surviving navigations but not a restart, exactly like a
/// session store) in a lock-guarded dictionary so it can be written from a background scroll/live callback and read
/// from the UI thread. A non-finite offset is dropped on write rather than persisted (web "never fatal" guard), and
/// a never-written key reads back as <see langword="null"/>.
/// </summary>
public sealed class InMemoryScrollOffsetStore : IScrollOffsetStore
{
    private readonly object _gate = new();
    private readonly Dictionary<string, double> _offsets = new(StringComparer.Ordinal);

    /// <inheritdoc />
    public double? Read(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        lock (_gate)
        {
            return _offsets.TryGetValue(key, out double value) ? value : null;
        }
    }

    /// <inheritdoc />
    public void Write(string key, double offset)
    {
        ArgumentNullException.ThrowIfNull(key);

        // web writeSaved: a session store can only hold a finite number; a NaN / infinity reading is dropped so a
        // bad sample never corrupts the saved position (the user just loses restoration for that visit).
        if (double.IsNaN(offset) || double.IsInfinity(offset))
        {
            return;
        }

        lock (_gate)
        {
            _offsets[key] = offset;
        }
    }

    /// <summary>The number of distinct locations with a saved offset (exposed for diagnostics / tests).</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _offsets.Count;
            }
        }
    }

    /// <summary>True when an offset has been saved for <paramref name="key"/> (exposed for tests).</summary>
    /// <param name="key">The per-location key (see <see cref="ScrollRestorationRegistration.KeyFor"/>).</param>
    public bool Has(string key)
    {
        ArgumentNullException.ThrowIfNull(key);
        lock (_gate)
        {
            return _offsets.ContainsKey(key);
        }
    }

    /// <summary>Forget every saved offset (exposed for tests / sign-out).</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _offsets.Clear();
        }
    }
}

/// <summary>
/// A settable <see cref="IScrollRestorationLocationSource"/> the composition root drives — the production binding of
/// the web <c>useLocation()</c> + <c>useNavigationType()</c> pair to the native shell's navigation. The shell calls
/// <see cref="Apply"/> on every navigation with the destination path, search and the navigation kind it performed
/// (forward link → <see cref="ScrollNavigationKind.Push"/>, back/forward → <see cref="ScrollNavigationKind.Pop"/>,
/// in-place → <see cref="ScrollNavigationKind.Replace"/>), and the surface reacts through <see cref="Changed"/>.
/// It defaults to a fresh PUSH at the root so a cold app start lands at the top (no saved state to restore on the
/// first mount); the shell supplies the real kind from the first navigation onward. WinUI-free so the wiring is
/// unit-tested without a UI host.
/// </summary>
public sealed class MutableScrollLocationSource : IScrollRestorationLocationSource
{
    /// <summary>Creates the source over an initial location and navigation kind.</summary>
    /// <param name="path">The initial location path (defaults to the root).</param>
    /// <param name="search">The initial query string (defaults to none).</param>
    /// <param name="navigationKind">The initial navigation kind (defaults to a fresh PUSH).</param>
    public MutableScrollLocationSource(
        string path = "/",
        string search = "",
        ScrollNavigationKind navigationKind = ScrollNavigationKind.Push)
    {
        ArgumentNullException.ThrowIfNull(path);
        ArgumentNullException.ThrowIfNull(search);
        Path = path;
        Search = search;
        NavigationKind = navigationKind;
    }

    /// <inheritdoc />
    public string Path { get; private set; }

    /// <inheritdoc />
    public string Search { get; private set; }

    /// <inheritdoc />
    public ScrollNavigationKind NavigationKind { get; private set; }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>
    /// Apply a navigation to <paramref name="path"/> + <paramref name="search"/> of kind
    /// <paramref name="navigationKind"/> and raise <see cref="Changed"/> (the native analogue of react-router
    /// re-rendering on a location change). Called by the shell once per navigation.
    /// </summary>
    /// <param name="path">The destination location path.</param>
    /// <param name="search">The destination query string; empty when none.</param>
    /// <param name="navigationKind">The kind of navigation performed.</param>
    public void Apply(string path, string search, ScrollNavigationKind navigationKind)
    {
        ArgumentNullException.ThrowIfNull(path);
        ArgumentNullException.ThrowIfNull(search);
        Path = path;
        Search = search;
        NavigationKind = navigationKind;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

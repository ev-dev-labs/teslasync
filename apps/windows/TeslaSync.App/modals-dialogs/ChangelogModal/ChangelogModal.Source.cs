using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The data port the <see cref="ChangelogModalViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged changelog readings — the native analogue of the web
/// <c>useChangelog</c> hook (web/src/hooks/useChangelog.ts), which composes the generated <c>CHANGELOG</c>
/// with the persisted seen-version. The view never performs I/O itself; the concrete
/// <see cref="ChangelogSource"/> (or a test fake) drives this.
/// </summary>
public interface IChangelogSource
{
    /// <summary>Stream the changelog readings — a <c>Loading</c> emission followed by the resolved terminal.</summary>
    IAsyncEnumerable<RepositoryResult<ChangelogReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The persistence seam for the changelog acknowledgement state — the native analogue of the web
/// <c>useChangelog</c> localStorage keys (<c>teslasync:changelog:seen-version</c>,
/// <c>teslasync:changelog:last-shown</c>, <c>teslasync-onboarded</c>). The WinUI app binds this to
/// <c>ApplicationData.LocalSettings</c>; headless callers and unit tests use
/// <see cref="InMemoryChangelogAcknowledgementStore"/>. Implementations must be best-effort: an
/// identity-less context returns the unseen defaults and silently no-ops writes rather than throwing.
/// </summary>
public interface IChangelogAcknowledgementStore
{
    /// <summary>The highest version the user has acknowledged, or <see langword="null"/> if never seen.</summary>
    string? GetSeenVersion();

    /// <summary>Records <paramref name="version"/> as the highest acknowledged release.</summary>
    void SetSeenVersion(string version);

    /// <summary>The last time the modal was surfaced (drives the auto-show throttle), or <see langword="null"/>.</summary>
    DateTimeOffset? GetLastShownAt();

    /// <summary>Stamps the auto-show throttle with <paramref name="timestamp"/>.</summary>
    void SetLastShownAt(DateTimeOffset timestamp);

    /// <summary>True once the user has finished onboarding (web <c>teslasync-onboarded</c> presence).</summary>
    bool HasCompletedOnboarding();
}

/// <summary>
/// An in-memory <see cref="IChangelogAcknowledgementStore"/> for unit tests and the headless fallback. It is
/// intentionally non-durable and counts writes so a test can assert that "Got it" / "View full changelog"
/// stamped the seen-version and throttle.
/// </summary>
public sealed class InMemoryChangelogAcknowledgementStore : IChangelogAcknowledgementStore
{
    private string? _seenVersion;
    private DateTimeOffset? _lastShownAt;
    private readonly bool _onboarded;

    /// <summary>Creates the store seeded with an optional acknowledgement state.</summary>
    /// <param name="seenVersion">The pre-acknowledged version (defaults to a first visit).</param>
    /// <param name="lastShownAt">The last auto-show stamp (defaults to never shown).</param>
    /// <param name="onboarded">Whether onboarding is complete (defaults to <see langword="true"/>).</param>
    public InMemoryChangelogAcknowledgementStore(
        string? seenVersion = null,
        DateTimeOffset? lastShownAt = null,
        bool onboarded = true)
    {
        _seenVersion = seenVersion;
        _lastShownAt = lastShownAt;
        _onboarded = onboarded;
    }

    /// <summary>Number of times <see cref="SetSeenVersion"/> was invoked.</summary>
    public int SeenWrites { get; private set; }

    /// <summary>Number of times <see cref="SetLastShownAt"/> was invoked.</summary>
    public int ShownWrites { get; private set; }

    /// <inheritdoc />
    public string? GetSeenVersion() => _seenVersion;

    /// <inheritdoc />
    public void SetSeenVersion(string version)
    {
        ArgumentNullException.ThrowIfNull(version);
        _seenVersion = version;
        SeenWrites++;
    }

    /// <inheritdoc />
    public DateTimeOffset? GetLastShownAt() => _lastShownAt;

    /// <inheritdoc />
    public void SetLastShownAt(DateTimeOffset timestamp)
    {
        _lastShownAt = timestamp;
        ShownWrites++;
    }

    /// <inheritdoc />
    public bool HasCompletedOnboarding() => _onboarded;
}

/// <summary>
/// The catalog-backed <see cref="IChangelogSource"/> — the native data adapter for the changelog surface. It
/// composes the static <see cref="ChangelogCatalog"/> (the analogue of the web generated <c>CHANGELOG</c>)
/// with the persisted seen-version from an <see cref="IChangelogAcknowledgementStore"/> and surfaces them as
/// a <c>Loading</c> → <c>Loaded</c> sequence (or <c>Loading</c> → <c>Empty</c> when the catalog is empty).
/// The reads are synchronous static data — there is no HTTP — but routing them through the cache-then-network
/// <see cref="RepositoryResult{T}"/> seam lets the view-model surface the skeleton and lets the surface
/// degrade gracefully through the same state machine every other surface uses. No I/O touches the view.
/// </summary>
public sealed class ChangelogSource : IChangelogSource
{
    private readonly IReadOnlyList<ChangelogEntry> _entries;
    private readonly IChangelogAcknowledgementStore _store;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over the catalog entries, acknowledgement store and clock.</summary>
    /// <param name="store">The seen-version persistence seam.</param>
    /// <param name="entries">The release catalog (defaults to the embedded <see cref="ChangelogCatalog.Entries"/>).</param>
    /// <param name="clock">The clock used to stamp the fetched-at time (defaults to <see cref="DateTimeOffset.UtcNow"/>).</param>
    public ChangelogSource(
        IChangelogAcknowledgementStore store,
        IReadOnlyList<ChangelogEntry>? entries = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        _store = store;
        _entries = entries ?? ChangelogCatalog.Entries;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChangelogReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<ChangelogReading>.Loading();

        // Yield so the view-model can paint the skeleton before the (instant) catalog read settles, mirroring
        // the web hook's first render before the synchronous store read resolves.
        await Task.Yield();
        cancellationToken.ThrowIfCancellationRequested();

        yield return Resolve();
    }

    private RepositoryResult<ChangelogReading> Resolve()
    {
        if (_entries.Count == 0)
        {
            return RepositoryResult<ChangelogReading>.Empty(_clock());
        }

        var reading = new ChangelogReading(_entries, _store.GetSeenVersion());
        return RepositoryResult<ChangelogReading>.Loaded(reading, _clock());
    }
}

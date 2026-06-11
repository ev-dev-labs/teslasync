using System.Text.Json;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The deployment consent-requirement seam the <c>CookieConsentBanner</c> binds through (P1/S8) — the native
/// analogue of the web <c>useVersionInfo()</c> query the banner reads <c>data?.require_cookie_consent</c> from
/// (web/src/components/feedback/CookieConsentBanner.tsx L72-74, the <c>GET /system/version</c> hook in
/// web/src/api/hooks/useSettings.ts). It exposes whether consent collection is required for this deployment and
/// raises <see cref="Changed"/> whenever that flag moves (e.g. the version query resolving mid-session). The view
/// never performs HTTP or reads a query itself — it binds to this seam. The production binding is
/// <see cref="RepositoryCookieConsentRequirementSource"/> over the system-version cache-then-network stream;
/// <see cref="StaticCookieConsentRequirementSource"/> stands in for headless hosts and unit tests.
/// </summary>
public interface ICookieConsentRequirementSource
{
    /// <summary>Whether consent collection is required (web <c>data?.require_cookie_consent === true</c>).</summary>
    bool RequireConsent { get; }

    /// <summary>Raised whenever <see cref="RequireConsent"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ICookieConsentRequirementSource"/> with an explicit, caller-set flag — the headless / unit-test
/// default. <see cref="Set"/> moves the flag and raises <see cref="Changed"/> so the banner projection and
/// view-model can be exercised in both the required (banner eligible) and not-required (banner hidden) states
/// without a version query host.
/// </summary>
public sealed class StaticCookieConsentRequirementSource : ICookieConsentRequirementSource
{
    private bool _requireConsent;

    /// <summary>Creates a source over an initial requirement flag (defaults to not required).</summary>
    /// <param name="requireConsent">The initial consent-required flag.</param>
    public StaticCookieConsentRequirementSource(bool requireConsent = false) => _requireConsent = requireConsent;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool RequireConsent => _requireConsent;

    /// <summary>Move the flag and raise <see cref="Changed"/> (the deployment requirement resolving / changing).</summary>
    /// <param name="requireConsent">The new consent-required flag.</param>
    public void Set(bool requireConsent)
    {
        if (_requireConsent == requireConsent)
        {
            return;
        }

        _requireConsent = requireConsent;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="ICookieConsentRequirementSource"/> — binds the requirement to a cache-then-network
/// system-version repository stream, the native analogue of the web <c>useVersionInfo()</c> wiring
/// (web/src/components/feedback/CookieConsentBanner.tsx L72-74). The composition root supplies a stream factory
/// (e.g. <c>ct =&gt; systemAdminRepository.GetVersionAsync(ct)</c>); each value-bearing
/// <see cref="RepositoryResult{T}"/> emission has its <c>require_cookie_consent</c> flag read by
/// <see cref="ReadRequireConsent"/> (or a caller-supplied parser), while a value-less load / empty / error
/// emission surfaces <see langword="false"/> — exactly the web behaviour where an undefined
/// <c>data?.require_cookie_consent</c> collapses to "not required" so the banner stays hidden while the query is
/// loading, absent or failed. <see cref="Refresh"/> re-runs the stream; a monotonic generation guard discards
/// emissions from a superseded run. WinUI-free so it is unit-tested against an in-memory stream without a UI host.
/// </summary>
public sealed class RepositoryCookieConsentRequirementSource : ICookieConsentRequirementSource, IDisposable
{
    private readonly Func<CancellationToken, IAsyncEnumerable<RepositoryResult<JsonElement>>> _stream;
    private readonly Func<JsonElement, bool> _parse;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _gate = new();
    private bool _requireConsent;
    private int _generation;
    private bool _disposed;

    /// <summary>Creates the source over a system-version stream factory and an optional flag parser.</summary>
    /// <param name="stream">
    /// The cache-then-network stream factory (web version query), e.g.
    /// <c>ct =&gt; systemAdminRepository.GetVersionAsync(ct)</c>.
    /// </param>
    /// <param name="parse">
    /// Reads the consent-required flag out of a version payload; defaults to <see cref="ReadRequireConsent"/>.
    /// </param>
    /// <param name="autoStart">Whether to begin the first stream immediately (defaults to true).</param>
    public RepositoryCookieConsentRequirementSource(
        Func<CancellationToken, IAsyncEnumerable<RepositoryResult<JsonElement>>> stream,
        Func<JsonElement, bool>? parse = null,
        bool autoStart = true)
    {
        ArgumentNullException.ThrowIfNull(stream);
        _stream = stream;
        _parse = parse ?? ReadRequireConsent;

        if (autoStart)
        {
            Refresh();
        }
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool RequireConsent
    {
        get
        {
            lock (_gate)
            {
                return _requireConsent;
            }
        }
    }

    /// <summary>Re-run the version stream (the web query refetch).</summary>
    public void Refresh()
    {
        if (_disposed)
        {
            return;
        }

        var generation = Interlocked.Increment(ref _generation);
        _ = PumpAsync(generation);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _lifetime.Cancel();
        _lifetime.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Read the <c>require_cookie_consent</c> boolean out of a <c>/system/version</c> payload — tolerant of the
    /// <c>camelCaseKeys</c> duality (both <c>require_cookie_consent</c> and <c>requireCookieConsent</c> may be
    /// present after the web transform) and of a stringified boolean, defaulting to <see langword="false"/> when
    /// the flag is absent or not truthy (the web <c>Boolean(data?.require_cookie_consent)</c> coercion).
    /// </summary>
    /// <param name="version">The decoded version payload.</param>
    public static bool ReadRequireConsent(JsonElement version)
    {
        if (version.ValueKind != JsonValueKind.Object)
        {
            return false;
        }

        if (version.TryGetProperty("require_cookie_consent", out var snake) && AsBool(snake))
        {
            return true;
        }

        return version.TryGetProperty("requireCookieConsent", out var camel) && AsBool(camel);
    }

    private static bool AsBool(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => bool.TryParse(value.GetString(), out var parsed) && parsed,
        _ => false,
    };

    private async Task PumpAsync(int generation)
    {
        try
        {
            await foreach (var result in _stream(_lifetime.Token).ConfigureAwait(false))
            {
                if (Volatile.Read(ref _generation) != generation)
                {
                    // A newer Refresh superseded this run; stop applying its emissions.
                    return;
                }

                // A value-less load / empty / error emission collapses to "not required" — the web
                // Boolean(undefined) === false behaviour that keeps the banner hidden until the flag resolves.
                var next = result.HasValue && result.Value is { } value && _parse(value);
                Update(next);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by Dispose (lifetime cancelled); nothing to surface.
        }
        catch (ObjectDisposedException)
        {
            // The lifetime token source was disposed mid-enumeration during Dispose; safe to ignore.
        }
    }

    private void Update(bool requireConsent)
    {
        lock (_gate)
        {
            if (_requireConsent == requireConsent)
            {
                return;
            }

            _requireConsent = requireConsent;
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The consent-decision storage seam the <c>CookieConsentBanner</c> binds through (P1/S8) — the native analogue
/// of the web <c>cookieConsent</c> storage helper (web/src/lib/cookieConsent.ts: <c>getConsent()</c> /
/// <c>setConsent()</c> / <c>subscribeConsent()</c>). It reads the current tri-state decision, persists an explicit
/// decision, and raises <see cref="Changed"/> so the banner re-renders without a reload (the web
/// <c>cookie-consent-changed</c> event). The view never touches storage itself. The production binding is
/// <see cref="DelegatedCookieConsentStore"/> over a host-supplied raw get/set (the localStorage analogue);
/// <see cref="InMemoryCookieConsentStore"/> stands in for headless hosts and unit tests.
/// </summary>
public interface ICookieConsentStore
{
    /// <summary>The user's stored decision, or <see cref="CookieConsentState.Unknown"/> if none (web <c>getConsent()</c>).</summary>
    CookieConsentState GetConsent();

    /// <summary>Persist a decision and raise <see cref="Changed"/> (web <c>setConsent()</c> / <c>clearConsent()</c>).</summary>
    /// <param name="state">The decision to persist; <see cref="CookieConsentState.Unknown"/> clears it.</param>
    void SetConsent(CookieConsentState state);

    /// <summary>Raised whenever the stored decision changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="ICookieConsentStore"/> backed by an in-memory cell — the headless / unit-test default and a
/// fully-functional (non-durable) store. It lets the banner be exercised across every decision (unknown /
/// accepted / declined) and the subscribe-and-re-render flow without a storage host.
/// </summary>
public sealed class InMemoryCookieConsentStore : ICookieConsentStore
{
    private CookieConsentState _state;

    /// <summary>Creates a store seeded with <paramref name="initial"/> (unknown by default).</summary>
    /// <param name="initial">The initial stored decision.</param>
    public InMemoryCookieConsentStore(CookieConsentState initial = CookieConsentState.Unknown) => _state = initial;

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>The number of times <see cref="SetConsent"/> committed a change (for write-forwarding assertions).</summary>
    public int WriteCount { get; private set; }

    /// <inheritdoc />
    public CookieConsentState GetConsent() => _state;

    /// <inheritdoc />
    public void SetConsent(CookieConsentState state)
    {
        if (_state == state)
        {
            return;
        }

        _state = state;
        WriteCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="ICookieConsentStore"/> — adapts a host-supplied raw string get/set into the consent
/// store, the native analogue of the web <c>safeLocalStorage()</c> accessor pair the storage helper reads and
/// writes <see cref="CookieConsentBannerRegistration.ConsentStorageKey"/> through
/// (web/src/lib/cookieConsent.ts L45-100). The composition root supplies the reader/writer bound to the packaged
/// app's <c>ApplicationData.LocalSettings</c> (the WinUI persistence primitive). Reads classify the raw token via
/// <see cref="CookieConsentBannerRegistration.ParseConsent"/>; writes persist the
/// <see cref="CookieConsentBannerRegistration.ToStorageValue"/> token (null clears it). Both are best-effort:
/// a reader/writer throwing (private-mode / identity-less / quota failures) is swallowed and a failed read
/// collapses to <see cref="CookieConsentState.Unknown"/>, exactly as the web helper never throws — a deployment
/// that cannot persist consent simply re-prompts, which is itself the correct GDPR behaviour. WinUI-free (it holds
/// only delegates) so it is unit-tested against in-memory read/write closures.
/// </summary>
public sealed class DelegatedCookieConsentStore : ICookieConsentStore
{
    private readonly Func<string?> _read;
    private readonly Action<string?> _write;

    /// <summary>Creates the store over a raw-token reader and writer (the host's local-storage bridge).</summary>
    /// <param name="read">Returns the raw stored token, or null when absent/unreadable (web <c>getItem</c>).</param>
    /// <param name="write">Persists the raw token; a null token clears it (web <c>setItem</c> / <c>removeItem</c>).</param>
    public DelegatedCookieConsentStore(Func<string?> read, Action<string?> write)
    {
        ArgumentNullException.ThrowIfNull(read);
        ArgumentNullException.ThrowIfNull(write);
        _read = read;
        _write = write;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public CookieConsentState GetConsent()
    {
        try
        {
            return CookieConsentBannerRegistration.ParseConsent(_read());
        }
        catch (Exception)
        {
            // Storage read failures never throw — fall back to the not-yet-decided state (web safeLocalStorage).
            return CookieConsentState.Unknown;
        }
    }

    /// <inheritdoc />
    public void SetConsent(CookieConsentState state)
    {
        try
        {
            _write(CookieConsentBannerRegistration.ToStorageValue(state));
        }
        catch (Exception)
        {
            // Quota / private-mode / identity-less write failures are silent by design (web safeLocalStorage);
            // the in-tab change is still dispatched so subscribers re-render and the next prompt re-collects.
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }
}

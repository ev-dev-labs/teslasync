namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The client-side cookie / analytics consent decision — the native port of the web <c>ConsentState</c> union
/// (<c>'accepted' | 'declined' | 'unknown'</c> in web/src/lib/cookieConsent.ts). <see cref="Unknown"/> is the
/// default before the user decides (web parity: the consent banner re-appears on the next visit while the
/// state is unknown).
/// </summary>
public enum PrivacyConsentState
{
    /// <summary>The user has not decided yet (web <c>'unknown'</c>) — the banner will re-appear.</summary>
    Unknown,

    /// <summary>The user granted consent (web <c>'accepted'</c>) — performance / error reporting is on.</summary>
    Accepted,

    /// <summary>The user withdrew consent (web <c>'declined'</c>) — only essential storage is used.</summary>
    Declined,
}

/// <summary>
/// The consent state-holder seam the <see cref="PrivacySectionViewModel"/> binds to (P1/S8) — the native
/// analogue of the web <c>cookieConsent</c> store (<c>getConsent</c> / <c>setConsent</c> / <c>clearConsent</c>
/// / <c>subscribeConsent</c> in web/src/lib/cookieConsent.ts). It exposes the current decision and a change
/// signal so the surface re-renders live when the decision mutates (the web <c>subscribeConsent</c> callback,
/// which also fires on cross-tab <c>storage</c> events). The view never reads the store directly; the
/// canonical <see cref="ConsentSource"/> (or a test fake) drives this.
/// </summary>
public interface IConsentSource
{
    /// <summary>Raised whenever the consent decision changes (the web <c>subscribeConsent</c> signal).</summary>
    event EventHandler? Changed;

    /// <summary>The current consent decision (web <c>getConsent()</c>).</summary>
    PrivacyConsentState Current { get; }

    /// <summary>Grant consent (web <c>setConsent('accepted')</c>).</summary>
    void Accept();

    /// <summary>Withdraw consent (web <c>setConsent('declined')</c>).</summary>
    void Decline();

    /// <summary>Reset to "not decided" so the banner re-appears (web <c>clearConsent()</c>).</summary>
    void Reset();
}

/// <summary>
/// The canonical <see cref="IConsentSource"/> — an observable, optionally-persisted holder of the cookie
/// consent decision (the native analogue of the web module-level <c>localStorage</c>-backed store). The view's
/// <c>Create</c> factory wires it over <c>ApplicationData.LocalSettings</c> so the decision survives a restart
/// exactly as the web store survives a reload; headless callers and unit tests use the parameterless
/// in-memory constructor. Each mutation persists the new token <b>before</b> raising <see cref="Changed"/> so
/// a re-read on the change callback sees the committed value (web parity). Free of WinUI / Windows.Storage
/// types so the holder is unit-tested without a host.
/// </summary>
public sealed class ConsentSource : IConsentSource
{
    /// <summary>The persisted token for the accepted decision (web localStorage value).</summary>
    public const string AcceptedToken = "accepted";

    /// <summary>The persisted token for the declined decision (web localStorage value).</summary>
    public const string DeclinedToken = "declined";

    private readonly Action<string?>? _persist;
    private PrivacyConsentState _current;

    /// <summary>
    /// Creates the holder, seeding the current decision from <paramref name="read"/> (the persisted token, or
    /// null for "unknown") and persisting future changes through <paramref name="persist"/>. Both default to
    /// null for a pure in-memory holder (the headless / unit-test default).
    /// </summary>
    /// <param name="read">Reads the persisted consent token once at construction (null → unknown).</param>
    /// <param name="persist">Persists a new token (null clears it); null for an in-memory holder.</param>
    public ConsentSource(Func<string?>? read = null, Action<string?>? persist = null)
    {
        _persist = persist;
        _current = ParseToken(read?.Invoke());
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public PrivacyConsentState Current => _current;

    /// <inheritdoc />
    public void Accept() => Set(PrivacyConsentState.Accepted);

    /// <inheritdoc />
    public void Decline() => Set(PrivacyConsentState.Declined);

    /// <inheritdoc />
    public void Reset() => Set(PrivacyConsentState.Unknown);

    /// <summary>The persisted token for <paramref name="state"/> (null for <see cref="PrivacyConsentState.Unknown"/>).</summary>
    public static string? ToToken(PrivacyConsentState state) => state switch
    {
        PrivacyConsentState.Accepted => AcceptedToken,
        PrivacyConsentState.Declined => DeclinedToken,
        _ => null,
    };

    /// <summary>Parse a persisted token into a decision; an unknown / null token is <see cref="PrivacyConsentState.Unknown"/>.</summary>
    public static PrivacyConsentState ParseToken(string? token) => token switch
    {
        AcceptedToken => PrivacyConsentState.Accepted,
        DeclinedToken => PrivacyConsentState.Declined,
        _ => PrivacyConsentState.Unknown,
    };

    private void Set(PrivacyConsentState state)
    {
        if (_current == state)
        {
            return;
        }

        _current = state;
        _persist?.Invoke(ToToken(state));
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The "don't ask again" silence seam for the destructive clear confirmation — the native analogue of the web
/// <c>confirmSilence</c> allowlist (<c>isSilenced</c> / <c>silence</c> in web/src/lib/confirmSilence.ts). When
/// a user opts a non-destructive action out of future prompts, the action id is remembered here and the
/// confirmation is short-circuited next time (web parity: <c>ConfirmDialog</c> auto-confirms a silenced
/// action). Free of WinUI types so the store is unit-tested without a host.
/// </summary>
public interface IConfirmSilenceStore
{
    /// <summary>True when the user previously opted to silence <paramref name="key"/> (web <c>isSilenced</c>).</summary>
    bool IsSilenced(string key);

    /// <summary>Remember that the user no longer wants to be asked about <paramref name="key"/> (web <c>silence</c>).</summary>
    void Silence(string key);
}

/// <summary>
/// The canonical <see cref="IConfirmSilenceStore"/> — an in-memory allowlist of silenced action ids, optionally
/// persisted (the view's <c>Create</c> factory backs it with <c>ApplicationData.LocalSettings</c> so the
/// choice survives a restart, exactly as the web store survives a reload). A blank key is ignored (web
/// parity). Free of WinUI / Windows.Storage types so the store is unit-tested without a host.
/// </summary>
public sealed class ConfirmSilenceStore : IConfirmSilenceStore
{
    private readonly HashSet<string> _silenced;
    private readonly Action<IReadOnlyCollection<string>>? _persist;

    /// <summary>
    /// Creates the store, seeding the allowlist from <paramref name="read"/> and persisting changes through
    /// <paramref name="persist"/>. Both default to null for a pure in-memory store (the headless / test default).
    /// </summary>
    /// <param name="read">Reads the persisted set of silenced action ids once at construction.</param>
    /// <param name="persist">Persists the updated set; null for an in-memory store.</param>
    public ConfirmSilenceStore(
        Func<IEnumerable<string>>? read = null,
        Action<IReadOnlyCollection<string>>? persist = null)
    {
        _persist = persist;
        _silenced = read is null
            ? new HashSet<string>(StringComparer.Ordinal)
            : new HashSet<string>(read().Where(k => !string.IsNullOrEmpty(k)), StringComparer.Ordinal);
    }

    /// <inheritdoc />
    public bool IsSilenced(string key) =>
        !string.IsNullOrEmpty(key) && _silenced.Contains(key);

    /// <inheritdoc />
    public void Silence(string key)
    {
        if (string.IsNullOrEmpty(key) || !_silenced.Add(key))
        {
            return;
        }

        _persist?.Invoke(_silenced.ToArray());
    }
}

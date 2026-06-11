namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The platform installability seam the <c>InstallPrompt</c> binds through (P1/S8) — the native analogue of the
/// web <c>beforeinstallprompt</c> / <c>appinstalled</c> window events plus the standalone-mode probe the prompt
/// reads (web/src/components/feedback/InstallPrompt.tsx L31-62). It exposes whether a deferred install affordance
/// is currently available (<see cref="CanInstall"/> — the web captured <c>deferredPrompt</c>), whether the app is
/// already installed / running standalone (<see cref="IsInstalled"/> — the web <c>isStandaloneMode()</c>), raises
/// <see cref="Changed"/> when either moves (the web event handlers calling <c>setDeferredPrompt</c> /
/// <c>setVisible</c>), and presents the one-shot platform affordance via <see cref="PromptAsync"/> (the web
/// <c>deferredPrompt.prompt()</c> + <c>userChoice</c>). The view never touches a window event or a media query
/// itself — it binds to this seam. The production binding is <see cref="DelegatedInstallAvailabilitySource"/> over
/// the host's install manager; <see cref="StaticInstallAvailabilitySource"/> stands in for headless hosts and unit
/// tests.
/// </summary>
public interface IInstallAvailabilitySource
{
    /// <summary>Whether a deferred install affordance is available (web <c>deferredPrompt != null</c>).</summary>
    bool CanInstall { get; }

    /// <summary>Whether the app is already installed / running standalone (web <c>isStandaloneMode()</c>).</summary>
    bool IsInstalled { get; }

    /// <summary>Raised whenever <see cref="CanInstall"/> or <see cref="IsInstalled"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Present the platform install affordance and resolve the user's choice — the web
    /// <c>deferredPrompt.prompt()</c> + <c>await deferredPrompt.userChoice</c>. The affordance is one-shot: it is
    /// consumed by this call (<see cref="CanInstall"/> becomes <see langword="false"/> and <see cref="Changed"/> is
    /// raised), mirroring the web <c>setDeferredPrompt(null)</c> that follows the choice.
    /// </summary>
    Task<InstallChoiceOutcome> PromptAsync();
}

/// <summary>
/// An <see cref="IInstallAvailabilitySource"/> with explicit, caller-set flags — the headless / unit-test default.
/// <see cref="Offer"/> makes a deferred install available (the web <c>beforeinstallprompt</c> firing),
/// <see cref="MarkInstalled"/> records the app as installed (the web <c>appinstalled</c> firing), and
/// <see cref="PromptAsync"/> resolves to <see cref="NextOutcome"/> while consuming the affordance — so the prompt
/// projection and view-model can be exercised across every branch (offered, installed, consumed) without a window
/// event host.
/// </summary>
public sealed class StaticInstallAvailabilitySource : IInstallAvailabilitySource
{
    private bool _canInstall;
    private bool _isInstalled;

    /// <summary>Creates a source over initial installability flags (defaults to no offer, not installed).</summary>
    /// <param name="canInstall">Whether a deferred install affordance starts available.</param>
    /// <param name="isInstalled">Whether the app starts installed / standalone.</param>
    public StaticInstallAvailabilitySource(bool canInstall = false, bool isInstalled = false)
    {
        _canInstall = canInstall;
        _isInstalled = isInstalled;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool CanInstall => _canInstall;

    /// <inheritdoc />
    public bool IsInstalled => _isInstalled;

    /// <summary>The outcome <see cref="PromptAsync"/> resolves to (defaults to <see cref="InstallChoiceOutcome.Accepted"/>).</summary>
    public InstallChoiceOutcome NextOutcome { get; set; } = InstallChoiceOutcome.Accepted;

    /// <summary>The number of times <see cref="PromptAsync"/> presented the affordance (for assertions).</summary>
    public int PromptCount { get; private set; }

    /// <summary>Make a deferred install available and raise <see cref="Changed"/> (the web <c>beforeinstallprompt</c>).</summary>
    public void Offer()
    {
        if (_canInstall)
        {
            return;
        }

        _canInstall = true;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Record the app as installed (clearing any offer) and raise <see cref="Changed"/> (the web <c>appinstalled</c>).</summary>
    public void MarkInstalled()
    {
        if (_isInstalled && !_canInstall)
        {
            return;
        }

        _isInstalled = true;
        _canInstall = false;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public Task<InstallChoiceOutcome> PromptAsync()
    {
        PromptCount++;

        if (!_canInstall)
        {
            // No affordance to present (web handleInstall's `if (!deferredPrompt) return`).
            return Task.FromResult(InstallChoiceOutcome.Dismissed);
        }

        // Consume the one-shot affordance (web setDeferredPrompt(null)); the surface re-renders away.
        _canInstall = false;
        Changed?.Invoke(this, EventArgs.Empty);
        return Task.FromResult(NextOutcome);
    }
}

/// <summary>
/// The production <see cref="IInstallAvailabilitySource"/> — adapts the host's install manager into the seam, the
/// native analogue of the web window-event wiring (web/src/components/feedback/InstallPrompt.tsx L41-62). The
/// composition root supplies the current-state readers (e.g. bound to the packaged app's install state and the
/// captured deferred-install affordance) and an optional presenter; it calls <see cref="RaiseChanged"/> whenever a
/// host install event fires so the surface re-renders. On a packaged Windows build the app is already installed, so
/// the host reports <see cref="IsInstalled"/> = <see langword="true"/> / <see cref="CanInstall"/> =
/// <see langword="false"/> and the surface stays hidden — exactly the web behaviour where a standalone session
/// never shows the prompt. WinUI-free (it holds only delegates) so it is unit-tested against in-memory closures.
/// </summary>
public sealed class DelegatedInstallAvailabilitySource : IInstallAvailabilitySource
{
    private readonly Func<bool> _canInstall;
    private readonly Func<bool> _isInstalled;
    private readonly Func<Task<InstallChoiceOutcome>>? _prompt;

    /// <summary>Creates the source over the host's installability readers and an optional presenter.</summary>
    /// <param name="canInstall">Reads whether a deferred install affordance is available (web <c>deferredPrompt != null</c>).</param>
    /// <param name="isInstalled">Reads whether the app is installed / standalone (web <c>isStandaloneMode()</c>).</param>
    /// <param name="prompt">Presents the platform affordance and resolves the choice (web <c>deferredPrompt.prompt()</c>); null resolves to <see cref="InstallChoiceOutcome.Dismissed"/>.</param>
    public DelegatedInstallAvailabilitySource(
        Func<bool> canInstall,
        Func<bool> isInstalled,
        Func<Task<InstallChoiceOutcome>>? prompt = null)
    {
        ArgumentNullException.ThrowIfNull(canInstall);
        ArgumentNullException.ThrowIfNull(isInstalled);
        _canInstall = canInstall;
        _isInstalled = isInstalled;
        _prompt = prompt;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool CanInstall => _canInstall();

    /// <inheritdoc />
    public bool IsInstalled => _isInstalled();

    /// <summary>Surface a host install event (<c>beforeinstallprompt</c> / <c>appinstalled</c>) to subscribers.</summary>
    public void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    /// <inheritdoc />
    public async Task<InstallChoiceOutcome> PromptAsync()
    {
        if (_prompt is null || !CanInstall)
        {
            return InstallChoiceOutcome.Dismissed;
        }

        var outcome = await _prompt().ConfigureAwait(false);

        // The platform affordance is one-shot; surface its consumption so the prompt re-renders away.
        RaiseChanged();
        return outcome;
    }
}

/// <summary>
/// The dismissal-persistence seam the <c>InstallPrompt</c> binds through (P1/S8) — the native analogue of the web
/// sticky-per-browser localStorage timestamp (<c>wasDismissedRecently()</c> / the <c>handleDismiss</c> write,
/// web/src/components/feedback/InstallPrompt.tsx L17-29, L74-83) together with its cross-tab
/// <c>broadcast({ type: 'install.dismissed' })</c> synchronisation (L82, L87-94). It reports whether the prompt was
/// dismissed within the suppression window, persists a fresh dismissal, and raises <see cref="Changed"/> so the
/// surface re-renders without a reload — covering BOTH a local dismissal and a sibling instance's broadcast.
/// Implementations must be best-effort: a failure to read or write degrades to "not dismissed" so the prompt
/// reappears, never throws (mirrors the web try/catch around localStorage). The production binding persists in
/// <c>ApplicationData.LocalSettings</c> (in the view layer); <see cref="InMemoryInstallDismissalStore"/> /
/// <see cref="DelegatedInstallDismissalStore"/> stand in for headless hosts and unit tests.
/// </summary>
public interface IInstallDismissalStore
{
    /// <summary>True while a recorded dismissal is still within the suppression window (web <c>wasDismissedRecently()</c>).</summary>
    bool IsDismissedRecently { get; }

    /// <summary>Persist a fresh dismissal and raise <see cref="Changed"/> (web <c>handleDismiss</c> + broadcast).</summary>
    void Dismiss();

    /// <summary>Raised whenever the dismissal state changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IInstallDismissalStore"/> backed by an in-memory cell over an injectable clock — the headless /
/// unit-test default and a fully-functional (non-durable) store. It lets the prompt be exercised across the
/// not-dismissed, just-dismissed and window-expired states, plus the dismiss-and-re-render flow, without a storage
/// host. <see cref="Reset"/> clears the dismissal for successive specs in one run.
/// </summary>
public sealed class InMemoryInstallDismissalStore : IInstallDismissalStore
{
    private readonly Func<DateTimeOffset> _clock;
    private DateTimeOffset? _dismissedAt;

    /// <summary>Creates the store over an optional clock and an optional seeded prior dismissal instant.</summary>
    /// <param name="clock">The current-instant source (defaults to <see cref="DateTimeOffset.UtcNow"/>).</param>
    /// <param name="dismissedAt">A seeded prior dismissal instant (a simulated earlier acknowledgement).</param>
    public InMemoryInstallDismissalStore(Func<DateTimeOffset>? clock = null, DateTimeOffset? dismissedAt = null)
    {
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _dismissedAt = dismissedAt;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <summary>When the prompt was last dismissed, or null if never (for assertions).</summary>
    public DateTimeOffset? DismissedAt => _dismissedAt;

    /// <summary>Number of times <see cref="Dismiss"/> recorded a dismissal (for write assertions).</summary>
    public int DismissCount { get; private set; }

    /// <inheritdoc />
    public bool IsDismissedRecently => InstallPromptRegistration.IsDismissedRecently(_dismissedAt, _clock());

    /// <inheritdoc />
    public void Dismiss()
    {
        _dismissedAt = _clock();
        DismissCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Clear the recorded dismissal and raise <see cref="Changed"/> (the test reset seam).</summary>
    public void Reset()
    {
        if (_dismissedAt is null)
        {
            return;
        }

        _dismissedAt = null;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IInstallDismissalStore"/> — adapts a host-supplied raw string get/set into the
/// dismissal store, the native analogue of the web localStorage accessor pair the prompt reads and writes
/// <see cref="InstallPromptRegistration.DismissStorageKey"/> through
/// (web/src/components/feedback/InstallPrompt.tsx L20-29, L74-83). The composition root supplies the reader/writer
/// bound to the packaged app's <c>ApplicationData.LocalSettings</c> and an optional clock. Reads classify the raw
/// token via <see cref="InstallPromptRegistration.IsDismissedRecently(string?, DateTimeOffset)"/>; writes persist
/// the <see cref="InstallPromptRegistration.FormatDismissedAt"/> stamp. Both are best-effort: a reader/writer
/// throwing (private-mode / identity-less / quota failures) is swallowed and a failed read collapses to "not
/// dismissed", exactly as the web helper never throws — a deployment that cannot persist the dismissal simply
/// re-prompts. <see cref="NotifyExternalDismissal"/> re-raises <see cref="Changed"/> for a sibling instance's
/// broadcast (the web <c>subscribe</c> handler). WinUI-free (it holds only delegates) so it is unit-tested against
/// in-memory read/write closures.
/// </summary>
public sealed class DelegatedInstallDismissalStore : IInstallDismissalStore
{
    private readonly Func<string?> _read;
    private readonly Action<string?> _write;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the store over a raw-token reader, a writer, and an optional clock.</summary>
    /// <param name="read">Returns the raw stored token, or null when absent/unreadable (web <c>getItem</c>).</param>
    /// <param name="write">Persists the raw token (web <c>setItem</c>).</param>
    /// <param name="clock">The current-instant source (defaults to <see cref="DateTimeOffset.UtcNow"/>).</param>
    public DelegatedInstallDismissalStore(Func<string?> read, Action<string?> write, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(read);
        ArgumentNullException.ThrowIfNull(write);
        _read = read;
        _write = write;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsDismissedRecently
    {
        get
        {
            try
            {
                return InstallPromptRegistration.IsDismissedRecently(_read(), _clock());
            }
            catch (Exception)
            {
                // Storage read failures never throw — fall back to "not dismissed" (web safe-localStorage read).
                return false;
            }
        }
    }

    /// <inheritdoc />
    public void Dismiss()
    {
        try
        {
            _write(InstallPromptRegistration.FormatDismissedAt(_clock()));
        }
        catch (Exception)
        {
            // Quota / private-mode / identity-less write failures are silent by design (web safe-localStorage);
            // the in-instance change is still dispatched so subscribers re-render for this session.
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Re-raise <see cref="Changed"/> for a sibling instance's dismiss broadcast — the native analogue of the web
    /// <c>subscribe((m) =&gt; m.type === 'install.dismissed' ? hide : noop)</c> handler. The store re-reads the
    /// (now sibling-written) token, so the prompt collapses without a reload.
    /// </summary>
    public void NotifyExternalDismissal() => Changed?.Invoke(this, EventArgs.Empty);
}

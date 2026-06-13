namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The onboarded-flag seam the <see cref="OnboardingWizardViewModel"/> binds through (P1/S8) — the native
/// analogue of the web <c>localStorage</c> onboarding flag together with its cross-instance
/// <c>broadcast({ type: 'onboarded' })</c> synchronisation (web/src/components/feedback/OnboardingWizard.tsx
/// L51, L61-71). It reports whether onboarding has already completed (<see cref="IsOnboarded"/> — the web
/// <c>localStorage.getItem(ONBOARDED_KEY)</c> truthiness read), persists completion and announces it to peers
/// (<see cref="Complete"/> — the web <c>setItem(ONBOARDED_KEY, 'true')</c> + <c>broadcast('onboarded')</c>), and
/// raises <see cref="Changed"/> so the surface re-renders without a reload — covering BOTH a local completion and
/// a sibling instance's broadcast (the web <c>subscribe((m) =&gt; m.type === 'onboarded' &amp;&amp; hide)</c>
/// handler, L61-65). Implementations must be best-effort: a failure to read or write degrades to "not onboarded"
/// so the wizard reappears, never throws (mirrors the web bare localStorage access). The production binding
/// persists in <c>ApplicationData.LocalSettings</c> (in the view layer); <see cref="InMemoryOnboardingStore"/> /
/// <see cref="DelegatedOnboardingStore"/> stand in for headless hosts and unit tests.
/// </summary>
public interface IOnboardingStore
{
    /// <summary>True once onboarding has completed (web <c>localStorage.getItem(ONBOARDED_KEY)</c> is truthy).</summary>
    bool IsOnboarded { get; }

    /// <summary>Persist onboarding completion and raise <see cref="Changed"/> (web <c>handleClose</c> + broadcast).</summary>
    void Complete();

    /// <summary>Raised whenever the onboarded state changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// An <see cref="IOnboardingStore"/> backed by an in-memory cell — the headless / unit-test default and a
/// fully-functional (non-durable) store. It lets the wizard be exercised across the not-onboarded and
/// just-onboarded states, plus the complete-and-re-render flow, without a storage host. <see cref="Reset"/>
/// clears the flag for successive specs in one run; <see cref="Shared"/> is the process-wide instance a host can
/// register so every surface observes one shared completion flag.
/// </summary>
public sealed class InMemoryOnboardingStore : IOnboardingStore
{
    private int _onboarded;

    /// <summary>Creates the store with an optional seeded prior completion (a simulated earlier onboarding).</summary>
    /// <param name="onboarded">Whether the store starts already onboarded.</param>
    public InMemoryOnboardingStore(bool onboarded = false) => _onboarded = onboarded ? 1 : 0;

    /// <summary>The process-wide onboarding flag the host can register so every surface shares one completion state.</summary>
    public static InMemoryOnboardingStore Shared { get; } = new();

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsOnboarded => Volatile.Read(ref _onboarded) != 0;

    /// <summary>Number of times <see cref="Complete"/> recorded a completion (for write assertions).</summary>
    public int CompleteCount { get; private set; }

    /// <inheritdoc />
    public void Complete()
    {
        Volatile.Write(ref _onboarded, 1);
        CompleteCount++;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Clear the onboarded flag and raise <see cref="Changed"/> (the test reset seam).</summary>
    public void Reset()
    {
        if (Volatile.Read(ref _onboarded) == 0)
        {
            return;
        }

        Volatile.Write(ref _onboarded, 0);
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The production <see cref="IOnboardingStore"/> — adapts a host-supplied raw string get/set into the onboarded
/// store, the native analogue of the web localStorage accessor pair the wizard reads and writes
/// <see cref="OnboardingWizardRegistration.OnboardedStorageKey"/> through
/// (web/src/components/feedback/OnboardingWizard.tsx L51, L68). The composition root supplies the reader/writer
/// bound to the packaged app's <c>ApplicationData.LocalSettings</c>. Reads classify the raw token via
/// <see cref="OnboardingWizardRegistration.IsOnboarded(string?)"/>; writes persist
/// <see cref="OnboardingWizardRegistration.OnboardedStorageValue"/>. Both are best-effort: a reader/writer
/// throwing (identity-less / quota failures) is swallowed and a failed read collapses to "not onboarded", exactly
/// as the web access never crashes the app. <see cref="NotifyExternalCompletion"/> re-raises <see cref="Changed"/>
/// for a sibling instance's broadcast (the web <c>subscribe('onboarded')</c> handler). WinUI-free (it holds only
/// delegates) so it is unit-tested against in-memory read/write closures.
/// </summary>
public sealed class DelegatedOnboardingStore : IOnboardingStore
{
    private readonly Func<string?> _read;
    private readonly Action<string> _write;

    /// <summary>Creates the store over a raw-token reader and a writer.</summary>
    /// <param name="read">Returns the raw stored token, or null when absent/unreadable (web <c>getItem</c>).</param>
    /// <param name="write">Persists the onboarded token (web <c>setItem</c>).</param>
    public DelegatedOnboardingStore(Func<string?> read, Action<string> write)
    {
        ArgumentNullException.ThrowIfNull(read);
        ArgumentNullException.ThrowIfNull(write);
        _read = read;
        _write = write;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public bool IsOnboarded
    {
        get
        {
            try
            {
                return OnboardingWizardRegistration.IsOnboarded(_read());
            }
            catch (Exception)
            {
                // Storage read failures never throw — fall back to "not onboarded" (web bare localStorage read).
                return false;
            }
        }
    }

    /// <inheritdoc />
    public void Complete()
    {
        try
        {
            _write(OnboardingWizardRegistration.OnboardedStorageValue);
        }
        catch (Exception)
        {
            // Quota / identity-less write failures are silent by design; the in-instance change is still
            // dispatched so subscribers re-render for this session (web swallows the localStorage write error).
        }

        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Re-raise <see cref="Changed"/> for a sibling instance's onboarding broadcast — the native analogue of the
    /// web <c>subscribe((m) =&gt; m.type === 'onboarded' ? hide : noop)</c> handler. The store re-reads the
    /// (now sibling-written) token, so the wizard collapses without a reload.
    /// </summary>
    public void NotifyExternalCompletion() => Changed?.Invoke(this, EventArgs.Empty);
}

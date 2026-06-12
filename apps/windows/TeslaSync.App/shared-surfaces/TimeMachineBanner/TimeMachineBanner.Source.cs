namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The as-of timestamp seam the <c>TimeMachineBanner</c> binds through (P1/S8) — the native analogue of the web
/// <c>useAsOfDate()</c> hook (web/src/hooks/useAsOfDate.ts) the banner reads <c>asOf</c> / <c>setAsOf</c> /
/// <c>clear</c> from (web/src/components/feedback/TimeMachineBanner.tsx L68). On the web the value is URL-mounted
/// (the canonical <c>?as_of=</c> query parameter) so a deep-linked historical view survives a reload, a share and
/// browser back/forward; the closest native analogue is a single composition-root-owned, window-scoped store
/// shared across surfaces, which is exactly what <see cref="InMemoryAsOfDateSource"/> is. It exposes the current
/// <see cref="AsOf"/> (an RFC 3339 timestamp, or null in live mode), accepts a new anchor through
/// <see cref="SetAsOf"/> and a return-to-live through <see cref="Clear"/>, and raises <see cref="Changed"/> whenever
/// the anchor moves. Like the web hook it never pre-validates the lookback bound (the backend's
/// <c>signal.ParseAsOf</c> owns that) but it does refuse to store a malformed value, so <see cref="AsOf"/> is always
/// either a well-formed RFC 3339 string or null. The view never mutates the anchor directly — it binds this seam.
/// </summary>
public interface IAsOfDateSource
{
    /// <summary>The current as-of timestamp as an RFC 3339 string, or null in live mode (web <c>asOf</c>).</summary>
    string? AsOf { get; }

    /// <summary>
    /// Replace the as-of anchor (web <c>setAsOf</c>): a null or empty value returns to live mode, a malformed value
    /// is refused (left unchanged), and a well-formed RFC 3339 value becomes the new anchor.
    /// </summary>
    /// <param name="iso">The new RFC 3339 anchor, or null/empty to return to live mode.</param>
    void SetAsOf(string? iso);

    /// <summary>Return to live mode (web <c>clear</c> → <c>setAsOf(null)</c>).</summary>
    void Clear();

    /// <summary>Raised whenever <see cref="AsOf"/> moves; may be raised from a background thread.</summary>
    event EventHandler? Changed;
}

/// <summary>
/// The functional as-of store the composition root shares across surfaces — the native analogue of the shared
/// <c>?as_of=</c> URL parameter the web <c>useAsOfDate()</c> reads and writes — and the headless / unit-test
/// default. It reproduces the web hook's write contract verbatim (web/src/hooks/useAsOfDate.ts L61-77): a
/// null/empty write returns to live mode, a malformed write is refused so garbage never reaches the wire, and a
/// well-formed RFC 3339 write becomes the anchor. <see cref="Changed"/> fires only when the anchor actually moves,
/// so an idempotent write is silent. It lets the banner projection and view-model be exercised across the live,
/// historical and picker states without a navigation host. Drive it from one confinement (the UI thread); it is not
/// internally synchronized.
/// </summary>
public sealed class InMemoryAsOfDateSource : IAsOfDateSource
{
    private string? _asOf;

    /// <summary>Creates the store, optionally seeded with an initial anchor (a deep-linked historical view).</summary>
    /// <param name="initialAsOf">The initial RFC 3339 anchor; a null/empty/malformed value starts in live mode.</param>
    public InMemoryAsOfDateSource(string? initialAsOf = null) =>
        _asOf = TimeMachineBannerRegistration.NormalizeAsOf(initialAsOf);

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? AsOf => _asOf;

    /// <inheritdoc />
    public void SetAsOf(string? iso)
    {
        // web setAsOf: null/'' returns to live; a value failing the RFC 3339 sniff is refused (useAsOfDate.ts L62-72).
        if (string.IsNullOrEmpty(iso))
        {
            Apply(null);
            return;
        }

        if (!TimeMachineBannerRegistration.LooksLikeIso(iso))
        {
            return;
        }

        Apply(iso);
    }

    /// <inheritdoc />
    public void Clear() => Apply(null);

    private void Apply(string? next)
    {
        if (string.Equals(_asOf, next, StringComparison.Ordinal))
        {
            return;
        }

        _asOf = next;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

/// <summary>
/// The picker-open trigger seam the <c>TimeMachineBanner</c> binds through (P1/S8) — the native analogue of the web
/// <c>TIME_MACHINE_OPEN_PICKER_EVENT</c> window event the command palette dispatches to reveal AND seed the picker
/// without leaving the current page (web/src/components/feedback/TimeMachineBanner.tsx L36, L74-93). On the web the
/// command-palette "Open time machine" entry fires the window event; the banner listens, seeds the draft (the
/// current anchor, else yesterday at noon) and opens the picker. This seam carries that one cross-surface signal so
/// the command path is bindable and testable: the palette command calls <see cref="RequestOpen"/>, and the bound
/// <see cref="TimeMachineBannerViewModel"/> seeds + opens in response.
/// </summary>
public interface ITimeMachinePickerTrigger
{
    /// <summary>Raised when something (e.g. the command palette) asks to reveal the picker (web window event).</summary>
    event EventHandler? OpenRequested;

    /// <summary>Ask any bound banner to reveal + seed its picker (web <c>dispatchEvent(TIME_MACHINE_OPEN_PICKER_EVENT)</c>).</summary>
    void RequestOpen();
}

/// <summary>
/// An in-process <see cref="ITimeMachinePickerTrigger"/> — the composition root shares one instance between the
/// command palette and the banner (the native analogue of the global window-event bus), and it is also the
/// headless / unit-test default. <see cref="RequestOpen"/> simply raises <see cref="OpenRequested"/>, letting the
/// banner's reveal-and-seed path be exercised without a command-palette host.
/// </summary>
public sealed class TimeMachinePickerTrigger : ITimeMachinePickerTrigger
{
    /// <inheritdoc />
    public event EventHandler? OpenRequested;

    /// <inheritdoc />
    public void RequestOpen() => OpenRequested?.Invoke(this, EventArgs.Empty);
}

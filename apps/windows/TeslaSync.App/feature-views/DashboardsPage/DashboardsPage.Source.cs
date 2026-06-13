namespace TeslaSync.App.FeatureViews.PowerUser;

/// <summary>
/// The persistence seam for the composer's editor draft (P1/S8 state-holder seam) — the native analogue of the
/// web page's <c>localStorage</c> round-trip under <c>ai.dashboardComposer.draft</c>
/// (web/src/features/power-user/pages/DashboardsPage.tsx). The web seeds <c>dashboardJson</c> from
/// <c>loadPersistedJson()</c> and writes it back through <c>persistJson()</c> on every change so a long edit
/// survives a navigation away + back. Routing the seed/save through a seam keeps the view-model free of platform
/// storage types and lets a test drive any starting value headlessly; the WinUI implementation lives in the
/// platform partial.
/// </summary>
public interface IDashboardDraftStore
{
    /// <summary>The persisted draft to seed the editor with (web <c>loadPersistedJson</c>; empty when none).</summary>
    string Load();

    /// <summary>Persist <paramref name="value"/> as the draft, clearing it when empty (web <c>persistJson</c>).</summary>
    /// <param name="value">The current editor value to persist.</param>
    void Save(string value);
}

/// <summary>
/// The clipboard seam for the copy affordance — the native analogue of the web page's
/// <c>navigator.clipboard</c> usage (web/src/features/power-user/pages/DashboardsPage.tsx). The web guards on
/// <c>navigator.clipboard</c> presence (the <c>copyUnavailable</c> branch) and then awaits
/// <c>writeText</c> (the <c>copySuccess</c> / <c>copyFailed</c> branches). Routing the write through a seam keeps
/// the view-model free of platform clipboard types and lets a test exercise each branch headlessly; the WinUI
/// implementation lives in the platform partial.
/// </summary>
public interface IDashboardClipboard
{
    /// <summary>True when clipboard access is available (web <c>typeof navigator !== 'undefined' &amp;&amp; navigator.clipboard</c>).</summary>
    bool IsAvailable { get; }

    /// <summary>Write <paramref name="text"/> to the clipboard, throwing on failure (web <c>navigator.clipboard.writeText</c>).</summary>
    /// <param name="text">The text to place on the clipboard.</param>
    /// <returns>A task that completes when the write succeeds, or faults when it fails.</returns>
    Task WriteTextAsync(string text);
}

/// <summary>
/// An in-memory <see cref="IDashboardDraftStore"/> — the headless default the view-model falls back to and the
/// seam a unit test substitutes to seed a starting draft and observe saves without a packaged settings store.
/// Pure (no platform types) so it links into the plain test host.
/// </summary>
public sealed class InMemoryDashboardDraftStore : IDashboardDraftStore
{
    private string _draft;

    /// <summary>Creates the store over an optional initial draft (empty by default).</summary>
    /// <param name="initial">The draft the editor seeds from.</param>
    public InMemoryDashboardDraftStore(string? initial = null) => _draft = initial ?? string.Empty;

    /// <summary>The number of times <see cref="Save"/> has been called (a test convenience).</summary>
    public int SaveCount { get; private set; }

    /// <inheritdoc />
    public string Load() => _draft;

    /// <inheritdoc />
    public void Save(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        _draft = value;
        SaveCount++;
    }
}

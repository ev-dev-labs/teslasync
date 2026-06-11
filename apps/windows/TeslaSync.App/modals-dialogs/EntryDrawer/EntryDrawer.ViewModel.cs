using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EntryDrawer"/> view — the native port of the
/// web <c>EntryDrawer</c>'s state + derived composition
/// (<c>web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx</c>). The web component is a
/// controlled, presentational drawer: it receives the entry (cached <c>summary</c> + lazily-loaded
/// <c>full</c>), the lifecycle flags (<c>loading</c> / <c>replayEnabled</c> / <c>replayInFlight</c>) and its
/// open state as props, and raises <c>onClose</c> / <c>onReplay</c> callbacks; it performs no fetching. This
/// holder mirrors that exactly: the host sets the inputs (<see cref="SetEntry"/> +
/// <see cref="ReplayEnabled"/> / <see cref="ReplayInFlight"/> / <see cref="IsOpen"/>), the holder projects
/// them through <see cref="EntryDrawerProjection"/> into the render-ready <see cref="State"/>,
/// <see cref="Title"/>, <see cref="Fields"/>, payload text and the replay gate, and the view drives
/// <see cref="RequestClose"/> / <see cref="RequestReplay"/> back to the host. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EntryDrawerViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly EntryDrawerDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private DlqEntrySummary? _summary;
    private DlqEntryFull? _full;
    private bool _loading;
    private bool _replayEnabled;
    private bool _replayInFlight;
    private bool _isOpen;
    private EntryDrawerTab _activeTab = EntryDrawerTab.Inner;

    // Memoized decoded payloads (web `useMemo(() => decode(full?.…), [full])`): recomputed only when `full` changes.
    private string _innerText = string.Empty;
    private string _rawText = string.Empty;

    /// <summary>Creates the holder over its localizer and (optional) diagnostics sink + injectable clock.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    /// <param name="clock">The reference-instant source for absolute timestamp formatting (defaults to <see cref="DateTimeOffset.Now"/>).</param>
    public EntryDrawerViewModel(
        ILocalizer localizer,
        EntryDrawerDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new EntryDrawerDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the drawer should close (web <c>onClose()</c>): the host owns the dismissal.</summary>
    public event EventHandler? CloseRequested;

    /// <summary>Raised when a replay is requested (web <c>onReplay()</c>); only fires while the action is enabled.</summary>
    public event EventHandler? ReplayRequested;

    // ── Inputs (the web props) ────────────────────────────────────────────────────────────────────────────

    /// <summary>Whether the drawer is open (web <c>open</c>).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        set => Set(ref _isOpen, value);
    }

    /// <summary>The cached summary row shown while the full payload loads (web <c>summary</c>).</summary>
    public DlqEntrySummary? Summary => _summary;

    /// <summary>The lazily-loaded full entry, or <see langword="null"/> until it resolves (web <c>full</c>).</summary>
    public DlqEntryFull? Full => _full;

    /// <summary>Whether the full payload is still loading (web <c>loading</c>).</summary>
    public bool Loading => _loading;

    /// <summary>Whether the server permits replays at all (web <c>replayEnabled</c>); gates the replay button.</summary>
    public bool ReplayEnabled
    {
        get => _replayEnabled;
        set
        {
            if (Set(ref _replayEnabled, value))
            {
                Raise(nameof(ReplayDisabled));
            }
        }
    }

    /// <summary>Whether a replay is currently in flight (web <c>replayInFlight</c>); shows the button busy state.</summary>
    public bool ReplayInFlight
    {
        get => _replayInFlight;
        set
        {
            if (Set(ref _replayInFlight, value))
            {
                Raise(nameof(ReplayDisabled));
            }
        }
    }

    /// <summary>The active payload tab (web <c>activeTab</c>; default inner). Drives the active payload + copy text.</summary>
    public EntryDrawerTab ActiveTab
    {
        get => _activeTab;
        set
        {
            if (Set(ref _activeTab, value))
            {
                Raise(nameof(ActivePayloadText));
                Raise(nameof(ActiveCopyText));
            }
        }
    }

    // ── Derived render model ──────────────────────────────────────────────────────────────────────────────

    /// <summary>The head record the body renders (web <c>full ?? summary</c>).</summary>
    public DlqEntrySummary? Head => EntryDrawerProjection.Head(_full, _summary);

    /// <summary>The render branch (loading / content / empty) the body shows.</summary>
    public EntryDrawerState State => EntryDrawerProjection.ResolveState(_loading, _full, Head);

    /// <summary>True when an entry head is present (web <c>head</c> truthy).</summary>
    public bool HasHead => Head is not null;

    /// <summary>The localized drawer title (web <c>title</c> / <c>titleFallback</c>).</summary>
    public string Title => EntryDrawerProjection.Title(Head, _localizer);

    /// <summary>The eight projected summary field rows (empty when there is no head).</summary>
    public IReadOnlyList<EntryDrawerField> Fields =>
        Head is { } head ? EntryDrawerProjection.BuildFields(head, _localizer, _clock()) : Array.Empty<EntryDrawerField>();

    /// <summary>True when the replay action is disabled (web <c>replayDisabled</c>).</summary>
    public bool ReplayDisabled => EntryDrawerProjection.ReplayDisabled(_replayEnabled, Head, _replayInFlight, _loading);

    /// <summary>The inner-tab payload viewer text (decoded body or the binary marker).</summary>
    public string InnerPayloadText => Head is { } head
        ? EntryDrawerProjection.PayloadText(EntryDrawerTab.Inner, head, _innerText, _rawText, _localizer)
        : string.Empty;

    /// <summary>The raw-tab payload viewer text (decoded envelope or the binary marker).</summary>
    public string RawPayloadText => Head is { } head
        ? EntryDrawerProjection.PayloadText(EntryDrawerTab.Raw, head, _innerText, _rawText, _localizer)
        : string.Empty;

    /// <summary>The inner-tab clipboard value (decoded body, else the raw base64 blob).</summary>
    public string InnerCopyText => EntryDrawerProjection.CopyText(EntryDrawerTab.Inner, _full, _innerText, _rawText);

    /// <summary>The raw-tab clipboard value (decoded envelope, else the raw base64 blob).</summary>
    public string RawCopyText => EntryDrawerProjection.CopyText(EntryDrawerTab.Raw, _full, _innerText, _rawText);

    /// <summary>The payload viewer text for the currently active tab.</summary>
    public string ActivePayloadText => _activeTab == EntryDrawerTab.Inner ? InnerPayloadText : RawPayloadText;

    /// <summary>The clipboard value for the currently active tab.</summary>
    public string ActiveCopyText => _activeTab == EntryDrawerTab.Inner ? InnerCopyText : RawCopyText;

    // ── Chrome labels (Narrator-name source) ──────────────────────────────────────────────────────────────

    /// <summary>Accessible region label for the drawer surface.</summary>
    public string RegionLabel => EntryDrawerRegistration.RegionLabel(_localizer);

    /// <summary>Inner-payload tab label.</summary>
    public string TabInnerLabel => EntryDrawerRegistration.TabInner(_localizer);

    /// <summary>Raw-envelope tab label.</summary>
    public string TabRawLabel => EntryDrawerRegistration.TabRaw(_localizer);

    /// <summary>Replay button label.</summary>
    public string ReplayLabel => EntryDrawerRegistration.Replay(_localizer);

    /// <summary>Close button label.</summary>
    public string CloseLabel => EntryDrawerRegistration.Close(_localizer);

    /// <summary>Idle copy-button label.</summary>
    public string CopyLabel => EntryDrawerRegistration.Copy(_localizer);

    /// <summary>Post-copy confirmation label.</summary>
    public string CopiedLabel => EntryDrawerRegistration.Copied(_localizer);

    /// <summary>Friendly empty-state message.</summary>
    public string EmptyMessage => EntryDrawerRegistration.EmptyMessage(_localizer);

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Set the controlled entry inputs together (the web <c>summary</c> / <c>full</c> / <c>loading</c> prop
    /// bundle). Recomputes the memoized decoded payloads when <paramref name="full"/> changes and re-projects
    /// the whole render model.
    /// </summary>
    public void SetEntry(DlqEntrySummary? summary, DlqEntryFull? full, bool loading)
    {
        bool fullChanged = !ReferenceEquals(_full, full);
        _summary = summary;
        _full = full;
        _loading = loading;

        if (fullChanged)
        {
            _innerText = full is null ? string.Empty : EntryDrawerProjection.DecodeBase64Utf8(full.InnerPayloadB64);
            _rawText = full is null ? string.Empty : EntryDrawerProjection.DecodeBase64Utf8(full.RawPayloadB64);
        }

        RaiseRenderModelChanged();
    }

    /// <summary>Switch the active payload tab (web <c>setActiveTab</c>).</summary>
    public void SetActiveTab(EntryDrawerTab tab) => ActiveTab = tab;

    /// <summary>Emit the <c>view.opened</c> diagnostics event for the surface (P1/S11).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Request the drawer be dismissed (web <c>onClose</c>).</summary>
    public void RequestClose() => CloseRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>Request a replay (web <c>onReplay</c>); a no-op while the action is disabled, mirroring the disabled button.</summary>
    public void RequestReplay()
    {
        if (ReplayDisabled)
        {
            return;
        }

        ReplayRequested?.Invoke(this, EventArgs.Empty);
    }

    private void RaiseRenderModelChanged()
    {
        Raise(nameof(Summary));
        Raise(nameof(Full));
        Raise(nameof(Loading));
        Raise(nameof(Head));
        Raise(nameof(State));
        Raise(nameof(HasHead));
        Raise(nameof(Title));
        Raise(nameof(Fields));
        Raise(nameof(ReplayDisabled));
        Raise(nameof(InnerPayloadText));
        Raise(nameof(RawPayloadText));
        Raise(nameof(InnerCopyText));
        Raise(nameof(RawCopyText));
        Raise(nameof(ActivePayloadText));
        Raise(nameof(ActiveCopyText));
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

using System.ComponentModel;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.DlqInspector;
using TeslaSync.App.ModalsDialogs;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>DLQInspectorPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/DLQInspectorPage.tsx). It owns the four web hooks as injected ports
/// (<c>useDLQList</c> → <see cref="IDlqListFeed"/>, <c>useDLQEntry</c> → <see cref="IDlqEntryFeed"/>,
/// <c>useDLQAudit</c> → <see cref="IDlqAuditFeed"/>, <c>useDLQReplay</c> → <see cref="IDlqReplayService"/>) and the
/// drawer state holder (<see cref="EntryDrawerViewModel"/>), and projects them into the render-ready child models the
/// composed surfaces bind to: the <see cref="StatusHeaderModel"/> (status tiles), the <see cref="EntriesTableModel"/>
/// (GlassPanel 1), the <see cref="AuditPanelModel"/> (GlassPanel 2) and the entry drawer. It reproduces the web page
/// state machine exactly — the <c>selected</c> row drives the drawer + the scoped entry fetch, the
/// <c>pendingReplay</c> row drives the confirm dialog, and the replay outcome (or its 403) toggles the
/// <c>replayDisabledBanner</c>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DlqInspectorPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDlqListFeed _listFeed;
    private readonly IDlqEntryFeed _entryFeed;
    private readonly IDlqAuditFeed _auditFeed;
    private readonly IDlqReplayService _replayService;
    private readonly ILocalizer _localizer;
    private readonly EntryDrawerViewModel _drawer;
    private readonly DlqInspectorDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _loadCts;
    private CancellationTokenSource? _entryCts;
    private bool _disposed;

    private DlqInspectorState _state = DlqInspectorState.Loading;
    private DlqListSnapshot? _list;
    private bool _listFetching;
    private bool _listError;
    private DateTimeOffset? _listUpdatedAt;

    private IReadOnlyList<AuditRecord> _audit = Array.Empty<AuditRecord>();
    private bool _auditLoading = true;

    private DlqEntrySummary? _selected;
    private DlqEntrySummary? _pendingReplay;
    private bool _replayInFlight;
    private bool _replayDisabledBanner;

    /// <summary>Creates the holder over its four data ports, localizer and (optional) drawer / clock / diagnostics.</summary>
    /// <param name="listFeed">The DLQ list port (web <c>useDLQList</c>).</param>
    /// <param name="entryFeed">The single-entry port (web <c>useDLQEntry</c>).</param>
    /// <param name="auditFeed">The replay-audit port (web <c>useDLQAudit</c>).</param>
    /// <param name="replayService">The replay command port (web <c>useDLQReplay</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="drawer">The shared entry-drawer state holder; one is created over the localizer when omitted.</param>
    /// <param name="clock">Injectable clock for deterministic freshness timestamps in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public DlqInspectorPageViewModel(
        IDlqListFeed listFeed,
        IDlqEntryFeed entryFeed,
        IDlqAuditFeed auditFeed,
        IDlqReplayService replayService,
        ILocalizer localizer,
        EntryDrawerViewModel? drawer = null,
        Func<DateTimeOffset>? clock = null,
        DlqInspectorDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(listFeed);
        ArgumentNullException.ThrowIfNull(entryFeed);
        ArgumentNullException.ThrowIfNull(auditFeed);
        ArgumentNullException.ThrowIfNull(replayService);
        ArgumentNullException.ThrowIfNull(localizer);

        _listFeed = listFeed;
        _entryFeed = entryFeed;
        _auditFeed = auditFeed;
        _replayService = replayService;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new DlqInspectorDiagnostics();
        _drawer = drawer ?? new EntryDrawerViewModel(localizer);

        _drawer.CloseRequested += OnDrawerCloseRequested;
        _drawer.ReplayRequested += OnDrawerReplayRequested;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the operator asks to replay the open entry (web <c>setPendingReplay</c>): the view shows the confirm dialog.</summary>
    public event EventHandler? ReplayConfirmRequested;

    // ── Page chrome ───────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The localized page title (web <c>admin.dlq.pageTitle</c>).</summary>
    public string Title => DlqInspectorRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>admin.dlq.subtitle</c>).</summary>
    public string Subtitle => DlqInspectorRegistration.Subtitle(_localizer);

    /// <summary>The localized dead-letter-entries panel title (web <c>admin.dlq.panels.entries</c>).</summary>
    public string PanelEntriesTitle => DlqInspectorRegistration.PanelEntries(_localizer);

    /// <summary>The localized replay-activity panel title (web <c>admin.dlq.panels.audit</c>).</summary>
    public string PanelAuditTitle => DlqInspectorRegistration.PanelAudit(_localizer);

    // ── List data state (the web PageContainer query={list} indicator) ────────────────────────────────────────────

    /// <summary>The top-level list data state (loading / error / ready).</summary>
    public DlqInspectorState State => _state;

    /// <summary>True while a list (re)fetch is in flight (web <c>list.isFetching</c>) — drives the freshness chip.</summary>
    public bool IsListFetching => _listFetching;

    /// <summary>True when the list query failed (web <c>list.isError</c>) — drives the freshness chip + the error surface.</summary>
    public bool IsListError => _listError;

    /// <summary>The last successful list-load instant, for the freshness chip (null until the first success).</summary>
    public DateTimeOffset? ListUpdatedAt => _listUpdatedAt;

    /// <summary>Whether the retryable list-error surface is shown (the native InfoBar + Retry).</summary>
    public bool ShowListError => _state == DlqInspectorState.Error;

    /// <summary>The list-error surface message.</summary>
    public string ListErrorText => DlqInspectorRegistration.LoadErrorMessage(_localizer);

    /// <summary>The retry affordance label.</summary>
    public string RetryLabel => DlqInspectorRegistration.RetryLabel(_localizer);

    // ── Composed child models ─────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The status-tiles model (web <c>&lt;StatusHeader data={list.data} loading={list.isLoading} /&gt;</c>).</summary>
    public StatusHeaderModel StatusModel => new(_state == DlqInspectorState.Loading, _list);

    /// <summary>The entries-table model (web <c>&lt;EntriesTable rows={list.data?.entries ?? []} loading={list.isLoading} /&gt;</c>).</summary>
    public EntriesTableModel EntriesModel =>
        new(_list?.Entries ?? Array.Empty<DlqEntrySummary>(), _state == DlqInspectorState.Loading);

    /// <summary>The audit-panel model (web <c>&lt;AuditPanel rows={audit.data?.rows ?? []} loading={audit.isLoading} /&gt;</c>; global feed).</summary>
    public AuditPanelModel AuditModel => new(_audit, _auditLoading, null);

    /// <summary>The shared entry-drawer state holder the view binds the drawer control to.</summary>
    public EntryDrawerViewModel Drawer => _drawer;

    // ── Replay-blocked banner (web replayDisabledBanner) ──────────────────────────────────────────────────────────

    /// <summary>Whether the replay-blocked warning banner is shown (web <c>replayDisabledBanner</c>).</summary>
    public bool ReplayDisabledBannerVisible => _replayDisabledBanner;

    /// <summary>The replay-blocked banner title (web <c>admin.dlq.banners.replayBlockedTitle</c>).</summary>
    public string BannerTitle => DlqInspectorRegistration.BannerBlockedTitle(_localizer);

    /// <summary>The replay-blocked banner message (web <c>admin.dlq.banners.replayBlockedMessage</c>).</summary>
    public string BannerMessage => DlqInspectorRegistration.BannerBlockedMessage(_localizer);

    // ── Replay confirm dialog (web ConfirmDialog) ─────────────────────────────────────────────────────────────────

    /// <summary>The entry awaiting replay confirmation, or null when the dialog is closed (web <c>pendingReplay</c>).</summary>
    public DlqEntrySummary? PendingReplay => _pendingReplay;

    /// <summary>Whether a replay confirmation is pending (web <c>pendingReplay !== null</c>).</summary>
    public bool HasPendingReplay => _pendingReplay is not null;

    /// <summary>Whether a replay is currently in flight (web <c>replay.isPending</c>).</summary>
    public bool ReplayInFlight => _replayInFlight;

    /// <summary>The replay confirm-dialog title (web <c>admin.dlq.confirm.title</c>).</summary>
    public string ConfirmTitle => DlqInspectorRegistration.ConfirmTitle(_localizer);

    /// <summary>The replay confirm-dialog message with the pending entry id interpolated (web <c>admin.dlq.confirm.message</c>).</summary>
    public string ConfirmMessage => DlqInspectorRegistration.ConfirmMessage(_localizer, _pendingReplay?.Id ?? 0);

    /// <summary>The replay confirm-dialog confirm label (web <c>admin.dlq.confirm.confirm</c>).</summary>
    public string ConfirmLabel => DlqInspectorRegistration.ConfirmLabel(_localizer);

    /// <summary>The replay confirm-dialog cancel label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => DlqInspectorRegistration.CancelLabel(_localizer);

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the list + audit loads (web mount + query refetch / Retry).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _loadCts, cancellationToken);

        _listFetching = true;
        if (_list is null)
        {
            _state = DlqInspectorState.Loading;
        }

        _auditLoading = true;
        RaiseChanged();

        await Task.WhenAll(
            LoadListAsync(cts.Token),
            LoadAuditAsync(cts.Token)).ConfigureAwait(false);
    }

    /// <summary>Refresh the list + audit feeds (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Open an entry's drawer and lazily load its full payload (web <c>handleInspect</c> + <c>useDLQEntry</c>).</summary>
    public void Inspect(DlqEntrySummary row)
    {
        ArgumentNullException.ThrowIfNull(row);

        _selected = row;
        _drawer.ReplayEnabled = _list?.ReplayEnabled ?? false;
        _drawer.ReplayInFlight = _replayInFlight;
        _drawer.SetEntry(row, null, loading: true);
        _drawer.IsOpen = true;
        RaiseChanged();

        _ = LoadEntryAsync(row.Id);
    }

    /// <summary>Close the entry drawer (web <c>onClose</c> / <c>setSelected(null)</c>).</summary>
    public void CloseEntry()
    {
        _selected = null;
        _drawer.IsOpen = false;
        _drawer.SetEntry(null, null, loading: false);
        RaiseChanged();
    }

    /// <summary>Cancel the pending replay confirmation (web <c>onCancel</c> / <c>setPendingReplay(null)</c>).</summary>
    public void CancelReplay()
    {
        if (_pendingReplay is null)
        {
            return;
        }

        _pendingReplay = null;
        RaiseChanged();
    }

    /// <summary>Dismiss the replay-blocked banner (web <c>onClose</c>).</summary>
    public void DismissReplayBanner()
    {
        if (!_replayDisabledBanner)
        {
            return;
        }

        _replayDisabledBanner = false;
        RaiseChanged();
    }

    /// <summary>
    /// Confirm and run the replay (web <c>handleConfirmReplay</c>): publishes the pending entry, then branches on the
    /// outcome — <c>result === 'ok'</c> closes the drawer, <c>result === 'disabled'</c> (or an HTTP 403) raises the
    /// replay-blocked banner — and refreshes the list + audit feeds (web mutation <c>invalidateQueries</c>).
    /// </summary>
    public async Task ConfirmReplayAsync(CancellationToken cancellationToken = default)
    {
        if (_pendingReplay is not { } pending)
        {
            return;
        }

        _replayInFlight = true;
        _drawer.ReplayInFlight = true;
        RaiseChanged();

        try
        {
            DlqReplayOutcome outcome = await _replayService.ReplayAsync(pending.Id, cancellationToken).ConfigureAwait(false);

            _replayDisabledBanner = outcome.Result == DlqReplayResultCode.Disabled;
            _pendingReplay = null;

            if (outcome.Result == DlqReplayResultCode.Ok)
            {
                _selected = null;
                _drawer.IsOpen = false;
                _drawer.SetEntry(null, null, loading: false);
            }

            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (ApiException ex) when (ex.StatusCode == 403)
        {
            // Hard DLQ_REPLAY_ENABLED=false gate (web error.status === 403) — surface the banner, not a toast.
            _replayDisabledBanner = true;
            _pendingReplay = null;
        }
        catch (OperationCanceledException)
        {
            // Superseded / disposed — drop silently.
        }
        catch (ApiException)
        {
            // Every other failure is surfaced by the web mutation toast; clear the pending confirm and keep the drawer.
            _pendingReplay = null;
        }
        finally
        {
            _replayInFlight = false;
            _drawer.ReplayInFlight = false;
            RaiseChanged();
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _drawer.CloseRequested -= OnDrawerCloseRequested;
        _drawer.ReplayRequested -= OnDrawerReplayRequested;
        Cancel(ref _loadCts);
        Cancel(ref _entryCts);
    }

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────────────────

    private async Task LoadListAsync(CancellationToken cancellationToken)
    {
        try
        {
            DlqListSnapshot snapshot = await _listFeed.FetchAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();

            _list = snapshot;
            _listError = false;
            _listUpdatedAt = _clock();
            _state = DlqInspectorState.Ready;
            // Keep the open drawer's replay gate in sync with the freshest server flag.
            _drawer.ReplayEnabled = snapshot.ReplayEnabled;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _listError = true;
            _state = _list is null ? DlqInspectorState.Error : DlqInspectorState.Ready;
        }
        finally
        {
            _listFetching = false;
            RaiseChanged();
        }
    }

    private async Task LoadAuditAsync(CancellationToken cancellationToken)
    {
        try
        {
            IReadOnlyList<AuditRecord> rows = await _auditFeed
                .FetchAsync(null, DlqInspectorRegistration.AuditLimit, cancellationToken)
                .ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();

            _audit = rows;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // The audit panel is a secondary surface — on failure leave the rows as-is and stop the spinner.
        }
        finally
        {
            _auditLoading = false;
            RaiseChanged();
        }
    }

    private async Task LoadEntryAsync(long id)
    {
        var cts = Supersede(ref _entryCts, CancellationToken.None);
        try
        {
            DlqEntryFull full = await _entryFeed.FetchAsync(id, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            if (_selected?.Id == id)
            {
                _drawer.SetEntry(_selected, full, loading: false);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer inspect (or disposed).
        }
        catch (Exception)
        {
            // Entry fetch failed — stop the spinner and fall back to the cached summary head (web full ?? summary).
            if (_selected?.Id == id)
            {
                _drawer.SetEntry(_selected, null, loading: false);
            }
        }
    }

    private void OnDrawerCloseRequested(object? sender, EventArgs e) => CloseEntry();

    private void OnDrawerReplayRequested(object? sender, EventArgs e)
    {
        if (_selected is null)
        {
            return;
        }

        _pendingReplay = _selected;
        RaiseChanged();
        ReplayConfirmRequested?.Invoke(this, EventArgs.Empty);
    }

    private void RaiseChanged() => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(string.Empty));

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }
}

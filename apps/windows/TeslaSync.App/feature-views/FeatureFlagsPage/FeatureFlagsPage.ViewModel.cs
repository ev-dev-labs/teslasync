using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.FeatureFlags;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>FeatureFlagsPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/FeatureFlagsPage.tsx). It owns the two read queries the web page mounts
/// (<c>useFlags</c> → the registry, <c>useFlagChanges(null, 50)</c> → the audit feed) behind injected feeds, and the
/// two sudo-gated mutations (<c>useSetFlag</c> / <c>useDeleteFlag</c>) behind an injected write service, projecting
/// each read into the render-ready <see cref="FlagsTableModel"/> / <see cref="ChangesPanelModel"/> the shared
/// surfaces bind to. It surfaces the three web data states (loading / empty / success) — empty and success live
/// inside the child models, loading + the (chip-only) error live at the page tier — plus the in-flight flag that
/// drives the freshness chip. A save / delete re-runs both reads (the web invalidates the <c>['system','flags']</c>
/// query family). Observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FeatureFlagsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFeatureFlagsFeed _flagsFeed;
    private readonly IFlagChangesFeed _changesFeed;
    private readonly IFlagWriteService _writeService;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly FeatureFlagsPageDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<FeatureFlagEntry> _flags = Array.Empty<FeatureFlagEntry>();
    private bool _flagsLoading = true;
    private bool _flagsError;
    private DateTimeOffset? _flagsUpdatedAt;

    private IReadOnlyList<FeatureFlagChangeRow> _changes = Array.Empty<FeatureFlagChangeRow>();
    private bool _changesLoading = true;

    private bool _isFetching;

    /// <summary>Creates the holder over its read feeds, write service, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="flagsFeed">The flag-registry data port (web <c>useFlags</c>).</param>
    /// <param name="changesFeed">The flag-change-audit data port (web <c>useFlagChanges</c>).</param>
    /// <param name="writeService">The set / delete write port (web <c>useSetFlag</c> / <c>useDeleteFlag</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic freshness timestamps in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FeatureFlagsPageViewModel(
        IFeatureFlagsFeed flagsFeed,
        IFlagChangesFeed changesFeed,
        IFlagWriteService writeService,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        FeatureFlagsPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(flagsFeed);
        ArgumentNullException.ThrowIfNull(changesFeed);
        ArgumentNullException.ThrowIfNull(writeService);
        ArgumentNullException.ThrowIfNull(localizer);

        _flagsFeed = flagsFeed;
        _changesFeed = changesFeed;
        _writeService = writeService;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new FeatureFlagsPageDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state for the registry query (loading / error / ready).</summary>
    public FeatureFlagsState State =>
        _flagsError ? FeatureFlagsState.Error : _flagsLoading ? FeatureFlagsState.Loading : FeatureFlagsState.Ready;

    /// <summary>The render model for the registry table (web <c>rows={flags.data?.flags ?? []} loading={flags.isLoading}</c>).</summary>
    public FlagsTableModel FlagsModel => new(_flags, _flagsLoading);

    /// <summary>The render model for the audit panel (web <c>rows={changes.data?.rows ?? []} loading={changes.isLoading}</c>, global scope).</summary>
    public ChangesPanelModel ChangesModel => new(_changes, _changesLoading, null);

    /// <summary>True while either read query is (re)fetching — drives the freshness chip "Updating…".</summary>
    public bool IsFetching => _isFetching;

    /// <summary>True when the registry query failed — drives the freshness chip "Error" (web <c>flags.isError</c>).</summary>
    public bool IsFlagsError => _flagsError;

    /// <summary>The instant the registry last resolved — drives the freshness chip "Live" / relative age.</summary>
    public DateTimeOffset? FlagsUpdatedAt => _flagsUpdatedAt;

    /// <summary>The localized page title (web <c>admin.flags.pageTitle</c>).</summary>
    public string Title => FeatureFlagsRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>admin.flags.subtitle</c>).</summary>
    public string Subtitle => FeatureFlagsRegistration.Subtitle(_localizer);

    /// <summary>The localized header "Add flag" CTA label (web <c>admin.flags.actions.add</c>).</summary>
    public string AddLabel => FeatureFlagsRegistration.AddLabel(_localizer);

    /// <summary>The localized registry panel title (web <c>admin.flags.panels.registry</c>).</summary>
    public string PanelRegistryTitle => FeatureFlagsRegistration.PanelRegistry(_localizer);

    /// <summary>The localized recent-changes panel title (web <c>admin.flags.panels.changes</c>).</summary>
    public string PanelChangesTitle => FeatureFlagsRegistration.PanelChanges(_localizer);

    /// <summary>The localized delete-dialog title (web <c>admin.flags.delete.title</c>).</summary>
    public string DeleteTitle => FeatureFlagsRegistration.DeleteTitle(_localizer);

    /// <summary>The localized delete-dialog reason field label (web <c>admin.flags.delete.reasonLabel</c>).</summary>
    public string DeleteReasonLabel => FeatureFlagsRegistration.DeleteReasonLabel(_localizer);

    /// <summary>The localized delete-dialog reason field input hint, shown when the field is empty.</summary>
    public string DeleteReasonPrompt => FeatureFlagsRegistration.DeleteReasonPrompt(_localizer);

    /// <summary>The localized delete-dialog confirm button label (web <c>admin.flags.delete.confirm</c>).</summary>
    public string DeleteConfirmLabel => FeatureFlagsRegistration.DeleteConfirmLabel(_localizer);

    /// <summary>The localized shared cancel label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => FeatureFlagsRegistration.CancelLabel(_localizer);

    /// <summary>The localized delete-dialog message with the flag <paramref name="key"/> interpolated (web <c>admin.flags.delete.message</c>).</summary>
    public string DeleteMessage(string key) => FeatureFlagsRegistration.DeleteMessage(_localizer, key);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) both read queries — the registry and the change-audit feed (web mount + refetch).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        _isFetching = true;
        if (_flags.Count == 0)
        {
            _flagsLoading = true;
        }

        if (_changes.Count == 0)
        {
            _changesLoading = true;
        }

        RaiseState();

        await Task.WhenAll(
            LoadFlagsAsync(cts.Token),
            LoadChangesAsync(cts.Token)).ConfigureAwait(false);

        if (cts.Token.IsCancellationRequested)
        {
            // Superseded by a newer load (or disposed) — the newer load owns the final state.
            return;
        }

        _isFetching = false;
        RaiseState();
    }

    /// <summary>Refresh both read queries (web auto-refetch / post-mutation invalidation).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Save a flag — the native analogue of the web <c>handleSave</c> → <c>useSetFlag</c>. Posts the create/update and,
    /// on success, re-runs both reads (the web invalidates the <c>['system','flags']</c> query family so the table +
    /// audit re-render). Returns false on failure so the host keeps the editor open for a retry (web parity).
    /// </summary>
    public async Task<bool> SaveFlagAsync(string key, JsonElement value, string reason, CancellationToken cancellationToken = default)
    {
        try
        {
            await _writeService.SetAsync(key, value, reason, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (Exception)
        {
            // web onError: the mutation toast + sudo handling is routed elsewhere; keep the drawer open for retry.
            return false;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <summary>
    /// Delete a flag — the native analogue of the web <c>handleConfirmDelete</c> → <c>useDeleteFlag</c>. Sends the
    /// delete with its audit reason and, on success, re-runs both reads. Returns false on failure so the host keeps
    /// the confirm dialog open for a retry (web parity).
    /// </summary>
    public async Task<bool> DeleteFlagAsync(string key, string reason, CancellationToken cancellationToken = default)
    {
        try
        {
            await _writeService.DeleteAsync(key, reason, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (Exception)
        {
            return false;
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private async Task LoadFlagsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = await _flagsFeed.FetchAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _flags = snapshot.Flags ?? Array.Empty<FeatureFlagEntry>();
            _flagsError = false;
            _flagsLoading = false;
            _flagsUpdatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded — drop silently; the newer load owns the state.
        }
        catch (Exception)
        {
            // web flags.isError: surface the chip-only error; the table falls back to its empty branch.
            _flagsError = true;
            _flagsLoading = false;
            _flags = Array.Empty<FeatureFlagEntry>();
        }
    }

    private async Task LoadChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = await _changesFeed.FetchAsync(FeatureFlagsRegistration.ChangesLimit, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _changes = snapshot.Rows ?? Array.Empty<FeatureFlagChangeRow>();
            _changesLoading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded — drop silently.
        }
        catch (Exception)
        {
            // web changes.isError: the audit panel falls back to its empty branch (no separate page error region).
            _changesLoading = false;
            _changes = Array.Empty<FeatureFlagChangeRow>();
        }
    }

    private void RaiseState()
    {
        Raise(nameof(State));
        Raise(nameof(FlagsModel));
        Raise(nameof(ChangesModel));
        Raise(nameof(IsFetching));
        Raise(nameof(IsFlagsError));
        Raise(nameof(FlagsUpdatedAt));
    }

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

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

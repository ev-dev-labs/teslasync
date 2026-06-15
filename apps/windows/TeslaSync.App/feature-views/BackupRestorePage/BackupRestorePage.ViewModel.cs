using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>BackupRestorePage</c> view — the native port of the web
/// page's data + CRUD flow (web/src/features/admin/pages/BackupRestorePage.tsx). It owns the config + run lists,
/// the four data states (loading / empty / error / success) and the in-flight flag, reads both lists through the
/// injected <see cref="IBackupFeed"/> (web <c>useQuery(['backup-configs'])</c> / <c>useQuery(['backup-runs'])</c>),
/// writes the create / update / delete / trigger / quick-backup / verify mutations back through the same port
/// (web <c>createMutation</c> / <c>updateMutation</c> / <c>deleteMutation</c> / <c>triggerMutation</c> /
/// <c>quickBackupMutation</c> / <c>verifyMutation</c>), and projects the result through
/// <see cref="BackupRestoreProjection"/> so the view is a thin renderer. A monotonic <see cref="ToastSequence"/>
/// surfaces the web <c>toast.*</c> notifications. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BackupRestorePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBackupFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly BackupRestoreDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<BackupConfig> _configs = Array.Empty<BackupConfig>();
    private IReadOnlyList<BackupRun> _runs = Array.Empty<BackupRun>();
    private bool _loadingConfigs = true;
    private bool _loadingRuns = true;
    private bool _hasError;
    private string? _errorDetail;

    private BackupRestoreState _state = BackupRestoreState.Loading;
    private BackupRestoreDisplay _display;
    private bool _isFetching;

    private string _toastMessage = string.Empty;
    private bool _toastIsError;
    private int _toastSequence;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The configs / runs list + mutation data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative times in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public BackupRestorePageViewModel(
        IBackupFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        BackupRestoreDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new BackupRestoreDiagnostics();
        _display = BackupRestoreProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public BackupRestoreState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public BackupRestoreDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or mutation is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>backup.title</c>).</summary>
    public string Title => BackupRestoreRegistration.Title(_localizer);

    /// <summary>The latest toast message (web <c>toast.*</c>); read together with <see cref="ToastSequence"/>.</summary>
    public string ToastMessage => _toastMessage;

    /// <summary>True when the latest toast is an error (web <c>toast.error</c>).</summary>
    public bool ToastIsError => _toastIsError;

    /// <summary>Monotonic counter bumped on every toast so the view can re-show an identical message.</summary>
    public int ToastSequence => _toastSequence;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Look up a loaded config by id (used to seed the edit form). Null when absent.</summary>
    public BackupConfig? FindConfig(long id) => _configs.FirstOrDefault(c => c.Id == id);

    /// <summary>The absolute download URL for a completed run (web <c>handleDownload</c>), or null when unconfigured.</summary>
    public Uri? GetDownloadUri(long id) => _feed.GetDownloadUri(id);

    /// <summary>Run (or re-run) both list loads (web <c>backup-configs</c> + <c>backup-runs</c> queries).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_configs.Count == 0 && _runs.Count == 0)
        {
            _loadingConfigs = true;
            _loadingRuns = true;
            Reproject();
        }

        try
        {
            var configs = await _feed.FetchConfigsAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _configs = configs ?? Array.Empty<BackupConfig>();
            _hasError = false;
            _errorDetail = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            // web: PageContainer error surface — configsError replaces the page content.
            _hasError = true;
            _errorDetail = ex.Message;
            _configs = Array.Empty<BackupConfig>();
        }
        finally
        {
            _loadingConfigs = false;
        }

        await LoadRunsAsync(cts.Token).ConfigureAwait(false);

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh both lists (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Refresh only the run history (web <c>Refresh</c> button → invalidate <c>backup-runs</c>).</summary>
    public async Task RefreshRunsAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        IsFetching = true;
        await LoadRunsAsync(cts.Token).ConfigureAwait(false);
        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Create a config from the form (web <c>createMutation</c>); returns true on success.</summary>
    public Task<bool> CreateConfigAsync(BackupConfigWrite write, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(write);
        return RunWriteAsync(
            t => _feed.CreateConfigAsync(write, t),
            successKey: "backup.configCreated",
            successFallback: "Config created",
            errorKey: "backup.configCreateFailed",
            errorFallback: "Failed to create config",
            cancellationToken);
    }

    /// <summary>Update a config from the form (web <c>updateMutation</c>); returns true on success.</summary>
    public Task<bool> UpdateConfigAsync(long id, BackupConfigWrite write, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(write);
        return RunWriteAsync(
            t => _feed.UpdateConfigAsync(id, write, t),
            successKey: "backup.configUpdated",
            successFallback: "Config updated",
            errorKey: "backup.configUpdateFailed",
            errorFallback: "Failed to update config",
            cancellationToken);
    }

    /// <summary>Delete a config (web <c>deleteMutation</c>); returns true on success.</summary>
    public Task<bool> DeleteConfigAsync(long id, CancellationToken cancellationToken = default) =>
        RunWriteAsync(
            t => _feed.DeleteConfigAsync(id, t),
            successKey: "backup.configDeleted",
            successFallback: "Config deleted",
            errorKey: "backup.configDeleteFailed",
            errorFallback: "Failed to delete config",
            cancellationToken);

    /// <summary>Trigger a config's backup (web <c>triggerMutation</c>); returns true on success.</summary>
    public Task<bool> TriggerConfigAsync(long id, CancellationToken cancellationToken = default) =>
        RunWriteAsync(
            t => _feed.TriggerConfigAsync(id, t),
            successKey: "backup.triggered",
            successFallback: "Backup triggered",
            errorKey: "backup.triggerFailed",
            errorFallback: "Failed to trigger backup",
            cancellationToken);

    /// <summary>Run a quick backup (web <c>quickBackupMutation</c>); returns true on success.</summary>
    public Task<bool> QuickBackupAsync(CancellationToken cancellationToken = default) =>
        RunWriteAsync(
            t => _feed.QuickBackupAsync(t),
            successKey: "backup.quickStarted",
            successFallback: "Quick backup started",
            errorKey: "backup.quickFailed",
            errorFallback: "Quick backup failed",
            cancellationToken);

    /// <summary>
    /// Verify a run's checksum (web <c>verifyMutation</c>): a verified result toasts <c>checksumVerified</c>,
    /// a mismatch toasts <c>checksumMismatch</c> (warning), and a fault toasts <c>verifyFailed</c>.
    /// </summary>
    public async Task VerifyRunAsync(long id, CancellationToken cancellationToken = default)
    {
        IsFetching = true;
        try
        {
            bool verified = await _feed.VerifyRunAsync(id, cancellationToken).ConfigureAwait(false);
            if (verified)
            {
                PushToast(_localizer.GetString("backup.checksumVerified", "Checksum verified"), isError: false);
            }
            else
            {
                PushToast(_localizer.GetString("backup.checksumMismatch", "Checksum mismatch"), isError: true);
            }
        }
        catch (OperationCanceledException)
        {
            // Drop silently.
        }
        catch (Exception)
        {
            PushToast(_localizer.GetString("backup.verifyFailed", "Verification failed"), isError: true);
        }
        finally
        {
            IsFetching = false;
        }
    }

    /// <summary>
    /// Load a restore preview for a run (web <c>handlePreview</c>): returns the parsed preview, or null after
    /// toasting <c>previewFailed</c> on a fault.
    /// </summary>
    public async Task<RestorePreview?> PreviewRunAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _feed.PreviewRunAsync(id, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        catch (Exception)
        {
            PushToast(_localizer.GetString("backup.previewFailed", "Failed to load preview"), isError: true);
            return null;
        }
    }

    /// <summary>Surface a transient toast (web <c>toast.success</c> / <c>toast.error</c>) from a view-level flow.</summary>
    public void PushToast(string message, bool isError)
    {
        _toastMessage = message ?? string.Empty;
        _toastIsError = isError;
        _toastSequence++;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ToastSequence)));
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

    private async Task LoadRunsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var runs = await _feed.FetchRunsAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _runs = runs ?? Array.Empty<BackupRun>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: the runs query is independent — its failure shows the alert/empty state without replacing the page.
            _runs = Array.Empty<BackupRun>();
        }
        finally
        {
            _loadingRuns = false;
        }
    }

    private async Task<bool> RunWriteAsync(
        Func<CancellationToken, Task> mutation,
        string successKey,
        string successFallback,
        string errorKey,
        string errorFallback,
        CancellationToken cancellationToken)
    {
        IsFetching = true;
        try
        {
            await mutation(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return false;
        }
        catch (Exception)
        {
            PushToast(_localizer.GetString(errorKey, errorFallback), isError: true);
            IsFetching = false;
            Reproject();
            return false;
        }

        PushToast(_localizer.GetString(successKey, successFallback), isError: false);
        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    private BackupRestoreModel BuildModel() => new(
        Configs: _configs,
        Runs: _runs,
        LoadingConfigs: _loadingConfigs,
        LoadingRuns: _loadingRuns,
        HasError: _hasError,
        ErrorDetail: _errorDetail);

    private void Reproject()
    {
        var display = BackupRestoreProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
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

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

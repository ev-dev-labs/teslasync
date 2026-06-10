using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PrivacySection"/> view — the native port of the
/// web <c>PrivacySection</c>'s hook composition
/// (web/src/features/settings/components/PrivacySection.tsx). It composes three concerns the web component
/// wires through hooks and client stores:
/// <list type="bullet">
///   <item>the recent-pages counter + clear flow (web <c>getRecentPages</c> / <c>subscribeRecentPages</c> /
///   <c>clearRecentPages</c> behind a silence-aware <c>ConfirmDialog</c>);</item>
///   <item>the cookie-consent decision + grant / withdraw / reset actions (web <c>getConsent</c> /
///   <c>setConsent</c> / <c>clearConsent</c> / <c>subscribeConsent</c>);</item>
///   <item>the deployment-wide consent-requirement read that selects the consent body copy (web
///   <c>useVersionInfo</c> → <c>require_cookie_consent</c>).</item>
/// </list>
/// The two client stores are synchronous, so the recent-pages and consent panels are always rendered (web
/// parity: no loading / error gate); only the requirement read carries the cache-then-network freshness
/// states, and even then the panel is never hidden — a missing / failed read coalesces to "consent not
/// required" exactly as the web <c>Boolean(undefined)</c> does. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class PrivacySectionViewModel : INotifyPropertyChanged, IDisposable
{
    /// <summary>The store cap the count is read against (web <c>RECENT_PAGES_MAX</c>).</summary>
    public const int RecentPagesMaxCount = 50;

    private readonly RecentlyViewedSource _recentPages;
    private readonly IConsentSource _consent;
    private readonly IConfirmSilenceStore _silence;
    private readonly IConsentRequirementSource _requirement;
    private readonly ILocalizer _localizer;
    private readonly PrivacySectionDiagnostics _diagnostics;

    private CancellationTokenSource? _requirementCts;
    private bool _disposed;
    private bool _hasRequirementValue;

    private int _recentCount;
    private PrivacyConsentState _consentState;
    private bool _isClearConfirmOpen;
    private string? _statusMessage;

    private PrivacyRequirementState _requirementState = PrivacyRequirementState.Loading;
    private bool _requireConsent;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private DateTimeOffset? _updatedAt;
    private int _attempts;

    /// <summary>Creates the holder over its three stores, the requirement source, localizer and diagnostics.</summary>
    /// <param name="recentPages">The shared recent-pages store (count + clear + change signal).</param>
    /// <param name="consent">The cookie-consent decision store.</param>
    /// <param name="silence">The "don't ask again" allowlist backing the clear confirmation.</param>
    /// <param name="requirement">The cache-then-network <c>require_cookie_consent</c> read.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink.</param>
    public PrivacySectionViewModel(
        RecentlyViewedSource recentPages,
        IConsentSource consent,
        IConfirmSilenceStore silence,
        IConsentRequirementSource requirement,
        ILocalizer localizer,
        PrivacySectionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(recentPages);
        ArgumentNullException.ThrowIfNull(consent);
        ArgumentNullException.ThrowIfNull(silence);
        ArgumentNullException.ThrowIfNull(requirement);
        ArgumentNullException.ThrowIfNull(localizer);

        _recentPages = recentPages;
        _consent = consent;
        _silence = silence;
        _requirement = requirement;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new PrivacySectionDiagnostics();

        _recentCount = CountRecent();
        _consentState = _consent.Current;

        _recentPages.Changed += OnRecentPagesChanged;
        _consent.Changed += OnConsentChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── Header (web privacy.title / privacy.subtitle) ────────────────────────────────────────────────────

    /// <summary>Panel heading (web <c>privacy.title</c>).</summary>
    public string Title => PrivacySectionRegistration.Title(_localizer);

    /// <summary>Panel subtitle (web <c>privacy.subtitle</c>).</summary>
    public string Subtitle => PrivacySectionRegistration.Subtitle(_localizer);

    // ── Recent pages panel ───────────────────────────────────────────────────────────────────────────────

    /// <summary>The number of stored recent pages (web <c>getRecentPages().length</c>).</summary>
    public int RecentCount => _recentCount;

    /// <summary>The localized stored-entries counter (web <c>recentPages.storedCount</c>).</summary>
    public string RecentCountLabel => PrivacySectionProjection.RecentCountLabel(_recentCount, _localizer);

    /// <summary>True when the clear action is offered (web <c>disabled={count === 0}</c> inverted).</summary>
    public bool CanClearRecentPages => _recentCount > 0;

    /// <summary>Recent-pages panel title (web <c>recentPages.clearTitle</c>).</summary>
    public string RecentClearTitle => PrivacySectionRegistration.RecentClearTitle(_localizer);

    /// <summary>Recent-pages panel body (web <c>recentPages.clearBody</c>).</summary>
    public string RecentClearBody => PrivacySectionRegistration.RecentClearBody(_localizer);

    /// <summary>Clear-button label (web <c>recentPages.clearButton</c>).</summary>
    public string RecentClearButton => PrivacySectionRegistration.RecentClearButton(_localizer);

    // ── Clear confirmation dialog (web ConfirmDialog + silenceKey) ───────────────────────────────────────

    /// <summary>True while the destructive clear confirmation should be open (web <c>confirmOpen</c>).</summary>
    public bool IsClearConfirmOpen => _isClearConfirmOpen;

    /// <summary>Clear-confirmation dialog title (web <c>recentPages.clearConfirmTitle</c>).</summary>
    public string ClearConfirmTitle => PrivacySectionRegistration.ClearConfirmTitle(_localizer);

    /// <summary>Clear-confirmation dialog message (web <c>recentPages.clearConfirmBody</c>).</summary>
    public string ClearConfirmBody => PrivacySectionRegistration.ClearConfirmBody(_localizer);

    /// <summary>Clear-confirmation primary-button label (web <c>recentPages.clearConfirmCta</c>).</summary>
    public string ClearConfirmCta => PrivacySectionRegistration.ClearConfirmCta(_localizer);

    /// <summary>Shared cancel-button label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => PrivacySectionRegistration.CancelLabel(_localizer);

    /// <summary>"Don't ask again" silence checkbox label (web <c>confirm.silence.checkbox</c>).</summary>
    public string SilenceCheckboxLabel => PrivacySectionRegistration.SilenceCheckbox(_localizer);

    // ── Consent panel ────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current consent decision (web <c>consent</c> state).</summary>
    public PrivacyConsentState ConsentState => _consentState;

    /// <summary>Consent panel title (web <c>consent.section.title</c>).</summary>
    public string ConsentSectionTitle => PrivacySectionRegistration.ConsentSectionTitle(_localizer);

    /// <summary>The consent-section body copy (web <c>requireConsent ? bodyOn : bodyOff</c>).</summary>
    public string ConsentBody => PrivacySectionProjection.ConsentBody(_requireConsent, _localizer);

    /// <summary>The one-line consent-decision summary (web <c>consentLabel</c>).</summary>
    public string ConsentStateLabel => PrivacySectionProjection.ConsentStateLabel(_consentState, _localizer);

    /// <summary>Grant/accept button label (web <c>consent.action.accept</c>).</summary>
    public string ConsentAcceptLabel => PrivacySectionRegistration.ConsentActionAccept(_localizer);

    /// <summary>Decline/withdraw button label (web <c>consent.action.decline</c>).</summary>
    public string ConsentDeclineLabel => PrivacySectionRegistration.ConsentActionDecline(_localizer);

    /// <summary>Reset button label (web <c>consent.action.reset</c>).</summary>
    public string ConsentResetLabel => PrivacySectionRegistration.ConsentActionReset(_localizer);

    /// <summary>True when the grant action is offered (web <c>disabled={consent === 'accepted'}</c> inverted).</summary>
    public bool CanAcceptConsent => _consentState != PrivacyConsentState.Accepted;

    /// <summary>True when the withdraw action is offered (web <c>disabled={consent === 'declined'}</c> inverted).</summary>
    public bool CanDeclineConsent => _consentState != PrivacyConsentState.Declined;

    /// <summary>True when the reset action is offered (web <c>disabled={consent === 'unknown'}</c> inverted).</summary>
    public bool CanResetConsent => _consentState != PrivacyConsentState.Unknown;

    // ── Consent-requirement read (web useVersionInfo) ────────────────────────────────────────────────────

    /// <summary>The cache-then-network state of the requirement read (drives the freshness chip + retry).</summary>
    public PrivacyRequirementState RequirementState => _requirementState;

    /// <summary>Whether this deployment requires consent (web <c>require_cookie_consent</c>; default false).</summary>
    public bool RequireConsent => _requireConsent;

    /// <summary>True while a requirement (re)fetch is in flight (drives the freshness chip).</summary>
    public bool IsFetching => _isFetching;

    /// <summary>True when the shown requirement could not be refreshed (offline / hard error).</summary>
    public bool IsError => _isError;

    /// <summary>True when the shown requirement is older than the freshness window.</summary>
    public bool IsStale => _isStale;

    /// <summary>Last successful requirement-fetch timestamp (drives the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt => _updatedAt;

    /// <summary>Requirement-read attempts so far (including retries).</summary>
    public int Attempts => _attempts;

    /// <summary>The inline error message for a hard requirement failure, or null otherwise (native chrome).</summary>
    public string? RequirementErrorMessage =>
        _requirementState == PrivacyRequirementState.Error
            ? PrivacySectionRegistration.RequirementErrorLabel(_localizer)
            : null;

    /// <summary>Retry affordance label for the requirement error (native chrome).</summary>
    public string RetryLabel => PrivacySectionRegistration.RetryLabel(_localizer);

    // ── Status line (web useToast success) ───────────────────────────────────────────────────────────────

    /// <summary>
    /// The most recent action's success message, or null before any action — the native analogue of the web
    /// <c>toast.success(...)</c> calls, surfaced as an announced inline status line (this codebase has no
    /// floating toast; the sibling UserImpersonateButton surface uses the same inline-announce mapping).
    /// </summary>
    public string? StatusMessage => _statusMessage;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network consent-requirement read (web initial query).</summary>
    public Task LoadAsync(CancellationToken cancellationToken = default) =>
        StreamRequirementAsync(cancellationToken);

    /// <summary>Retry the requirement read after a failure (web <c>refetch()</c>).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) =>
        StreamRequirementAsync(cancellationToken);

    /// <summary>
    /// Begin the clear-recent-pages flow (web <c>onClick={() =&gt; setConfirmOpen(true)}</c>). No-ops when the
    /// list is already empty. When the user previously silenced this action the confirmation is short-circuited
    /// and the clear runs immediately (web parity: a silenced <c>ConfirmDialog</c> auto-confirms).
    /// </summary>
    public void BeginClearRecentPages()
    {
        if (!CanClearRecentPages)
        {
            return;
        }

        if (_silence.IsSilenced(PrivacySectionRegistration.ClearSilenceKey))
        {
            PerformClear();
            return;
        }

        SetClearConfirmOpen(true);
    }

    /// <summary>
    /// Confirm the clear (web <c>handleConfirm</c>): persist the silence opt-in when
    /// <paramref name="dontAskAgain"/> is set, close the dialog, wipe the recent-pages list and announce the
    /// success line.
    /// </summary>
    public void ConfirmClearRecentPages(bool dontAskAgain = false)
    {
        if (dontAskAgain)
        {
            _silence.Silence(PrivacySectionRegistration.ClearSilenceKey);
        }

        SetClearConfirmOpen(false);
        PerformClear();
    }

    /// <summary>Dismiss the clear confirmation without clearing (web <c>onCancel</c>).</summary>
    public void CancelClearRecentPages() => SetClearConfirmOpen(false);

    /// <summary>Grant consent (web <c>handleAcceptConsent</c>). No-ops when already accepted.</summary>
    public void AcceptConsent()
    {
        if (!CanAcceptConsent)
        {
            return;
        }

        _consent.Accept();
        _diagnostics.RecordConsentChanged();
        SetStatusMessage(PrivacySectionRegistration.ConsentAcceptedToast(_localizer));
    }

    /// <summary>Withdraw consent (web <c>handleDeclineConsent</c>). No-ops when already declined.</summary>
    public void DeclineConsent()
    {
        if (!CanDeclineConsent)
        {
            return;
        }

        _consent.Decline();
        _diagnostics.RecordConsentChanged();
        SetStatusMessage(PrivacySectionRegistration.ConsentDeclinedToast(_localizer));
    }

    /// <summary>Reset consent to "not decided" (web <c>handleResetConsent</c>). No-ops when already unknown.</summary>
    public void ResetConsent()
    {
        if (!CanResetConsent)
        {
            return;
        }

        _consent.Reset();
        _diagnostics.RecordConsentChanged();
        SetStatusMessage(PrivacySectionRegistration.ConsentResetToast(_localizer));
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _recentPages.Changed -= OnRecentPagesChanged;
        _consent.Changed -= OnConsentChanged;
        Cancel(ref _requirementCts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ────────────────────────────────────────────────────────────────────────────────────────

    private void PerformClear()
    {
        _recentPages.Clear(); // raises Changed → OnRecentPagesChanged refreshes the count
        _diagnostics.RecordRecentPagesCleared();
        SetStatusMessage(PrivacySectionRegistration.ClearedToast(_localizer));
    }

    private int CountRecent() => _recentPages.GetEntries(RecentPagesMaxCount).Count;

    private void OnRecentPagesChanged(object? sender, EventArgs e)
    {
        if (Set(ref _recentCount, CountRecent(), nameof(RecentCount)))
        {
            Raise(nameof(RecentCountLabel));
            Raise(nameof(CanClearRecentPages));
        }
    }

    private void OnConsentChanged(object? sender, EventArgs e)
    {
        if (Set(ref _consentState, _consent.Current, nameof(ConsentState)))
        {
            Raise(nameof(ConsentStateLabel));
            Raise(nameof(CanAcceptConsent));
            Raise(nameof(CanDeclineConsent));
            Raise(nameof(CanResetConsent));
        }
    }

    private async Task StreamRequirementAsync(CancellationToken cancellationToken)
    {
        var cts = Supersede(ref _requirementCts, cancellationToken);
        _attempts++;
        Raise(nameof(Attempts));

        if (!_hasRequirementValue)
        {
            SetRequirementState(PrivacyRequirementState.Loading);
        }
        else
        {
            Set(ref _isFetching, true, nameof(IsFetching));
        }

        try
        {
            await foreach (var result in _requirement.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    private void Apply(RepositoryResult<bool> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!_hasRequirementValue)
                {
                    SetRequirementState(PrivacyRequirementState.Loading);
                }

                Set(ref _isFetching, true, nameof(IsFetching));
                break;

            case LoadStatus.Cached:
                ApplyValue(result.Value, result.FetchedAt, fetching: false, stale: result.IsStale, offline: false, error: false);
                break;

            case LoadStatus.Refreshing:
                ApplyValue(result.Value, result.FetchedAt, fetching: true, stale: result.IsStale, offline: false, error: false);
                break;

            case LoadStatus.Loaded:
                ApplyValue(result.Value, result.FetchedAt, fetching: false, stale: false, offline: false, error: false);
                break;

            case LoadStatus.Empty:
                // A version body with no usable data → consent not required (web Boolean(undefined) === false).
                ApplyValue(false, result.FetchedAt, fetching: false, stale: false, offline: false, error: false);
                break;

            case LoadStatus.Offline:
                ApplyValue(result.Value, result.FetchedAt, fetching: false, stale: true, offline: true, error: true);
                break;

            default:
                SetError();
                break;
        }
    }

    private void ApplyValue(bool requireConsent, DateTimeOffset? fetchedAt, bool fetching, bool stale, bool offline, bool error)
    {
        _hasRequirementValue = true;
        Set(ref _requireConsent, requireConsent, nameof(RequireConsent));
        Raise(nameof(ConsentBody));
        if (fetchedAt is { } ts)
        {
            Set(ref _updatedAt, ts, nameof(UpdatedAt));
        }

        Set(ref _isFetching, fetching, nameof(IsFetching));
        Set(ref _isStale, stale, nameof(IsStale));
        Set(ref _isError, error, nameof(IsError));
        SetRequirementState(offline
            ? PrivacyRequirementState.Offline
            : stale ? PrivacyRequirementState.Stale : PrivacyRequirementState.Ready);
    }

    private void SetError()
    {
        // Web parity: a failed version read leaves require_cookie_consent undefined → false → the "preview"
        // body. The panel is never hidden; an inline retry is offered alongside.
        Set(ref _requireConsent, false, nameof(RequireConsent));
        Raise(nameof(ConsentBody));
        Set(ref _isFetching, false, nameof(IsFetching));
        Set(ref _isStale, false, nameof(IsStale));
        Set(ref _isError, true, nameof(IsError));
        SetRequirementState(PrivacyRequirementState.Error);
    }

    private void SetRequirementState(PrivacyRequirementState value)
    {
        if (Set(ref _requirementState, value, nameof(RequirementState)))
        {
            Raise(nameof(RequirementErrorMessage));
        }
    }

    private void SetClearConfirmOpen(bool value) => Set(ref _isClearConfirmOpen, value, nameof(IsClearConfirmOpen));

    private void SetStatusMessage(string message)
    {
        // Always re-raise so the view re-announces even when the same action repeats (the web toast fires each
        // time); force the change by clearing first when the text is identical.
        if (string.Equals(_statusMessage, message, StringComparison.Ordinal))
        {
            _statusMessage = null;
            Raise(nameof(StatusMessage));
        }

        _statusMessage = message;
        Raise(nameof(StatusMessage));
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

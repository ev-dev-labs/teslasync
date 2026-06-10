using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QuietHoursPanel"/> view — the native port of the web
/// QuietHoursPanel hook composition (web/src/features/settings/components/QuietHoursPanel.tsx). It owns the
/// cache-then-network read of the quiet-hours windows so the surface renders the full freshness state matrix the
/// P2 contract mandates, holds the create/edit draft (the web <c>draft</c> / <c>editingId</c> state), validates
/// and persists it through the shared <see cref="IQuietHoursSource"/> seam, and surfaces a save/delete feedback
/// cue (the web <c>useToast</c> success/error). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class QuietHoursPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IQuietHoursSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTime> _now;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private QuietHoursState _state = QuietHoursState.Loading;
    private IReadOnlyList<QuietHoursWindow> _windows = Array.Empty<QuietHoursWindow>();
    private QuietHoursDraft? _draft;
    private string? _validationError;
    private QuietHoursDisplay _display;
    private QuietHoursFeedback? _feedback;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private bool _isSaving;
    private bool _isDeleting;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the shared windows source and the i18n facade.</summary>
    /// <param name="source">The cache-then-network quiet-hours source (web <c>useQuietHours</c> + mutations).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="now">An optional clock for the "next change" hint (defaults to the local wall clock).</param>
    public QuietHoursPanelViewModel(IQuietHoursSource source, ILocalizer localizer, Func<DateTime>? now = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _now = now ?? (() => DateTime.Now);
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface freshness state.</summary>
    public QuietHoursState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (header, list and optional form).</summary>
    public QuietHoursDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The current windows snapshot (exposed for hosting/diagnostics and tests).</summary>
    public IReadOnlyList<QuietHoursWindow> Windows => _windows;

    /// <summary>The open create/edit draft, or null when no form is shown.</summary>
    public QuietHoursDraft? Draft => _draft;

    /// <summary>True while the create/edit form is open.</summary>
    public bool HasDraft => _draft is not null;

    /// <summary>The latest save/delete feedback cue, or null when none is pending.</summary>
    public QuietHoursFeedback? Feedback
    {
        get => _feedback;
        private set => Set(ref _feedback, value);
    }

    /// <summary>Last successful windows-read timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background windows refresh is in flight (the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown windows snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while a create/update write is in flight (the submit button shows a spinner).</summary>
    public bool IsSaving
    {
        get => _isSaving;
        private set => Set(ref _isSaving, value);
    }

    /// <summary>True while a delete write is in flight (the row's delete button is disabled).</summary>
    public bool IsDeleting
    {
        get => _isDeleting;
        private set => Set(ref _isDeleting, value);
    }

    /// <summary>True when the windows read failed with no cache (drives the error surface).</summary>
    public bool IsError => _state == QuietHoursState.Error;

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of windows-read attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>
    /// Run a cache-then-network read of the quiet-hours windows: counts the attempt, shows the skeleton only when
    /// nothing is already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels the read.</param>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the windows read from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>Open the create form seeded with defaults and the host timezone (web <c>startCreate</c>).</summary>
    public void StartCreate()
    {
        _draft = QuietHoursDraft.CreateDefault(QuietHoursTimezones.ResolveLocal());
        _validationError = null;
        RaiseDraftChanged();
    }

    /// <summary>Open the edit form for the window <paramref name="id"/> (web <c>startEdit</c>); a no-op if it is gone.</summary>
    /// <param name="id">The window id to edit.</param>
    public void StartEdit(long id)
    {
        var window = _windows.FirstOrDefault(w => w.Id == id);
        if (window is null)
        {
            return;
        }

        _draft = QuietHoursDraft.FromWindow(window);
        _validationError = null;
        RaiseDraftChanged();
    }

    /// <summary>Close the form, discarding the draft and any validation error (web <c>cancel</c>).</summary>
    public void Cancel()
    {
        if (_draft is null && _validationError is null)
        {
            return;
        }

        _draft = null;
        _validationError = null;
        RaiseDraftChanged();
    }

    /// <summary>Toggle the drafted enabled flag (web form <c>Toggle</c>).</summary>
    /// <param name="enabled">The new enabled state.</param>
    public void SetEnabled(bool enabled) => UpdateDraft(d => d with { Enabled = enabled });

    /// <summary>Set the drafted start time as <c>HH:MM</c> (web start <c>Input</c>).</summary>
    /// <param name="value">The new start time.</param>
    public void SetStart(string value) => UpdateDraft(d => d with { StartLocal = value ?? string.Empty });

    /// <summary>Set the drafted end time as <c>HH:MM</c> (web end <c>Input</c>).</summary>
    /// <param name="value">The new end time.</param>
    public void SetEnd(string value) => UpdateDraft(d => d with { EndLocal = value ?? string.Empty });

    /// <summary>Set the drafted IANA timezone (web timezone <c>Select</c>).</summary>
    /// <param name="value">The new IANA timezone.</param>
    public void SetTimezone(string value) => UpdateDraft(d => d with { Timezone = value ?? string.Empty });

    /// <summary>Toggle a weekday bit in the draft (web <c>toggleWeekday</c>).</summary>
    /// <param name="bit">The weekday bit to flip.</param>
    public void ToggleWeekday(int bit) => UpdateDraft(d => d.ToggleWeekday(bit));

    /// <summary>Toggle a bypass severity in the draft (web <c>toggleSeverity</c>).</summary>
    /// <param name="severity">The severity wire value to flip.</param>
    public void ToggleSeverity(string severity)
    {
        ArgumentException.ThrowIfNullOrEmpty(severity);
        UpdateDraft(d => d.ToggleSeverity(severity));
    }

    /// <summary>
    /// Validate and persist the draft (web <c>submit</c>). On a validation failure the localized message is shown
    /// and no write runs. On success the matching "created" / "updated" toast is surfaced, the form is closed and
    /// the list is re-read; on a write failure the "save failed" toast is surfaced and the form stays open.
    /// </summary>
    /// <param name="cancellationToken">Cancels the write.</param>
    public async Task SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (_draft is not { } draft)
        {
            return;
        }

        var validation = QuietHoursValidation.Validate(draft);
        if (!validation.Ok)
        {
            _validationError = _localizer.GetString(
                QuietHoursValidation.MessageKey(validation),
                QuietHoursValidation.MessageFallback(validation));
            Reproject();
            return;
        }

        _validationError = null;
        bool isUpdate = draft.Id is { } id && id > 0;
        IsSaving = true;
        try
        {
            await _source.SaveAsync(draft, cancellationToken).ConfigureAwait(false);
            Feedback = new QuietHoursFeedback(
                isUpdate
                    ? _localizer.GetString("toast.quietHours.updated", "Quiet hours window updated")
                    : _localizer.GetString("toast.quietHours.created", "Quiet hours window created"),
                IsError: false);
            _draft = null;
            RaiseDraftChanged();
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Feedback = new QuietHoursFeedback(
                _localizer.GetString("toast.quietHours.saveError", "Failed to save quiet hours window"),
                IsError: true);
        }
        finally
        {
            IsSaving = false;
        }
    }

    /// <summary>
    /// Delete the window <paramref name="id"/> (web <c>removeWindow</c>). On success the "removed" toast is shown
    /// and the list is re-read; on failure the "delete failed" toast is shown.
    /// </summary>
    /// <param name="id">The window id to delete.</param>
    /// <param name="cancellationToken">Cancels the write.</param>
    public async Task DeleteAsync(long id, CancellationToken cancellationToken = default)
    {
        IsDeleting = true;
        try
        {
            await _source.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
            Feedback = new QuietHoursFeedback(
                _localizer.GetString("toast.quietHours.deleted", "Quiet hours window removed"),
                IsError: false);
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            Feedback = new QuietHoursFeedback(
                _localizer.GetString("toast.quietHours.deleteError", "Failed to delete quiet hours window"),
                IsError: true);
        }
        finally
        {
            IsDeleting = false;
        }
    }

    /// <summary>Dismiss the current save/delete feedback cue.</summary>
    public void DismissFeedback() => Feedback = null;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private void UpdateDraft(Func<QuietHoursDraft, QuietHoursDraft> mutate)
    {
        if (_draft is not { } draft)
        {
            return;
        }

        _draft = mutate(draft);
        Reproject();
    }

    private bool HasContent() =>
        _state is QuietHoursState.Loaded
            or QuietHoursState.Stale
            or QuietHoursState.Offline
            or QuietHoursState.Empty;

    private void Apply(RepositoryResult<IReadOnlyList<QuietHoursWindow>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(
                    result.Value ?? Array.Empty<QuietHoursWindow>(),
                    result.FetchedAt,
                    stale: true,
                    fetching: false,
                    offline: true,
                    error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        IReadOnlyList<QuietHoursWindow> windows,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _windows = windows;
        Raise(nameof(Windows));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? QuietHoursState.Offline
            : stale
                ? QuietHoursState.Stale
                : windows.Count == 0
                    ? QuietHoursState.Empty
                    : QuietHoursState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = QuietHoursState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _windows = Array.Empty<QuietHoursWindow>();
        Raise(nameof(Windows));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = QuietHoursState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = QuietHoursState.Error;
        RaiseError();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "quietHours.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "quietHours.error.offline",
            _ => "quietHours.error.load",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage quiet hours",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved windows",
            _ => "Couldn't load quiet-hours windows",
        };

        return _localizer.GetString(key, fallback);
    }

    private QuietHoursDisplay Project() =>
        QuietHoursProjection.Project(_windows, _draft, _validationError, _now(), _localizer);

    private void Reproject() => Display = Project();

    private void RaiseDraftChanged()
    {
        Raise(nameof(Draft));
        Raise(nameof(HasDraft));
        Reproject();
    }

    private void RaiseError() => Raise(nameof(IsError));

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

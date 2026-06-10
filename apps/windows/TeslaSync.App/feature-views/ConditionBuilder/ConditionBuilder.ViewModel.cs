using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ConditionBuilder"/> view — the native port of the
/// web controlled component <c>ConditionBuilder</c>
/// (web/src/features/automations/pages/ConditionBuilder.tsx). It owns the edited condition list (the web
/// <c>conditions</c> prop) and raises <see cref="ConditionsChanged"/> on every mutation (the web
/// <c>onChange</c> callback), so a host can persist the rule. The pure list transforms come from
/// <see cref="ConditionBuilderLogic"/>; the surface only orchestrates. It additionally binds the
/// cache-then-network <see cref="IConditionBuilderSource"/> (the web <c>useGeofences</c> read), projects it
/// through <see cref="ConditionBuilderProjection.ProjectGeofencePicker"/>, and exposes the mutually-exclusive
/// <see cref="GeofenceState"/> plus freshness so the geofence dropdown reflects loading / empty / stale /
/// offline / error while the rest of the builder stays interactive. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class ConditionBuilderViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<GeofenceOption> NoGeofences = Array.Empty<GeofenceOption>();

    private readonly IConditionBuilderSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<AutomationCondition> _conditions;
    private IReadOnlyList<GeofenceOption> _geofences = NoGeofences;
    private ConditionGeofenceState _geofenceState = ConditionGeofenceState.Loading;
    private ConditionGeofencePickerDisplay _geofenceDisplay;
    private DateTimeOffset? _geofenceUpdatedAt;
    private bool _geofenceFetching;
    private int _geofenceAttempts;

    /// <summary>Creates the holder over its geofence source, the i18n facade and an optional seed list.</summary>
    /// <param name="source">The cache-then-network geofence source (the web <c>useGeofences</c> read).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="initialConditions">The conditions to seed the builder with (defaults to empty).</param>
    public ConditionBuilderViewModel(
        IConditionBuilderSource source,
        ILocalizer localizer,
        IEnumerable<AutomationCondition>? initialConditions = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _conditions = Normalize(initialConditions);
        _geofenceDisplay = ConditionBuilderProjection.ProjectGeofencePicker(
            ConditionGeofenceState.Loading, NoGeofences, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with the new condition list on every mutation (the web <c>onChange</c> callback).</summary>
    public event EventHandler<IReadOnlyList<AutomationCondition>>? ConditionsChanged;

    /// <summary>The current, immutable condition list (the web <c>conditions</c> value).</summary>
    public IReadOnlyList<AutomationCondition> Conditions
    {
        get => _conditions;
        private set
        {
            _conditions = value;
            Raise(nameof(Conditions));
        }
    }

    /// <summary>The current geofence-picker lifecycle state.</summary>
    public ConditionGeofenceState GeofenceState
    {
        get => _geofenceState;
        private set => Set(ref _geofenceState, value);
    }

    /// <summary>The projected, render-ready geofence picker (options + chip + hint).</summary>
    public ConditionGeofencePickerDisplay GeofenceDisplay
    {
        get => _geofenceDisplay;
        private set
        {
            _geofenceDisplay = value;
            Raise(nameof(GeofenceDisplay));
        }
    }

    /// <summary>The resolved geofence options feeding the dropdown (web <c>geofences ?? []</c>).</summary>
    public IReadOnlyList<GeofenceOption> Geofences => _geofences;

    /// <summary>True while a background geofence refresh is in flight (the picker chip pulses).</summary>
    public bool IsFetchingGeofences
    {
        get => _geofenceFetching;
        private set => Set(ref _geofenceFetching, value);
    }

    /// <summary>Last successful geofence fetch timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? GeofenceUpdatedAt
    {
        get => _geofenceUpdatedAt;
        private set => Set(ref _geofenceUpdatedAt, value);
    }

    /// <summary>Number of geofence load attempts started (including retries).</summary>
    public int GeofenceAttempts
    {
        get => _geofenceAttempts;
        private set => Set(ref _geofenceAttempts, value);
    }

    /// <summary>The localized surface title (Narrator name / host chrome).</summary>
    public string Title => ConditionBuilderRegistration.Name(_localizer);

    /// <summary>
    /// Run a cache-then-network geofence load: counts the attempt, shows the loading state only when nothing
    /// is already resolved (otherwise keeps the options while refreshing), and folds every emission into
    /// <see cref="GeofenceState"/> + <see cref="GeofenceDisplay"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadGeofencesAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        GeofenceAttempts++;
        if (!HasGeofenceContent())
        {
            SetGeofenceLoading();
        }
        else
        {
            IsFetchingGeofences = true;
        }

        try
        {
            await foreach (var result in _source.StreamGeofencesAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyGeofences(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry the geofence load after a failure (the web <c>QueryError</c> retry).</summary>
    public Task RetryGeofencesAsync() => LoadGeofencesAsync();

    /// <summary>Append a new default signal condition (the web "Add Condition" button / <c>addCondition</c>).</summary>
    public void AddCondition()
    {
        var next = new List<AutomationCondition>(_conditions.Count + 1);
        next.AddRange(_conditions);
        next.Add(ConditionBuilderLogic.CreateDefault(AutomationConditionKind.Signal));
        Commit(next);
    }

    /// <summary>Remove the condition at <paramref name="index"/> (the web row trash button / <c>removeCondition</c>).</summary>
    public void RemoveCondition(int index)
    {
        if (index < 0 || index >= _conditions.Count)
        {
            return;
        }

        var next = new List<AutomationCondition>(_conditions.Count - 1);
        for (int i = 0; i < _conditions.Count; i++)
        {
            if (i != index)
            {
                next.Add(_conditions[i]);
            }
        }

        Commit(next);
    }

    /// <summary>
    /// Replace the condition at <paramref name="index"/> with <paramref name="condition"/> (the web
    /// <c>replaceCondition</c> — used for both the type change and every field edit).
    /// </summary>
    public void ReplaceCondition(int index, AutomationCondition condition)
    {
        ArgumentNullException.ThrowIfNull(condition);
        if (index < 0 || index >= _conditions.Count)
        {
            return;
        }

        var next = new List<AutomationCondition>(_conditions);
        next[index] = condition;
        Commit(next);
    }

    /// <summary>
    /// Change the kind of the condition at <paramref name="index"/>, seeding it with the new kind's default
    /// (the web condition-type select <c>onChange</c> → <c>createDefaultCondition</c>).
    /// </summary>
    public void ChangeConditionKind(int index, AutomationConditionKind kind) =>
        ReplaceCondition(index, ConditionBuilderLogic.CreateDefault(kind));

    /// <summary>Replace the entire condition list (host-driven seed / reset).</summary>
    public void SetConditions(IEnumerable<AutomationCondition> conditions)
    {
        ArgumentNullException.ThrowIfNull(conditions);
        Commit(Normalize(conditions));
    }

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
        GC.SuppressFinalize(this);
    }

    private static IReadOnlyList<AutomationCondition> Normalize(IEnumerable<AutomationCondition>? conditions)
    {
        if (conditions is null)
        {
            return Array.Empty<AutomationCondition>();
        }

        var list = new List<AutomationCondition>();
        foreach (var condition in conditions)
        {
            if (condition is not null)
            {
                list.Add(condition);
            }
        }

        return list;
    }

    private void Commit(IReadOnlyList<AutomationCondition> next)
    {
        Conditions = next;
        ConditionsChanged?.Invoke(this, next);
    }

    private bool HasGeofenceContent() =>
        _geofenceState is ConditionGeofenceState.Ready
            or ConditionGeofenceState.Empty
            or ConditionGeofenceState.Stale
            or ConditionGeofenceState.Offline;

    private void ApplyGeofences(RepositoryResult<IReadOnlyList<GeofenceOption>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasGeofenceContent())
                {
                    SetGeofenceLoading();
                }

                IsFetchingGeofences = true;
                break;

            case LoadStatus.Cached:
                ApplyGeofenceSnapshot(result.Value, result.FetchedAt, stale: result.IsStale, fetching: false, offline: false);
                break;

            case LoadStatus.Refreshing:
                ApplyGeofenceSnapshot(result.Value, result.FetchedAt, stale: result.IsStale, fetching: true, offline: false);
                break;

            case LoadStatus.Loaded:
                ApplyGeofenceSnapshot(result.Value, result.FetchedAt, stale: false, fetching: false, offline: false);
                break;

            case LoadStatus.Empty:
                SetGeofenceEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyGeofenceSnapshot(result.Value, result.FetchedAt, stale: true, fetching: false, offline: true);
                break;

            default:
                SetGeofenceError();
                break;
        }
    }

    private void ApplyGeofenceSnapshot(
        IReadOnlyList<GeofenceOption>? geofences,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline)
    {
        _geofences = geofences ?? NoGeofences;
        Raise(nameof(Geofences));
        GeofenceUpdatedAt = fetchedAt;
        IsFetchingGeofences = fetching;

        // Freshness/offline wins over emptiness so the chip survives; a fresh, non-empty list is Ready, while
        // a resolved-but-empty list falls back to the friendly Empty hint (web "no geofences" rendering).
        GeofenceState = offline
            ? ConditionGeofenceState.Offline
            : _geofences.Count == 0
                ? ConditionGeofenceState.Empty
                : stale
                    ? ConditionGeofenceState.Stale
                    : ConditionGeofenceState.Ready;

        ReprojectGeofences();
    }

    private void SetGeofenceLoading()
    {
        GeofenceState = ConditionGeofenceState.Loading;
        ReprojectGeofences();
    }

    private void SetGeofenceEmpty(DateTimeOffset? fetchedAt)
    {
        _geofences = NoGeofences;
        Raise(nameof(Geofences));
        GeofenceUpdatedAt = fetchedAt;
        IsFetchingGeofences = false;
        GeofenceState = ConditionGeofenceState.Empty;
        ReprojectGeofences();
    }

    private void SetGeofenceError()
    {
        IsFetchingGeofences = false;
        GeofenceState = ConditionGeofenceState.Error;
        ReprojectGeofences();
    }

    private void ReprojectGeofences() =>
        GeofenceDisplay = ConditionBuilderProjection.ProjectGeofencePicker(_geofenceState, _geofences, _localizer);

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

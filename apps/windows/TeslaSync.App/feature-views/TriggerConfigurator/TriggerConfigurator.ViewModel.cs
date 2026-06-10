using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TriggerConfigurator"/> view — the native port of
/// the web <c>TriggerConfigurator</c> component (web/src/features/automations/pages/TriggerConfigurator.tsx).
/// It owns the controlled <see cref="Trigger"/> (the web <c>trigger</c> prop), exposes a
/// <see cref="TriggerChanged"/> event (the web <c>onChange</c>) raised on every edit, and projects each of the
/// four trigger kinds (schedule / event / geofence / signal) into render-ready labels and option lists so the
/// view is a thin renderer. The geofence dropdown binds the cache-then-network
/// <see cref="ITriggerGeofenceSource"/> (the web <c>useGeofences</c> query) and surfaces the full
/// loading / loaded / empty / error / stale / offline lifecycle. Every label resolves through the i18n facade.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TriggerConfiguratorViewModel : INotifyPropertyChanged, IDisposable
{
    private const string EmDash = "—";

    private readonly ITriggerGeofenceSource _source;
    private readonly ILocalizer _localizer;

    private AutomationTrigger _trigger;

    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<TriggerGeofence>>? _lastGeofence;
    private bool _disposed;

    private IReadOnlyList<TriggerGeofence> _geofences = Array.Empty<TriggerGeofence>();
    private TriggerGeofenceLoadState _geofenceState = TriggerGeofenceLoadState.Loading;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its geofence source, localizer and (optional) initial trigger.</summary>
    /// <param name="source">The cache-then-network geofence source backing the geofence dropdown.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="initialTrigger">The trigger to edit; defaults to a fresh schedule trigger when null.</param>
    public TriggerConfiguratorViewModel(
        ITriggerGeofenceSource source,
        ILocalizer localizer,
        AutomationTrigger? initialTrigger = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _trigger = initialTrigger ?? AutomationTrigger.CreateDefault(AutomationTriggerKind.Schedule);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the trigger is edited (the web <c>onChange</c>); carries the new trigger.</summary>
    public event EventHandler<AutomationTrigger>? TriggerChanged;

    /// <summary>The trigger currently being edited (the web <c>trigger</c> prop).</summary>
    public AutomationTrigger Trigger => _trigger;

    /// <summary>The active trigger kind discriminator.</summary>
    public AutomationTriggerKind Kind => _trigger.Kind;

    /// <summary>
    /// A compact signature of every structural aspect of the surface (kind, schedule mode + day selection,
    /// signal value-field shape, dwell visibility and the geofence lifecycle). The view rebuilds only when
    /// this changes, so editing a text field keeps its focus while a structural change (a mode flip, a kind
    /// switch, a geofence load) re-renders.
    /// </summary>
    public string StructureKey => BuildStructureKey();

    // ── Geofence lifecycle (web useGeofences) ────────────────────────────────────────────────────────────

    /// <summary>The mutually-exclusive geofence dropdown state.</summary>
    public TriggerGeofenceLoadState GeofenceState
    {
        get => _geofenceState;
        private set => Set(ref _geofenceState, value);
    }

    /// <summary>True while a background geofence refresh is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the geofence read failed with no cached list.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown geofence list is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Last successful geofence fetch timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>Localized error message shown in the geofence error / offline surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of geofence load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The geofences currently available to choose from (empty until loaded).</summary>
    public IReadOnlyList<TriggerGeofence> Geofences => _geofences;

    /// <summary>
    /// Run a cache-then-network geofence load: counts the attempt, shows the skeleton only when nothing is
    /// already visible, and folds every emission into the lifecycle state. A superseding load cancels the
    /// prior one.
    /// </summary>
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

    /// <summary>Retry the geofence load after a failure — re-runs from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    // ── Schedule projection (web trigger_schedule branch) ────────────────────────────────────────────────

    /// <summary>True when the current schedule round-trips as a simple "minute hour * * dow" expression.</summary>
    public bool IsSimpleSchedule => TriggerCron.Parse(ScheduleCronExpr) is not null;

    /// <summary>The current cron expression (web <c>cron_expr</c>); empty for non-schedule triggers.</summary>
    public string ScheduleCronExpr => (_trigger as ScheduleTrigger)?.CronExpr ?? string.Empty;

    /// <summary>The current schedule timezone (web <c>timezone</c>); empty for non-schedule triggers.</summary>
    public string ScheduleTimezone => (_trigger as ScheduleTrigger)?.Timezone ?? string.Empty;

    /// <summary>The simple-mode hour (web <c>parsed?.hour ?? 8</c>).</summary>
    public int ScheduleHour => TriggerCron.Parse(ScheduleCronExpr)?.Hour ?? 8;

    /// <summary>The simple-mode minute (web <c>parsed?.minute ?? 0</c>).</summary>
    public int ScheduleMinute => TriggerCron.Parse(ScheduleCronExpr)?.Minute ?? 0;

    /// <summary>The simple-mode selected weekday indices (web <c>parsed?.days ?? []</c>).</summary>
    public IReadOnlyList<int> ScheduleDays => TriggerCron.Parse(ScheduleCronExpr)?.Days ?? Array.Empty<int>();

    /// <summary>True when a weekday button renders active (web <c>selectedDays.length === 0 || selectedDays.includes(index)</c>).</summary>
    public bool IsDayActive(int index) => ScheduleDays.Count == 0 || ScheduleDays.Contains(index);

    // ── Signal projection (web trigger_signal branch) ────────────────────────────────────────────────────

    private SignalTrigger? Signal => _trigger as SignalTrigger;

    /// <summary>True when the chosen signal is boolean (web <c>isBool</c>).</summary>
    public bool SignalIsBool => Signal?.IsBool ?? false;

    /// <summary>True when the chosen signal is the free-text <c>state</c> signal.</summary>
    public bool SignalIsState => Signal?.IsState ?? false;

    /// <summary>True when the value field renders (web <c>op !== 'changed'</c>).</summary>
    public bool SignalShowValue => Signal?.ShowValueField ?? false;

    /// <summary>True when the "fire on any change" toggle is on (web <c>op === 'changed'</c>).</summary>
    public bool SignalChangedOnly => Signal?.Op == AutomationTriggerSignalOp.Changed;

    /// <summary>The current signal value rendered in the value field (web computed <c>value</c>).</summary>
    public string SignalValueString => Signal?.CurrentValueString ?? string.Empty;

    /// <summary>The current signal key (web <c>signal</c>).</summary>
    public string SignalKey => Signal?.Signal ?? string.Empty;

    /// <summary>The current signal operator wire literal (web <c>op</c>).</summary>
    public string SignalOpWire => (Signal?.Op ?? AutomationTriggerSignalOp.Equal).ToWire();

    // ── Event / geofence projection ──────────────────────────────────────────────────────────────────────

    /// <summary>The current event wire literal (web <c>event_type</c>); empty for non-event triggers.</summary>
    public string EventTypeWire => (_trigger as EventTrigger)?.EventType.ToWire() ?? string.Empty;

    /// <summary>The current geofence id as a select value (web <c>place_id > 0 ? String(place_id) : ''</c>).</summary>
    public string GeofencePlaceValue =>
        _trigger is GeofenceTrigger { PlaceId: > 0 } geo
            ? geo.PlaceId.ToString(CultureInfo.InvariantCulture)
            : string.Empty;

    /// <summary>The current geofence transition wire literal (web <c>event</c>).</summary>
    public string GeofenceEventWire => (_trigger as GeofenceTrigger)?.GeofenceEvent.ToWire() ?? string.Empty;

    /// <summary>True when the dwell-minutes field renders (web <c>trigger.event === 'dwell'</c>).</summary>
    public bool ShowDwellMinutes => _trigger is GeofenceTrigger { GeofenceEvent: AutomationGeofenceEvent.Dwell };

    /// <summary>The current dwell minutes (web <c>dwell_minutes ?? 5</c>).</summary>
    public int DwellMinutes => (_trigger as GeofenceTrigger)?.DwellMinutes ?? 5;

    // ── Projected option lists (localized) ───────────────────────────────────────────────────────────────

    /// <summary>The trigger-type options (web <c>TRIGGER_TYPES</c>), exported for a host's kind picker.</summary>
    public IReadOnlyList<TriggerOption> TriggerTypeOptions => TriggerEventCatalog.TriggerTypes
        .Select(t => new TriggerOption(t.Value.ToWire(), _localizer.GetString(t.LabelKey, t.Fallback)))
        .ToArray();

    /// <summary>The vehicle-event options (web <c>eventOptions</c>).</summary>
    public IReadOnlyList<TriggerOption> EventOptions => TriggerEventCatalog.VehicleEvents
        .Select(e => new TriggerOption(e.Value.ToWire(), _localizer.GetString(e.LabelKey, e.Fallback)))
        .ToArray();

    /// <summary>The geofence-transition options (web <c>geofenceEventOptions</c>).</summary>
    public IReadOnlyList<TriggerOption> GeofenceEventOptions => TriggerEventCatalog.GeofenceEvents
        .Select(e => new TriggerOption(e.Value.ToWire(), _localizer.GetString(e.LabelKey, e.Fallback)))
        .ToArray();

    /// <summary>The signal-operator options (web <c>signalOperatorOptions</c>).</summary>
    public IReadOnlyList<TriggerOption> OperatorOptions => TriggerSignalCatalog.Operators
        .Select(o => new TriggerOption(o.Op.ToWire(), _localizer.GetString(o.LabelKey, o.Fallback)))
        .ToArray();

    /// <summary>The signal-field options (web <c>SIGNAL_FIELD_OPTIONS</c>); labels flow through the localizer.</summary>
    public IReadOnlyList<TriggerOption> SignalFieldOptions => TriggerSignalCatalog.SignalFields
        .Select(f => new TriggerOption(f.Key, _localizer.GetString(f.Label, f.Label)))
        .ToArray();

    /// <summary>The timezone options (web <c>COMMON_TIMEZONES</c> with <c>timezones.*</c> keys).</summary>
    public IReadOnlyList<TriggerOption> TimezoneOptions => TriggerScheduleCatalog.CommonTimezones
        .Select(z => new TriggerOption(z.Value, _localizer.GetString(TriggerScheduleCatalog.TimezoneKey(z.Value), z.Label)))
        .ToArray();

    /// <summary>The boolean value options (web True/False select).</summary>
    public IReadOnlyList<TriggerOption> BoolValueOptions => new[]
    {
        new TriggerOption("true", TrueLabel),
        new TriggerOption("false", FalseLabel),
    };

    /// <summary>
    /// The geofence dropdown options: the leading "Select geofence…" prompt followed by every loaded
    /// geofence (web <c>[{ value: '', label: t('selectGeofence') }, ...geofences.map(...)]</c>).
    /// </summary>
    public IReadOnlyList<TriggerOption> GeofenceOptions
    {
        get
        {
            var options = new List<TriggerOption>(_geofences.Count + 1)
            {
                new(string.Empty, SelectGeofenceLabel),
            };
            foreach (var geofence in _geofences)
            {
                options.Add(new TriggerOption(geofence.Id, string.IsNullOrWhiteSpace(geofence.Name) ? EmDash : geofence.Name!));
            }

            return options;
        }
    }

    /// <summary>The weekday short label for a button (web <c>t('common.days.short.{index}', DAYS[index])</c>).</summary>
    public string DayLabel(int index) =>
        _localizer.GetString(TriggerScheduleCatalog.DayKey(index), TriggerScheduleCatalog.Days[index]);

    // ── Localized labels ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>Web <c>automations.builder.time</c> "Time".</summary>
    public string TimeLabel => _localizer.GetString("automations.builder.time", "Time");

    /// <summary>Web <c>automations.builder.days</c> "Days".</summary>
    public string DaysLabel => _localizer.GetString("automations.builder.days", "Days");

    /// <summary>Web <c>automations.builder.cronExpr</c> "Cron Expression".</summary>
    public string CronExprLabel => _localizer.GetString("automations.builder.cronExpr", "Cron Expression");

    /// <summary>The cron field example hint shown when empty (web sample "0 8 * * 1-5").</summary>
    public string CronExample => _localizer.GetString("automations.builder.cronPlaceholder", "0 8 * * 1-5"); // parity:allow web i18n key mirrors the source catalog name

    /// <summary>Web <c>automations.builder.cronHint</c> "minute hour day-of-month month day-of-week".</summary>
    public string CronHint => _localizer.GetString("automations.builder.cronHint", "minute hour day-of-month month day-of-week");

    /// <summary>The cron field help-tooltip content (web <c>help.fields.automations.cronExpr</c>).</summary>
    public string CronHelp => _localizer.GetString(
        "help.fields.automations.cronExpr",
        "Standard 5-field cron syntax (minute hour day-of-month month day-of-week). Use the simple mode above for the most common schedules.");

    /// <summary>Web <c>automations.builder.advancedCron</c> "Use advanced cron expression".</summary>
    public string AdvancedCronLabel => _localizer.GetString("automations.builder.advancedCron", "Use advanced cron expression");

    /// <summary>Web <c>automations.builder.simpleCron</c> "Switch to simple mode".</summary>
    public string SimpleCronLabel => _localizer.GetString("automations.builder.simpleCron", "Switch to simple mode");

    /// <summary>The schedule mode-toggle label (web <c>isSimple ? advancedCron : simpleCron</c>).</summary>
    public string ScheduleModeToggleLabel => IsSimpleSchedule ? AdvancedCronLabel : SimpleCronLabel;

    /// <summary>Web <c>automations.builder.timezone</c> "Timezone".</summary>
    public string TimezoneLabel => _localizer.GetString("automations.builder.timezone", "Timezone");

    /// <summary>Web <c>automations.builder.event</c> "Event".</summary>
    public string EventLabel => _localizer.GetString("automations.builder.event", "Event");

    /// <summary>Web <c>automations.builder.geofence</c> "Geofence".</summary>
    public string GeofenceLabel => _localizer.GetString("automations.builder.geofence", "Geofence");

    /// <summary>Web <c>automations.builder.selectGeofence</c> "Select geofence...".</summary>
    public string SelectGeofenceLabel => _localizer.GetString("automations.builder.selectGeofence", "Select geofence...");

    /// <summary>Web <c>automations.builder.geofenceEvent</c> "Event".</summary>
    public string GeofenceEventLabel => _localizer.GetString("automations.builder.geofenceEvent", "Event");

    /// <summary>Web <c>automations.builder.dwellMinutes</c> "Dwell Minutes".</summary>
    public string DwellMinutesLabel => _localizer.GetString("automations.builder.dwellMinutes", "Dwell Minutes");

    /// <summary>Web <c>automations.builder.dwellHint</c> "Required for dwell triggers".</summary>
    public string DwellHint => _localizer.GetString("automations.builder.dwellHint", "Required for dwell triggers");

    /// <summary>The dwell field help-tooltip content (web <c>help.fields.automations.dwellMinutes</c>).</summary>
    public string DwellHelp => _localizer.GetString(
        "help.fields.automations.dwellMinutes",
        "How many minutes the vehicle must stay inside the geofence before this dwell trigger fires.");

    /// <summary>Web <c>automations.builder.signal</c> "Signal".</summary>
    public string SignalLabel => _localizer.GetString("automations.builder.signal", "Signal");

    /// <summary>Web <c>automations.builder.operator</c> "Operator".</summary>
    public string OperatorLabel => _localizer.GetString("automations.builder.operator", "Operator");

    /// <summary>Web <c>automations.builder.value</c> "Value".</summary>
    public string ValueLabel => _localizer.GetString("automations.builder.value", "Value");

    /// <summary>Web <c>common.true</c> "True".</summary>
    public string TrueLabel => _localizer.GetString("common.true", "True");

    /// <summary>Web <c>common.false</c> "False".</summary>
    public string FalseLabel => _localizer.GetString("common.false", "False");

    /// <summary>The vehicle-state example hint shown when empty (web sample "online").</summary>
    public string StateExample => _localizer.GetString("automations.builder.statePlaceholder", "online"); // parity:allow web i18n key mirrors the source catalog name

    /// <summary>Web <c>automations.builder.changedOnly</c> "Fire on any change".</summary>
    public string ChangedOnlyLabel => _localizer.GetString("automations.builder.changedOnly", "Fire on any change");

    /// <summary>The geofence skeleton accessible label.</summary>
    public string GeofenceLoadingLabel => _localizer.GetString("automations.builder.geofenceLoading", "Loading geofences…");

    /// <summary>The geofence empty-state message (no geofences configured).</summary>
    public string GeofenceEmptyMessage => _localizer.GetString("automations.builder.noGeofences", "No geofences configured");

    /// <summary>The retry affordance label (web <c>common.retry</c>).</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>The offline chip label.</summary>
    public string OfflineLabel => _localizer.GetString("common.offline", "Offline — showing cached geofences");

    // ── Mutators (web onChange handlers) ─────────────────────────────────────────────────────────────────

    /// <summary>Switch the trigger kind, resetting to that kind's default (web <c>createDefaultTrigger</c>).</summary>
    public void SelectKind(AutomationTriggerKind kind)
    {
        if (_trigger.Kind == kind)
        {
            return;
        }

        UpdateTrigger(AutomationTrigger.CreateDefault(kind));
    }

    /// <summary>Set the simple-mode time, rebuilding the cron expression (web time-field <c>onChange</c>).</summary>
    public void SetScheduleTime(int hour, int minute)
    {
        if (_trigger is not ScheduleTrigger schedule)
        {
            return;
        }

        UpdateTrigger(schedule with { CronExpr = TriggerCron.Build(hour, minute, ScheduleDays) });
    }

    /// <summary>Toggle a weekday, rebuilding the cron expression (web day-button <c>onClick</c>).</summary>
    public void ToggleScheduleDay(int index)
    {
        if (_trigger is not ScheduleTrigger schedule)
        {
            return;
        }

        var days = TriggerCron.ToggleDay(ScheduleDays, index);
        UpdateTrigger(schedule with { CronExpr = TriggerCron.Build(ScheduleHour, ScheduleMinute, days) });
    }

    /// <summary>Set the advanced cron expression verbatim (web cron-field <c>onChange</c>).</summary>
    public void SetCronExpr(string expr)
    {
        ArgumentNullException.ThrowIfNull(expr);
        if (_trigger is not ScheduleTrigger schedule)
        {
            return;
        }

        UpdateTrigger(schedule with { CronExpr = expr });
    }

    /// <summary>
    /// Toggle between simple and advanced cron entry (web mode-toggle <c>onClick</c>): faithfully reproduces
    /// the web's <c>cron_expr: isSimple ? trigger.cron_expr : '0 8 * * *'</c> — switching to simple seeds a
    /// simple expression; the simple-side toggle keeps the current expression.
    /// </summary>
    public void ToggleScheduleMode()
    {
        if (_trigger is not ScheduleTrigger schedule)
        {
            return;
        }

        UpdateTrigger(schedule with { CronExpr = IsSimpleSchedule ? schedule.CronExpr : "0 8 * * *" });
    }

    /// <summary>Set the schedule timezone (web timezone-select <c>onChange</c>).</summary>
    public void SetTimezone(string timezone)
    {
        ArgumentNullException.ThrowIfNull(timezone);
        if (_trigger is not ScheduleTrigger schedule)
        {
            return;
        }

        UpdateTrigger(schedule with { Timezone = timezone });
    }

    /// <summary>Set the vehicle event from its wire literal (web event-select <c>onChange</c>).</summary>
    public void SetEventType(string wire)
    {
        if (_trigger is not EventTrigger || !TriggerWire.TryParseEventType(wire, out var value))
        {
            return;
        }

        UpdateTrigger(new EventTrigger(value));
    }

    /// <summary>Set the geofence place from its select value (web geofence-select <c>onChange</c>).</summary>
    public void SetGeofencePlace(string value)
    {
        if (_trigger is not GeofenceTrigger geofence)
        {
            return;
        }

        long placeId = !string.IsNullOrEmpty(value) &&
            long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed)
            ? parsed
            : 0;
        UpdateTrigger(geofence with { PlaceId = placeId });
    }

    /// <summary>
    /// Set the geofence transition from its wire literal (web geofence-event-select <c>onChange</c>):
    /// switching to dwell seeds the dwell minutes (web <c>dwell_minutes ?? 5</c>); any other clears them.
    /// </summary>
    public void SetGeofenceEvent(string wire)
    {
        if (_trigger is not GeofenceTrigger geofence || !TriggerWire.TryParseGeofenceEvent(wire, out var value))
        {
            return;
        }

        int? dwell = value == AutomationGeofenceEvent.Dwell ? geofence.DwellMinutes ?? 5 : null;
        UpdateTrigger(geofence with { GeofenceEvent = value, DwellMinutes = dwell });
    }

    /// <summary>Set the dwell minutes (web dwell-field <c>onChange</c>, <c>parseInt(value) || 1</c>).</summary>
    public void SetDwellMinutes(int minutes)
    {
        if (_trigger is not GeofenceTrigger geofence)
        {
            return;
        }

        UpdateTrigger(geofence with { DwellMinutes = Math.Max(1, minutes) });
    }

    /// <summary>Set the signal field, reseting the operator/value to its default (web signal-select <c>onChange</c>).</summary>
    public void SetSignal(string signalKey)
    {
        ArgumentNullException.ThrowIfNull(signalKey);
        if (_trigger is not SignalTrigger)
        {
            return;
        }

        UpdateTrigger(SignalTrigger.ForSignal(signalKey));
    }

    /// <summary>
    /// Set the signal operator from its wire literal (web operator-select <c>onChange</c>): the <c>changed</c>
    /// operator drops the value, otherwise the current value is re-coerced for the new operator.
    /// </summary>
    public void SetSignalOp(string wire)
    {
        if (_trigger is not SignalTrigger signal || !TriggerWire.TryParseSignalOp(wire, out var op))
        {
            return;
        }

        var next = op == AutomationTriggerSignalOp.Changed
            ? new SignalTrigger(signal.Signal, op)
            : (signal with { Op = op }).WithValue(signal.CurrentValueString);
        UpdateTrigger(next);
    }

    /// <summary>Set the signal value from a raw string (web value-field <c>onChange</c>).</summary>
    public void SetSignalValue(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        if (_trigger is not SignalTrigger signal)
        {
            return;
        }

        UpdateTrigger(signal.WithValue(value));
    }

    /// <summary>
    /// Toggle "fire on any change" (web changed-only toggle <c>onChange</c>): on selects the <c>changed</c>
    /// operator (no value); off restores the <c>=</c> operator and re-coerces the current value.
    /// </summary>
    public void SetChangedOnly(bool changedOnly)
    {
        if (_trigger is not SignalTrigger signal)
        {
            return;
        }

        var next = changedOnly
            ? new SignalTrigger(signal.Signal, AutomationTriggerSignalOp.Changed)
            : (signal with { Op = AutomationTriggerSignalOp.Equal }).WithValue(signal.CurrentValueString);
        UpdateTrigger(next);
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

    private void UpdateTrigger(AutomationTrigger next)
    {
        _trigger = next;
        TriggerChanged?.Invoke(this, next);
        Raise(nameof(Trigger));
        Raise(nameof(Kind));
        Raise(nameof(StructureKey));
    }

    private bool HasContent() =>
        _geofenceState is TriggerGeofenceLoadState.Loaded or TriggerGeofenceLoadState.Stale or TriggerGeofenceLoadState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<TriggerGeofence>> result)
    {
        _lastGeofence = result;
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
                ApplyList(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyList(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyList(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyList(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyList(
        IReadOnlyList<TriggerGeofence> geofences,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        SetGeofences(geofences);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? OfflineLabel : null;
        GeofenceState = offline
            ? TriggerGeofenceLoadState.Offline
            : stale ? TriggerGeofenceLoadState.Stale : TriggerGeofenceLoadState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        GeofenceState = TriggerGeofenceLoadState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        SetGeofences(Array.Empty<TriggerGeofence>());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        GeofenceState = TriggerGeofenceLoadState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        GeofenceState = TriggerGeofenceLoadState.Error;
    }

    private void SetGeofences(IReadOnlyList<TriggerGeofence> geofences)
    {
        _geofences = geofences;
        Raise(nameof(Geofences));
        Raise(nameof(GeofenceOptions));
        Raise(nameof(StructureKey));
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        (string key, string fallback) = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => ("automations.builder.geofenceAuthError", "Sign in to load geofences"),
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => ("common.offline", "Offline — showing cached geofences"),
            _ => ("automations.builder.geofenceError", "Couldn't load geofences"),
        };

        return _localizer.GetString(key, fallback);
    }

    private string BuildStructureKey()
    {
        var builder = new StringBuilder();
        builder.Append(_trigger.Kind);
        switch (_trigger)
        {
            case ScheduleTrigger:
                builder.Append('|').Append(IsSimpleSchedule ? 'S' : 'A');
                builder.Append('|').Append(string.Join(',', ScheduleDays));
                break;
            case GeofenceTrigger:
                builder.Append('|').Append(GeofenceState);
                builder.Append('|').Append(IsFetching ? 'F' : '-');
                builder.Append('|').Append(ShowDwellMinutes ? 'D' : '-');
                builder.Append('|').Append(_geofences.Count);
                break;
            case SignalTrigger:
                builder.Append('|').Append(SignalIsBool ? 'B' : SignalIsState ? 'T' : 'N');
                builder.Append('|').Append(SignalShowValue ? 'V' : '-');
                break;
            default:
                break;
        }

        return builder.ToString();
    }

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

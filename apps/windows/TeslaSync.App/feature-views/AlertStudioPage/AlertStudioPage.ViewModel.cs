using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AlertStudioPage</c> view — the native port of the web page's
/// data + editor flow (web AlertStudioPage.tsx). It owns the rule list + the four data states, the notification
/// channels, the fleet vehicles and the computed metrics, the live rule-editor working state, the bulk selection,
/// the template gallery filters, the snooze target and the test-channel selection, reads everything through the
/// injected <see cref="IAlertStudioFeed"/> (the eleven web hooks), writes create / update / delete / toggle /
/// snooze / test / bulk mutations back through the same port, and projects the result through
/// <see cref="AlertStudioProjection"/> so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AlertStudioPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAlertStudioFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly AlertStudioDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<AlertStudioRule> _rules = Array.Empty<AlertStudioRule>();
    private IReadOnlyList<AlertStudioChannel> _channels = Array.Empty<AlertStudioChannel>();
    private IReadOnlyList<AlertStudioVehicle> _vehicles = Array.Empty<AlertStudioVehicle>();
    private IReadOnlyList<AlertStudioMetric> _metrics = Array.Empty<AlertStudioMetric>();

    private bool _rulesLoading = true;
    private bool _rulesError;
    private string? _rulesErrorDetail;
    private bool _channelsLoading = true;
    private bool _channelsError;

    private long? _selectedId;
    private AlertStudioEditor _editor = AlertStudioEditor.Fresh();
    private readonly HashSet<long> _bulkSelected = new();
    private string _ruleSearch = string.Empty;
    private string _templateSearch = string.Empty;
    private string? _templateCategory;
    private bool _showTemplates;
    private long? _snoozeTargetId;
    private HashSet<long>? _testChannelIds;
    private string? _formError;
    private bool _savePending;

    private AlertStudioDisplay _display;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics.</summary>
    /// <param name="feed">The studio data port (the eleven web hooks).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AlertStudioPageViewModel(
        IAlertStudioFeed feed,
        ILocalizer localizer,
        AlertStudioDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AlertStudioDiagnostics();
        _display = AlertStudioProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AlertStudioDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The localized page title (web <c>notifications.alertStudio.title</c>).</summary>
    public string Title => AlertStudioRegistration.Title(_localizer);

    /// <summary>The ids currently in the bulk selection.</summary>
    public IReadOnlyList<long> SelectedIds => _bulkSelected.ToArray();

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the four reads the page performs on mount.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        var token = cts.Token;

        if (_rules.Count == 0)
        {
            _rulesLoading = true;
        }

        if (_channels.Count == 0)
        {
            _channelsLoading = true;
        }

        Reproject();

        await Task.WhenAll(
            LoadRulesAsync(token),
            LoadChannelsAsync(token),
            LoadVehiclesAsync(token),
            LoadMetricsAsync(token)).ConfigureAwait(false);

        Reproject();
    }

    /// <summary>Refresh every read (retry button / mutation success invalidation).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Toggle the template gallery (web <c>setShowTemplates</c>).</summary>
    public void ToggleTemplates()
    {
        _showTemplates = !_showTemplates;
        Reproject();
    }

    /// <summary>Set the template search query (web <c>setTemplateSearch</c>).</summary>
    public void SetTemplateSearch(string value)
    {
        _templateSearch = value ?? string.Empty;
        Reproject();
    }

    /// <summary>Select / clear the template category filter (web <c>setTemplateCategory</c>).</summary>
    public void SetTemplateCategory(string? category)
    {
        _templateCategory = string.Equals(category, _templateCategory, StringComparison.Ordinal) ? null : category;
        Reproject();
    }

    /// <summary>Set the rule-list search query (web <c>setRuleSearch</c>).</summary>
    public void SetRuleSearch(string value)
    {
        _ruleSearch = value ?? string.Empty;
        PruneBulkSelection();
        Reproject();
    }

    /// <summary>Toggle one row in the bulk selection (web <c>toggleBulkSelected</c>).</summary>
    public void ToggleBulkSelect(long id, bool on)
    {
        if (on)
        {
            _bulkSelected.Add(id);
        }
        else
        {
            _bulkSelected.Remove(id);
        }

        Reproject();
    }

    /// <summary>Clear the bulk selection (web <c>clearBulk</c>).</summary>
    public void ClearBulkSelection()
    {
        if (_bulkSelected.Count == 0)
        {
            return;
        }

        _bulkSelected.Clear();
        Reproject();
    }

    /// <summary>Open the snooze sheet for a rule (web <c>setSnoozeTargetId</c>).</summary>
    public void OpenSnooze(long id)
    {
        _snoozeTargetId = id;
        Reproject();
    }

    /// <summary>Close the snooze sheet (web <c>setSnoozeTargetId(null)</c>).</summary>
    public void CloseSnooze()
    {
        _snoozeTargetId = null;
        Reproject();
    }

    /// <summary>Toggle a test-delivery channel (web <c>handleToggleTestChannel</c>).</summary>
    public void ToggleTestChannel(long id)
    {
        var all = _channels.Select(c => c.Id).ToHashSet();
        var current = _testChannelIds ?? new HashSet<long>(all);
        if (!current.Remove(id))
        {
            current.Add(id);
        }

        _testChannelIds = current.SetEquals(all) ? null : current;
        Reproject();
    }

    /// <summary>Update the editor working state (web <c>setEditor</c> reducer).</summary>
    public void UpdateEditor(Func<AlertStudioEditor, AlertStudioEditor> mutate)
    {
        ArgumentNullException.ThrowIfNull(mutate);
        _editor = mutate(_editor);
        _formError = null;
        Reproject();
    }

    /// <summary>Change the watched signal, coercing the operator + value kind (web <c>handleSignalChange</c>).</summary>
    public void HandleSignalChange(string signalName)
    {
        var name = signalName ?? string.Empty;
        var signalType = name.Length > 0
            ? AlertStudioCatalog.SignalTypeForName(name, _editor.ValueKind)
            : SignalValueType.Numeric;
        var op = AlertStudioCatalog.CoerceOperator(_editor.Op, signalType);
        _editor = _editor with
        {
            SignalName = name,
            Op = op,
            ValueKind = AlertStudioCatalog.ValueKindFor(signalType, op),
        };
        Reproject();
    }

    /// <summary>Change the operator, coercing the value kind (web <c>handleOperatorChange</c>).</summary>
    public void HandleOperatorChange(string op)
    {
        var signalType = AlertStudioCatalog.SignalTypeForName(_editor.SignalName, _editor.ValueKind);
        var coerced = AlertStudioCatalog.CoerceOperator(op ?? "=", signalType);
        _editor = _editor with { Op = coerced, ValueKind = AlertStudioCatalog.ValueKindFor(signalType, coerced) };
        Reproject();
    }

    /// <summary>Load an existing rule into the editor (web <c>handleSelectRule</c>).</summary>
    public void SelectRule(long id)
    {
        var rule = _rules.FirstOrDefault(r => r.Id == id);
        if (rule is null)
        {
            return;
        }

        _selectedId = id;
        _editor = AlertStudioEditor.FromRule(rule);
        _formError = null;
        Reproject();
    }

    /// <summary>Reset the editor to a fresh new rule (web <c>handleNewRule</c>).</summary>
    public void NewRule()
    {
        _selectedId = null;
        _editor = AlertStudioEditor.Fresh();
        _formError = null;
        Reproject();
    }

    /// <summary>Clone a template into a fresh editor (web <c>handleCloneTemplate</c>).</summary>
    public void CloneTemplate(int index)
    {
        if (index < 0 || index >= AlertStudioCatalog.Templates.Count)
        {
            return;
        }

        _selectedId = null;
        _editor = AlertStudioEditor.FromTemplate(AlertStudioCatalog.Templates[index]);
        _showTemplates = false;
        _formError = null;
        Reproject();
    }

    /// <summary>Save (create / update) the current editor rule (web <c>handleSave</c>).</summary>
    public async Task SaveAsync(CancellationToken cancellationToken = default)
    {
        if (!AlertStudioProjection.CanSave(_editor, _selectedId is null, _metrics))
        {
            return;
        }

        var payload = AlertStudioPayload.BuildSave(_editor);
        _savePending = true;
        Reproject();
        try
        {
            await _feed.SaveRuleAsync(_editor.Id, payload, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _savePending = false;
            return;
        }
        catch (Exception ex)
        {
            _savePending = false;
            _formError = ex.Message;
            Reproject();
            return;
        }

        _savePending = false;
        _selectedId = null;
        _editor = AlertStudioEditor.Fresh();
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Delete a rule (web <c>handleDelete</c>), clearing the editor when it was the open rule.</summary>
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            ct => _feed.DeleteRuleAsync(id, ct),
            () =>
            {
                if (_selectedId == id)
                {
                    _selectedId = null;
                    _editor = AlertStudioEditor.Fresh();
                }
            },
            cancellationToken);

    /// <summary>Toggle a rule's enabled flag (web <c>toggleRuleMut</c>).</summary>
    public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default) =>
        RunMutationAsync(ct => _feed.ToggleRuleAsync(id, enabled, ct), null, cancellationToken);

    /// <summary>Snooze (or cancel-snooze with 0) a rule (web <c>handleSnooze</c>).</summary>
    public Task SnoozeAsync(long id, int minutes, CancellationToken cancellationToken = default) =>
        RunMutationAsync(
            ct => _feed.SnoozeRuleAsync(id, minutes, ct),
            () => _snoozeTargetId = null,
            cancellationToken);

    /// <summary>Send a test notification for the current editor draft (web <c>handleTest</c>).</summary>
    public async Task TestAsync(CancellationToken cancellationToken = default)
    {
        if (_editor.Name.Trim().Length == 0)
        {
            return;
        }

        var payload = AlertStudioPayload.BuildTest(
            _editor,
            _localizer,
            _testChannelIds,
            _channels.Select(c => c.Id).ToArray());

        try
        {
            await _feed.TestRuleAsync(payload, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded / cancelled — nothing to surface.
        }
        catch (Exception ex)
        {
            _formError = ex.Message;
            Reproject();
        }
    }

    /// <summary>Bulk-enable the supplied ids, then clear + reload (web <c>bulkEnableMut</c>).</summary>
    public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        RunMutationAsync(ct => _feed.BulkEnableAsync(ids, ct), () => _bulkSelected.Clear(), cancellationToken);

    /// <summary>Bulk-disable the supplied ids, then clear + reload (web <c>bulkDisableMut</c>).</summary>
    public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default) =>
        RunMutationAsync(ct => _feed.BulkDisableAsync(ids, ct), () => _bulkSelected.Clear(), cancellationToken);

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

    private async Task LoadRulesAsync(CancellationToken token)
    {
        try
        {
            var rules = await _feed.FetchRulesAsync(token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _rules = rules ?? Array.Empty<AlertStudioRule>();
            _rulesError = false;
            _rulesErrorDetail = null;
            _rulesLoading = false;
            PruneBulkSelection();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _rules = Array.Empty<AlertStudioRule>();
            _rulesError = true;
            _rulesErrorDetail = ex.Message;
            _rulesLoading = false;
            _bulkSelected.Clear();
        }
    }

    private async Task LoadChannelsAsync(CancellationToken token)
    {
        try
        {
            var channels = await _feed.FetchChannelsAsync(token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _channels = channels ?? Array.Empty<AlertStudioChannel>();
            _channelsError = false;
            _channelsLoading = false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _channels = Array.Empty<AlertStudioChannel>();
            _channelsError = true;
            _channelsLoading = false;
        }
    }

    private async Task LoadVehiclesAsync(CancellationToken token)
    {
        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<AlertStudioVehicle>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _vehicles = Array.Empty<AlertStudioVehicle>();
        }
    }

    private async Task LoadMetricsAsync(CancellationToken token)
    {
        try
        {
            var metrics = await _feed.FetchMetricsAsync(token).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            _metrics = metrics ?? Array.Empty<AlertStudioMetric>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _metrics = Array.Empty<AlertStudioMetric>();
        }
    }

    private async Task RunMutationAsync(
        Func<CancellationToken, Task> mutation,
        Action? onSuccess,
        CancellationToken cancellationToken)
    {
        try
        {
            await mutation(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _formError = ex.Message;
            Reproject();
            return;
        }

        onSuccess?.Invoke();
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private void PruneBulkSelection()
    {
        if (_bulkSelected.Count == 0)
        {
            return;
        }

        var present = new HashSet<long>(_rules.Select(r => r.Id));
        _bulkSelected.RemoveWhere(id => !present.Contains(id));
    }

    private AlertStudioModel BuildModel() => new()
    {
        Rules = _rules,
        RulesLoading = _rulesLoading,
        RulesError = _rulesError,
        RulesErrorDetail = _rulesErrorDetail,
        Channels = _channels,
        ChannelsLoading = _channelsLoading,
        ChannelsError = _channelsError,
        Vehicles = _vehicles,
        Metrics = _metrics,
        SelectedId = _selectedId,
        Editor = _editor,
        BulkSelected = _bulkSelected,
        RuleSearch = _ruleSearch,
        TemplateSearch = _templateSearch,
        TemplateCategory = _templateCategory,
        ShowTemplates = _showTemplates,
        SnoozeTargetId = _snoozeTargetId,
        TestChannelIds = _testChannelIds,
        FormError = _formError,
        SavePending = _savePending,
        Now = DateTimeOffset.UtcNow,
    };

    private void Reproject() => Display = AlertStudioProjection.Project(BuildModel(), _localizer);

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

/// <summary>
/// Builds the snake_case wire payloads for the studio's write operations — the native port of the web
/// <c>buildSavePayload</c> / test-target helpers (web AlertStudioPage.tsx). Keys mirror the Go API JSON tags
/// exactly (never camelCase). Pure so the payload shape is asserted headlessly.
/// </summary>
public static class AlertStudioPayload
{
    /// <summary>Build the create / update payload from the editor (web <c>buildSavePayload</c>).</summary>
    public static IReadOnlyDictionary<string, object?> BuildSave(AlertStudioEditor editor)
    {
        ArgumentNullException.ThrowIfNull(editor);
        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["name"] = editor.Name.Trim(),
            ["enabled"] = editor.Enabled,
            ["severity"] = editor.Severity,
            ["cooldown_min"] = editor.CooldownMin,
            ["kind"] = editor.Kind == AlertRuleKindOption.ComputedMetric ? "computed_metric" : "signal",
            ["include_title"] = editor.IncludeTitle,
        };

        if (editor.TriggerMode != TriggerModeOption.Unset)
        {
            body["trigger_mode"] = editor.TriggerMode == TriggerModeOption.Once ? "once" : "repeat";
        }

        body["all_vehicles"] = editor.AllVehicles;
        if (!editor.AllVehicles)
        {
            body["vehicle_ids"] = editor.VehicleIds;
        }

        var template = NormalizeTemplate(editor.MsgTemplate);
        body["msg_template"] = template;

        if (editor.Kind == AlertRuleKindOption.ComputedMetric)
        {
            body["metric_id"] = editor.MetricId;
            body["metric_window"] = editor.MetricWindow;
            body["metric_op"] = editor.MetricOp;
            body["metric_threshold"] = AlertStudioProjection.ParseNumber(editor.MetricThreshold);
        }
        else
        {
            body["signal_name"] = editor.SignalName.Trim();
            body["op"] = editor.Op;
            AddTypedValue(body, editor);
        }

        var max = editor.TriggerMode == TriggerModeOption.Repeat
            ? AlertStudioProjection.ParseMaxFires(editor.MaxFires)
            : null;
        body["max_fires_per_resolution"] = max;

        var (escAfter, escSeverity) = BuildEscalation(editor);
        body["escalation_after_min"] = escAfter;
        body["escalation_severity"] = escSeverity;

        return body;
    }

    /// <summary>Build the test-notification payload (web <c>handleTest</c> + <c>buildTestTarget</c>).</summary>
    public static IReadOnlyDictionary<string, object?> BuildTest(
        AlertStudioEditor editor,
        ILocalizer localizer,
        IReadOnlySet<long>? selectedChannelIds,
        IReadOnlyList<long> allChannelIds)
    {
        ArgumentNullException.ThrowIfNull(editor);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(allChannelIds);

        var message = NormalizeTemplate(editor.MsgTemplate)
            ?? localizer.GetString("notifications.alertStudio.test.defaultMessage", "Test notification from Alert Studio");

        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["name"] = editor.Name.Trim(),
            ["severity"] = editor.Severity,
            ["message"] = message,
            ["include_title"] = editor.IncludeTitle,
        };

        if (allChannelIds.Count > 0)
        {
            if (selectedChannelIds is null)
            {
                body["all_channels"] = true;
            }
            else
            {
                body["channel_ids"] = selectedChannelIds.ToArray();
            }
        }

        return body;
    }

    private static void AddTypedValue(Dictionary<string, object?> body, AlertStudioEditor editor)
    {
        var signalType = AlertStudioCatalog.SignalTypeForName(editor.SignalName, editor.ValueKind);
        switch (AlertStudioCatalog.ValueKindFor(signalType, editor.Op))
        {
            case AlertValueKind.Number:
                body["value_num"] = AlertStudioProjection.ParseNumber(editor.ValueNum);
                break;
            case AlertValueKind.Text:
                body["value_text"] = editor.ValueText;
                break;
            case AlertValueKind.Bool:
                body["value_bool"] = editor.ValueBool;
                break;
            case AlertValueKind.Range:
                body["value_min"] = AlertStudioProjection.ParseNumber(editor.ValueMin);
                body["value_max"] = AlertStudioProjection.ParseNumber(editor.ValueMax);
                break;
            default:
                break;
        }
    }

    private static (int? After, string? Severity) BuildEscalation(AlertStudioEditor editor)
    {
        if (editor.TriggerMode != TriggerModeOption.Repeat || !editor.EscalationEnabled)
        {
            return (null, null);
        }

        var after = AlertStudioProjection.ParseMaxFires(editor.EscalationAfter);
        if (after is null || editor.EscalationSeverity.Length == 0)
        {
            return (null, null);
        }

        return (after, editor.EscalationSeverity);
    }

    private static string? NormalizeTemplate(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}

using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The editor working-state — the native mirror of the web <c>EditorState</c> (web AlertStudioPage.tsx). Pure
/// value so the projection + the canSave gate are asserted headlessly. Numeric operands are kept as strings (as
/// the web does) because the input emits strings and the user may type partial values.
/// </summary>
public sealed record AlertStudioEditor
{
    /// <summary>The persisted rule id, or null for a new rule (web <c>editor.id</c>).</summary>
    public long? Id { get; init; }

    public string Name { get; init; } = string.Empty;
    public bool Enabled { get; init; } = true;
    public bool AllVehicles { get; init; } = true;
    public IReadOnlyList<long> VehicleIds { get; init; } = Array.Empty<long>();
    public AlertRuleKindOption Kind { get; init; } = AlertRuleKindOption.Signal;
    public string SignalName { get; init; } = string.Empty;
    public string Op { get; init; } = "=";
    public AlertValueKind ValueKind { get; init; } = AlertValueKind.Number;
    public string ValueNum { get; init; } = string.Empty;
    public string ValueText { get; init; } = string.Empty;
    public bool ValueBool { get; init; } = true;
    public string ValueMin { get; init; } = string.Empty;
    public string ValueMax { get; init; } = string.Empty;
    public string Severity { get; init; } = "warn";
    public int CooldownMin { get; init; } = AlertStudioRegistration.DefaultCooldownMinutes;
    public TriggerModeOption TriggerMode { get; init; } = TriggerModeOption.Unset;
    public string MaxFires { get; init; } = string.Empty;
    public bool EscalationEnabled { get; init; }
    public string EscalationAfter { get; init; } = string.Empty;
    public string EscalationSeverity { get; init; } = string.Empty;
    public string MsgTemplate { get; init; } = string.Empty;
    public bool IncludeTitle { get; init; } = true;
    public string MetricId { get; init; } = string.Empty;
    public string MetricWindow { get; init; } = string.Empty;
    public string MetricOp { get; init; } = ">";
    public string MetricThreshold { get; init; } = string.Empty;

    /// <summary>A blank new-rule editor (web <c>freshEditor()</c>).</summary>
    public static AlertStudioEditor Fresh() => new();

    /// <summary>Hydrate the editor from a persisted rule (web <c>ruleToEditor</c>).</summary>
    public static AlertStudioEditor FromRule(AlertStudioRule rule)
    {
        ArgumentNullException.ThrowIfNull(rule);
        var severity = AlertStudioCatalog.NormalizeSeverity(rule.Severity);
        var signalType = AlertStudioCatalog.SignalTypeForName(rule.SignalName, AlertValueKind.Number);
        var op = AlertStudioCatalog.CoerceOperator(rule.Op, signalType);
        return new AlertStudioEditor
        {
            Id = rule.Id,
            Name = rule.Name,
            Enabled = rule.Enabled,
            SignalName = rule.SignalName,
            Op = op,
            ValueKind = AlertStudioCatalog.ValueKindFor(signalType, op),
            Severity = severity,
            TriggerMode = AlertStudioCatalog.NormalizeTriggerMode(rule.TriggerMode) == "once"
                ? TriggerModeOption.Once
                : TriggerModeOption.Repeat,
        };
    }

    /// <summary>Hydrate the editor from a built-in template (web <c>templateToEditor</c>).</summary>
    public static AlertStudioEditor FromTemplate(AlertRuleTemplate template)
    {
        ArgumentNullException.ThrowIfNull(template);
        var signalType = AlertStudioCatalog.SignalTypeForName(template.SignalName, AlertValueKind.Number);
        var op = AlertStudioCatalog.CoerceOperator(template.Op, signalType);
        return new AlertStudioEditor
        {
            Name = template.Name,
            SignalName = template.SignalName,
            Op = op,
            ValueKind = AlertStudioCatalog.ValueKindFor(signalType, op),
            ValueNum = template.ValueNum is { } n ? n.ToString(CultureInfo.InvariantCulture) : string.Empty,
            ValueText = template.ValueText ?? string.Empty,
            ValueBool = template.ValueBool ?? true,
            ValueMin = template.ValueMin is { } lo ? lo.ToString(CultureInfo.InvariantCulture) : string.Empty,
            ValueMax = template.ValueMax is { } hi ? hi.ToString(CultureInfo.InvariantCulture) : string.Empty,
            Severity = AlertStudioCatalog.NormalizeSeverity(template.Severity),
            CooldownMin = template.CooldownMinutes,
            MsgTemplate = template.Message,
        };
    }
}

/// <summary>A select option (value + display label + disabled flag) — mirrors a web <c>&lt;option&gt;</c>.</summary>
public sealed record AlertStudioSelectOption(string Value, string Label, bool Disabled = false);

/// <summary>One projected rule-list row (web rule card in the left column).</summary>
public sealed record AlertStudioRuleRow(
    long Id,
    string Name,
    string Severity,
    bool Enabled,
    bool IsSelected,
    bool IsActive,
    bool ShowOnceBadge,
    bool Snoozed,
    string SnoozeBadgeText,
    string SignalOpText,
    string SelectRowLabel,
    string ToggleLabel,
    string SnoozeLabel,
    string AutomationName);

/// <summary>One projected template card (web template tile in the gallery).</summary>
public sealed record AlertStudioTemplateCard(
    int Index,
    string Name,
    string Message,
    string Severity,
    string SeverityLabel,
    string AutomationName);

/// <summary>One projected channel chip (web test-target channel button).</summary>
public sealed record AlertStudioChannelChip(long Id, string Label, bool IsSelected);

/// <summary>
/// The render-time data model the <c>AlertStudioPage</c> projects from — the native analogue of the web page's
/// resolved queries + editor state (web AlertStudioPage.tsx). Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record AlertStudioModel
{
    public IReadOnlyList<AlertStudioRule> Rules { get; init; } = Array.Empty<AlertStudioRule>();
    public bool RulesLoading { get; init; } = true;
    public bool RulesError { get; init; }
    public string? RulesErrorDetail { get; init; }
    public IReadOnlyList<AlertStudioChannel> Channels { get; init; } = Array.Empty<AlertStudioChannel>();
    public bool ChannelsLoading { get; init; } = true;
    public bool ChannelsError { get; init; }
    public IReadOnlyList<AlertStudioVehicle> Vehicles { get; init; } = Array.Empty<AlertStudioVehicle>();
    public IReadOnlyList<AlertStudioMetric> Metrics { get; init; } = Array.Empty<AlertStudioMetric>();
    public long? SelectedId { get; init; }
    public AlertStudioEditor Editor { get; init; } = AlertStudioEditor.Fresh();
    public IReadOnlySet<long> BulkSelected { get; init; } = new HashSet<long>();
    public string RuleSearch { get; init; } = string.Empty;
    public string TemplateSearch { get; init; } = string.Empty;
    public string? TemplateCategory { get; init; }
    public bool ShowTemplates { get; init; }
    public long? SnoozeTargetId { get; init; }
    public IReadOnlySet<long>? TestChannelIds { get; init; }
    public string? FormError { get; init; }
    public bool SavePending { get; init; }
    public DateTimeOffset Now { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>The initial pre-fetch model — loading, no rows, a fresh editor.</summary>
    public static AlertStudioModel Initial { get; } = new();
}

/// <summary>
/// The fully projected, render-ready view of the <c>AlertStudioPage</c> — everything the WinUI view needs to draw
/// every region with no further logic (web AlertStudioPage.tsx). Pure value so every field is asserted without a
/// UI host.
/// </summary>
public sealed record AlertStudioDisplay
{
    public required AlertStudioState State { get; init; }
    public required AlertStudioStrings Strings { get; init; }

    public bool RulesLoading { get; init; }
    public bool RulesHasError { get; init; }
    public bool RulesEmpty { get; init; }
    public bool RulesHasRows { get; init; }
    public string RulesErrorText { get; init; } = string.Empty;

    public bool ShowTemplates { get; init; }
    public string TemplatesHeaderText { get; init; } = string.Empty;
    public string TemplatesAllChipLabel { get; init; } = string.Empty;
    public IReadOnlyList<AlertStudioSelectOption> TemplateCategoryChips { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public string? ActiveTemplateCategory { get; init; }
    public IReadOnlyList<AlertStudioTemplateCard> TemplateCards { get; init; } = Array.Empty<AlertStudioTemplateCard>();
    public bool TemplatesEmpty { get; init; }

    public string RulesCountText { get; init; } = string.Empty;
    public bool ShowRuleSearch { get; init; }
    public bool ShowRulesNoMatches { get; init; }
    public IReadOnlyList<AlertStudioRuleRow> RuleRows { get; init; } = Array.Empty<AlertStudioRuleRow>();
    public IReadOnlyList<long> BulkSelectedIds { get; init; } = Array.Empty<long>();
    public int FilteredRuleCount { get; init; }

    public bool IsEditing { get; init; }
    public string EditorTitle { get; init; } = string.Empty;
    public AlertStudioEditor Editor { get; init; } = AlertStudioEditor.Fresh();
    public IReadOnlyList<AlertStudioSelectOption> VehicleOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public bool HasFormError { get; init; }
    public string FormErrorText { get; init; } = string.Empty;

    public IReadOnlyList<AlertStudioSelectOption> SeverityOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public IReadOnlyList<AlertStudioSelectOption> EnabledOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public IReadOnlyList<AlertStudioSelectOption> BoolOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public IReadOnlyList<AlertStudioSelectOption> BehaviorOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public IReadOnlyList<AlertStudioSelectOption> OperatorOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public IReadOnlyList<AlertStudioSelectOption> SignalOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();
    public IReadOnlyList<AlertStudioSelectOption> EscalationSeverityOptions { get; init; } = Array.Empty<AlertStudioSelectOption>();

    public bool ShowComputedMetric { get; init; }
    public bool ShowSignalFields { get; init; }
    public bool ShowAllowedOperators { get; init; }
    public string AllowedOperatorsText { get; init; } = string.Empty;
    public bool ShowTypedValue { get; init; }
    public AlertValueKind ValueEditorKind { get; init; }
    public bool ShowSignalTypeHint { get; init; }
    public string SignalTypeHintText { get; init; } = string.Empty;

    public bool ShowRecommendBanner { get; init; }
    public string RecommendBannerText { get; init; } = string.Empty;
    public string RecommendBannerAltText { get; init; } = string.Empty;
    public bool TriggerModeBlocked { get; init; }
    public bool ShowTriggerHint { get; init; }
    public string TriggerHintText { get; init; } = string.Empty;
    public bool ShowMaxFires { get; init; }
    public bool ShowEscalation { get; init; }
    public bool ShowEscalationFields { get; init; }

    public bool CanSave { get; init; }
    public bool SavePending { get; init; }
    public string SaveLabel { get; init; } = string.Empty;
    public bool ShowDeleteButton { get; init; }
    public bool TestEnabled { get; init; }

    public bool ChannelsLoading { get; init; }
    public bool ChannelsHasError { get; init; }
    public bool ChannelsEmpty { get; init; }
    public bool ChannelsHasList { get; init; }
    public IReadOnlyList<AlertStudioChannelChip> ChannelChips { get; init; } = Array.Empty<AlertStudioChannelChip>();

    public bool SnoozeOpen { get; init; }
    public long? SnoozeTargetId { get; init; }
    public string SnoozeTitleText { get; init; } = string.Empty;
    public bool SnoozeTargetActive { get; init; }
    public string SnoozeCurrentlyText { get; init; } = string.Empty;

    public string Title { get; init; } = string.Empty;
    public string Subtitle { get; init; } = string.Empty;
}

/// <summary>
/// Pure projection from the resolved queries + editor state to the render-ready <see cref="AlertStudioDisplay"/>
/// — the native port of the web page body (web AlertStudioPage.tsx). Selects the rules top-level state in the web
/// precedence order (loading → error → empty → list), resolves every visible string, projects the rule rows,
/// template cards, channel chips and editor option lists, computes the value-editor kind + the alert-behavior
/// recommendation, and evaluates the canSave gate. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AlertStudioProjection
{
    /// <summary>The em-dash shown for a blank value (web <c>{value || '—'}</c> idiom).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project the model into the render-ready display, resolving every visible string.</summary>
    public static AlertStudioDisplay Project(AlertStudioModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = AlertStudioStrings.Resolve(localizer);
        var rules = model.Rules ?? Array.Empty<AlertStudioRule>();
        var state = SelectState(model, rules.Count);
        var editor = model.Editor ?? AlertStudioEditor.Fresh();
        var isEditing = model.SelectedId is not null;
        var isNewRule = model.SelectedId is null;

        var filteredRules = FilterRules(rules, model.RuleSearch);
        var bulkSelected = model.BulkSelected ?? new HashSet<long>();
        var ruleRows = filteredRules.Select(r => ProjectRow(r, model, s)).ToArray();
        var templateCards = TemplateCards(model, s);

        var signalType = AlertStudioCatalog.SignalTypeForName(editor.SignalName, editor.ValueKind);
        var operatorOptions = AlertStudioCatalog.AllowedOperators(signalType)
            .Select(op => new AlertStudioSelectOption(op, op))
            .ToArray();
        var severityOptions = SeverityOptions(s);

        var valueEditorKind = AlertStudioCatalog.ValueKindFor(signalType, editor.Op);
        var hasSignal = editor.SignalName.Trim().Length > 0;
        var signalDef = AlertStudioCatalog.FindSignal(editor.SignalName);
        bool showComputed = editor.Kind == AlertRuleKindOption.ComputedMetric;

        var recommended = RecommendedTriggerMode(editor.Op);
        bool showRecommend = isNewRule
            && editor.TriggerMode == TriggerModeOption.Unset
            && editor.Kind == AlertRuleKindOption.Signal
            && hasSignal;
        bool triggerBlocked = isNewRule && editor.TriggerMode == TriggerModeOption.Unset;

        return new AlertStudioDisplay
        {
            State = state,
            Strings = s,
            Title = AlertStudioRegistration.Title(localizer),
            Subtitle = AlertStudioRegistration.Subtitle(localizer),

            RulesLoading = state == AlertStudioState.Loading,
            RulesHasError = state == AlertStudioState.Error,
            RulesEmpty = state == AlertStudioState.Empty,
            RulesHasRows = state == AlertStudioState.Success,
            RulesErrorText = ErrorText(model.RulesErrorDetail, localizer),

            ShowTemplates = model.ShowTemplates,
            TemplatesHeaderText = Interp(s.TemplatesHeader, "count", AlertStudioCatalog.Templates.Count.ToString(CultureInfo.CurrentCulture)),
            TemplatesAllChipLabel = string.Create(CultureInfo.CurrentCulture, $"{s.TemplatesAllCategory} ({AlertStudioCatalog.Templates.Count})"),
            TemplateCategoryChips = CategoryChips(),
            ActiveTemplateCategory = model.TemplateCategory,
            TemplateCards = templateCards,
            TemplatesEmpty = templateCards.Length == 0,

            RulesCountText = RulesCountText(rules.Count, s),
            ShowRuleSearch = rules.Count > 3,
            ShowRulesNoMatches = !model.RulesLoading && rules.Count > 0 && filteredRules.Count == 0,
            RuleRows = ruleRows,
            BulkSelectedIds = bulkSelected.ToArray(),
            FilteredRuleCount = filteredRules.Count,

            IsEditing = isEditing,
            EditorTitle = isEditing ? s.EditorEditTitle : s.EditorNewTitle,
            Editor = editor,
            VehicleOptions = (model.Vehicles ?? Array.Empty<AlertStudioVehicle>())
                .Select(v => new AlertStudioSelectOption(
                    v.Id.ToString(CultureInfo.InvariantCulture),
                    string.IsNullOrEmpty(v.DisplayName) ? v.Id.ToString(CultureInfo.InvariantCulture) : v.DisplayName))
                .ToArray(),
            HasFormError = !string.IsNullOrEmpty(model.FormError),
            FormErrorText = model.FormError ?? string.Empty,

            SeverityOptions = severityOptions,
            EnabledOptions = new[]
            {
                new AlertStudioSelectOption("true", s.EditorEnabled),
                new AlertStudioSelectOption("false", s.EditorDisabled),
            },
            BoolOptions = new[]
            {
                new AlertStudioSelectOption("true", s.BooleanTrue),
                new AlertStudioSelectOption("false", s.BooleanFalse),
            },
            BehaviorOptions = new[]
            {
                new AlertStudioSelectOption(string.Empty, s.AlertBehaviorPrompt, Disabled: true),
                new AlertStudioSelectOption("repeat", s.AlertBehaviorRepeatLabel),
                new AlertStudioSelectOption("once", s.AlertBehaviorOnceLabel),
            },
            OperatorOptions = operatorOptions,
            SignalOptions = SignalOptions(editor, signalType, s),
            EscalationSeverityOptions = EscalationSeverityOptions(editor.Severity, severityOptions, s),

            ShowComputedMetric = showComputed,
            ShowSignalFields = !showComputed,
            ShowAllowedOperators = !showComputed,
            AllowedOperatorsText = hasSignal
                ? string.Join("  ", operatorOptions.Select(o => o.Label))
                : s.AllowedOperatorsPrompt,
            ShowTypedValue = !showComputed,
            ValueEditorKind = valueEditorKind,
            ShowSignalTypeHint = signalDef is not null || hasSignal,
            SignalTypeHintText = SignalTypeHintText(editor, signalType, s),

            ShowRecommendBanner = showRecommend,
            RecommendBannerText = Interp(
                s.AlertBehaviorRecommendBanner,
                ("op", editor.Op),
                ("recommended", recommended == TriggerModeOption.Once ? s.AlertBehaviorOnceLabel : s.AlertBehaviorRepeatLabel)),
            RecommendBannerAltText = Interp(
                s.AlertBehaviorRecommendBannerAlt,
                "alternative",
                recommended == TriggerModeOption.Once ? s.AlertBehaviorRepeatLabel : s.AlertBehaviorOnceLabel),
            TriggerModeBlocked = triggerBlocked,
            ShowTriggerHint = !triggerBlocked && editor.TriggerMode != TriggerModeOption.Unset,
            TriggerHintText = editor.TriggerMode == TriggerModeOption.Once
                ? s.AlertBehaviorOnceDesc
                : Interp(s.AlertBehaviorRepeatDesc, "cooldown", editor.CooldownMin.ToString(CultureInfo.CurrentCulture)),
            ShowMaxFires = editor.TriggerMode == TriggerModeOption.Repeat,
            ShowEscalation = editor.TriggerMode == TriggerModeOption.Repeat,
            ShowEscalationFields = editor.EscalationEnabled,

            CanSave = CanSave(editor, isNewRule, model.Metrics ?? Array.Empty<AlertStudioMetric>()),
            SavePending = model.SavePending,
            SaveLabel = model.SavePending ? s.ActionsSaving : isEditing ? s.ActionsUpdateRule : s.ActionsCreateRule,
            ShowDeleteButton = isEditing && editor.Id is not null,
            TestEnabled = editor.Name.Trim().Length > 0,

            ChannelsLoading = model.ChannelsLoading,
            ChannelsHasError = model.ChannelsError,
            ChannelsEmpty = !model.ChannelsLoading && !model.ChannelsError && (model.Channels?.Count ?? 0) == 0,
            ChannelsHasList = !model.ChannelsLoading && !model.ChannelsError && (model.Channels?.Count ?? 0) > 0,
            ChannelChips = ChannelChips(model),

            SnoozeOpen = SnoozeTarget(model) is not null,
            SnoozeTargetId = model.SnoozeTargetId,
            SnoozeTitleText = SnoozeTitleText(model, s),
            SnoozeTargetActive = SnoozeTarget(model) is { } target && AlertStudioCatalog.IsSnoozeActive(target.SnoozedUntil, model.Now),
            SnoozeCurrentlyText = SnoozeCurrentlyText(model, s),
        };
    }

    /// <summary>Select the rules top-level state (web precedence: loading → error → empty → list).</summary>
    public static AlertStudioState SelectState(AlertStudioModel model, int ruleCount)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (model.RulesLoading)
        {
            return AlertStudioState.Loading;
        }

        if (model.RulesError)
        {
            return AlertStudioState.Error;
        }

        return ruleCount == 0 ? AlertStudioState.Empty : AlertStudioState.Success;
    }

    /// <summary>The recommended alert-behavior for an operator (web <c>recommendedTriggerMode</c>).</summary>
    public static TriggerModeOption RecommendedTriggerMode(string op) => op switch
    {
        "=" or "!=" or "changed" => TriggerModeOption.Once,
        _ => TriggerModeOption.Repeat,
    };

    /// <summary>Whether the editor has enough to save (web <c>canSave</c>).</summary>
    public static bool CanSave(AlertStudioEditor editor, bool isNewRule, IReadOnlyList<AlertStudioMetric> metrics)
    {
        ArgumentNullException.ThrowIfNull(editor);
        if (editor.Name.Trim().Length == 0)
        {
            return false;
        }

        if (editor.CooldownMin <= 0)
        {
            return false;
        }

        if (isNewRule && editor.TriggerMode == TriggerModeOption.Unset)
        {
            return false;
        }

        if (!editor.AllVehicles && editor.VehicleIds.Count == 0)
        {
            return false;
        }

        if (editor.EscalationEnabled)
        {
            if (editor.TriggerMode != TriggerModeOption.Repeat)
            {
                return false;
            }

            if (ParseMaxFires(editor.EscalationAfter) is null)
            {
                return false;
            }

            if (editor.EscalationSeverity.Length == 0)
            {
                return false;
            }

            if (AlertStudioCatalog.SeverityRank(editor.EscalationSeverity) <= AlertStudioCatalog.SeverityRank(editor.Severity))
            {
                return false;
            }
        }

        if (editor.Kind == AlertRuleKindOption.ComputedMetric)
        {
            if (editor.MetricId.Length == 0 || editor.MetricWindow.Length == 0 || editor.MetricOp.Length == 0)
            {
                return false;
            }

            return ParseNumber(editor.MetricThreshold) is not null;
        }

        var signalType = AlertStudioCatalog.SignalTypeForName(editor.SignalName, editor.ValueKind);
        return editor.SignalName.Trim().Length > 0
            && AlertStudioCatalog.AllowedOperators(signalType).Contains(editor.Op, StringComparer.Ordinal)
            && HasRequiredTypedValue(editor, signalType);
    }

    /// <summary>Validate a candidate inline name (web <c>maxLength</c> mirror, kept lenient).</summary>
    public static double? ParseNumber(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        return double.TryParse(trimmed, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    /// <summary>Parse the max-fires / escalation-after input (positive integer else null; web <c>parseOptionalMaxFires</c>).</summary>
    public static int? ParseMaxFires(string value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        return int.TryParse(trimmed, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : null;
    }

    private static bool HasRequiredTypedValue(AlertStudioEditor editor, SignalValueType signalType)
    {
        var kind = AlertStudioCatalog.ValueKindFor(signalType, editor.Op);
        return kind switch
        {
            AlertValueKind.None => editor.Op == "changed",
            AlertValueKind.Bool => true,
            AlertValueKind.Text => editor.ValueText.Trim().Length > 0,
            AlertValueKind.Number => ParseNumber(editor.ValueNum) is not null,
            _ => ParseNumber(editor.ValueMin) is { } lo && ParseNumber(editor.ValueMax) is { } hi && lo <= hi,
        };
    }

    private static IReadOnlyList<AlertStudioRule> FilterRules(IReadOnlyList<AlertStudioRule> rules, string search)
    {
        if (string.IsNullOrEmpty(search))
        {
            return rules;
        }

        return rules.Where(r => r.Name.Contains(search, StringComparison.OrdinalIgnoreCase)).ToArray();
    }

    private static AlertStudioRuleRow ProjectRow(AlertStudioRule rule, AlertStudioModel model, AlertStudioStrings s)
    {
        var name = string.IsNullOrEmpty(rule.Name) ? s.RulesUntitled : rule.Name;
        var snoozed = AlertStudioCatalog.IsSnoozeActive(rule.SnoozedUntil, model.Now);
        var triggerMode = AlertStudioCatalog.NormalizeTriggerMode(rule.TriggerMode);
        return new AlertStudioRuleRow(
            Id: rule.Id,
            Name: name,
            Severity: AlertStudioCatalog.NormalizeSeverity(rule.Severity),
            Enabled: rule.Enabled,
            IsSelected: model.BulkSelected?.Contains(rule.Id) ?? false,
            IsActive: model.SelectedId == rule.Id,
            ShowOnceBadge: triggerMode == "once",
            Snoozed: snoozed,
            SnoozeBadgeText: snoozed
                ? Interp(s.SnoozeBadge, "time", FormatTime(rule.SnoozedUntil))
                : string.Empty,
            SignalOpText: string.Create(CultureInfo.CurrentCulture, $"{rule.SignalName} {rule.Op}"),
            SelectRowLabel: Interp(s.RulesSelectRow, "name", name),
            ToggleLabel: rule.Enabled ? s.RulesDisableRule : s.RulesEnableRule,
            SnoozeLabel: snoozed ? s.SnoozeManage : s.SnoozeButton,
            AutomationName: name);
    }

    private static AlertStudioTemplateCard[] TemplateCards(AlertStudioModel model, AlertStudioStrings s)
    {
        IEnumerable<(AlertRuleTemplate Template, int Index)> list =
            AlertStudioCatalog.Templates.Select((t, i) => (t, i));

        if (!string.IsNullOrEmpty(model.TemplateCategory))
        {
            list = list.Where(x => string.Equals(x.Template.Category, model.TemplateCategory, StringComparison.Ordinal));
        }

        if (!string.IsNullOrEmpty(model.TemplateSearch))
        {
            list = list.Where(x =>
                x.Template.Name.Contains(model.TemplateSearch, StringComparison.OrdinalIgnoreCase)
                || x.Template.Message.Contains(model.TemplateSearch, StringComparison.OrdinalIgnoreCase)
                || x.Template.Category.Contains(model.TemplateSearch, StringComparison.OrdinalIgnoreCase));
        }

        return list.Select(x => new AlertStudioTemplateCard(
            Index: x.Index,
            Name: x.Template.Name,
            Message: x.Template.Message,
            Severity: x.Template.Severity,
            SeverityLabel: SeverityLabel(x.Template.Severity, s),
            AutomationName: x.Template.Name)).ToArray();
    }

    private static AlertStudioSelectOption[] CategoryChips() =>
        AlertStudioCatalog.Categories.Select(c =>
        {
            var count = AlertStudioCatalog.Templates.Count(t => string.Equals(t.Category, c, StringComparison.Ordinal));
            return new AlertStudioSelectOption(c, string.Create(CultureInfo.CurrentCulture, $"{c} ({count})"));
        }).ToArray();

    private static AlertStudioSelectOption[] SeverityOptions(AlertStudioStrings s) => new[]
    {
        new AlertStudioSelectOption("info", s.SeverityInfo),
        new AlertStudioSelectOption("warn", s.SeverityWarn),
        new AlertStudioSelectOption("critical", s.SeverityCritical),
    };

    private static List<AlertStudioSelectOption> EscalationSeverityOptions(
        string baseSeverity,
        IReadOnlyList<AlertStudioSelectOption> severityOptions,
        AlertStudioStrings s)
    {
        var list = new List<AlertStudioSelectOption> { new(string.Empty, s.EscalationSeverityPrompt) };
        list.AddRange(severityOptions.Where(o => AlertStudioCatalog.SeverityRank(o.Value) > AlertStudioCatalog.SeverityRank(baseSeverity)));
        return list;
    }

    private static List<AlertStudioSelectOption> SignalOptions(
        AlertStudioEditor editor,
        SignalValueType signalType,
        AlertStudioStrings s)
    {
        var options = AlertStudioCatalog.SignalCatalog.Select(sig => new AlertStudioSelectOption(
            sig.Name,
            Interp(
                s.SignalsOptionLabel,
                ("name", sig.Name),
                ("type", SignalTypeLabel(sig.ValueType, s)),
                ("category", CategoryLabel(sig.Category, s))))).ToList();

        var hasSignal = editor.SignalName.Trim().Length > 0;
        if (hasSignal && AlertStudioCatalog.FindSignal(editor.SignalName) is null)
        {
            options.Insert(0, new AlertStudioSelectOption(
                editor.SignalName,
                Interp(
                    s.SignalsCustomOptionLabel,
                    ("name", editor.SignalName),
                    ("type", SignalTypeLabel(signalType, s)))));
        }

        return options;
    }

    private static string SignalTypeHintText(AlertStudioEditor editor, SignalValueType signalType, AlertStudioStrings s)
    {
        var def = AlertStudioCatalog.FindSignal(editor.SignalName);
        var category = def?.Category ?? AlertStudioCatalog.CustomSignalCategory;
        return Interp(
            s.SignalTypeHint,
            ("type", SignalTypeLabel(def?.ValueType ?? signalType, s)),
            ("category", CategoryLabel(category, s)));
    }

    private static AlertStudioChannelChip[] ChannelChips(AlertStudioModel model)
    {
        var channels = model.Channels ?? Array.Empty<AlertStudioChannel>();
        return channels.Select(ch => new AlertStudioChannelChip(
            ch.Id,
            string.Create(CultureInfo.CurrentCulture, $"{ch.Name} ({ch.Kind})"),
            model.TestChannelIds is null || model.TestChannelIds.Contains(ch.Id))).ToArray();
    }

    private static AlertStudioRule? SnoozeTarget(AlertStudioModel model)
    {
        if (model.SnoozeTargetId is not { } id)
        {
            return null;
        }

        return (model.Rules ?? Array.Empty<AlertStudioRule>()).FirstOrDefault(r => r.Id == id);
    }

    private static string SnoozeTitleText(AlertStudioModel model, AlertStudioStrings s)
    {
        if (SnoozeTarget(model) is not { } target)
        {
            return s.SnoozeButton;
        }

        var name = string.IsNullOrEmpty(target.Name) ? s.RulesUntitled : target.Name;
        return Interp(s.SnoozeTitle, "name", name);
    }

    private static string SnoozeCurrentlyText(AlertStudioModel model, AlertStudioStrings s)
    {
        if (SnoozeTarget(model) is not { } target || !AlertStudioCatalog.IsSnoozeActive(target.SnoozedUntil, model.Now))
        {
            return string.Empty;
        }

        return Interp(s.SnoozeCurrentlySnoozed, "time", FormatTime(target.SnoozedUntil));
    }

    private static string RulesCountText(int count, AlertStudioStrings s) =>
        count == 1 ? s.RulesCountOne : Interp(s.RulesCountMany, "count", count.ToString(CultureInfo.CurrentCulture));

    private static string SeverityLabel(string severity, AlertStudioStrings s) =>
        AlertStudioCatalog.NormalizeSeverity(severity) switch
        {
            "critical" => s.SeverityCritical,
            "warn" => s.SeverityWarn,
            _ => s.SeverityInfo,
        };

    private static string SignalTypeLabel(SignalValueType type, AlertStudioStrings s) => type switch
    {
        SignalValueType.Bool => s.SignalTypeBool,
        SignalValueType.Text => s.SignalTypeText,
        _ => s.SignalTypeNumeric,
    };

    private static string CategoryLabel(string category, AlertStudioStrings s) =>
        string.Equals(category, AlertStudioCatalog.CustomSignalCategory, StringComparison.Ordinal)
            ? s.SignalCategoryCustom
            : category;

    private static string ErrorText(string? detail, ILocalizer localizer) =>
        string.IsNullOrEmpty(detail)
            ? localizer.GetString("errors.generic", "Something went wrong.")
            : detail;

    private static string FormatTime(string? iso)
    {
        if (string.IsNullOrEmpty(iso))
        {
            return EmDash;
        }

        return DateTimeOffset.TryParse(
            iso,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed.ToLocalTime().ToString("g", CultureInfo.CurrentCulture)
            : iso;
    }

    private static string Interp(string template, string token, string value) =>
        template.Replace("{{" + token + "}}", value, StringComparison.Ordinal);

    private static string Interp(string template, params (string Token, string Value)[] tokens)
    {
        var result = template;
        foreach (var (token, value) in tokens)
        {
            result = result.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
        }

        return result;
    }
}

/// <summary>
/// PII-safe diagnostics sink for the <c>AlertStudioPage</c> surface — records the <c>view.opened</c> event
/// (P1/S11 contract). Headless default counts invocations so the view's lifecycle is asserted without a sink.
/// </summary>
public sealed class AlertStudioDiagnostics
{
    /// <summary>The number of times the surface recorded an open (for headless assertions).</summary>
    public int ViewOpenedCount { get; private set; }

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened() => ViewOpenedCount++;
}

using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AlertStudioPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/notifications/pages/AlertStudioPage.tsx): the 125-key i18n coverage, the four data states,
/// the eight panel regions (template gallery, rules list + rows, the editor with its option lists / value-editor
/// kinds / recommendation / canSave gate, the test-target channels), the static template + signal catalog, the
/// view-model's load matrix + editor + mutation flows, the snake_case save / test payloads, and the
/// generated-client feed's request shaping for all eleven web hooks. The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="AlertStudioDisplay"/> flags asserted here.
/// </summary>
public sealed class AlertStudioPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 125 i18n keys the manifest requires the page to resolve (verbatim from the web source).
    private static readonly string[] RequiredStringKeys =
    [
        "bulk.actions.disable", "bulk.actions.enable", "bulk.noun.rule_one",
        "bulk.noun.rule_other", "common.cancel", "common.delete",
        "draft.noun.rule", "forms.discard", "forms.keepEditing",
        "forms.unsavedRule", "forms.unsavedTitle", "forms.unsavedWarning",
        "forms.validationFailed", "notifications.alertStudio.actions.createRule", "notifications.alertStudio.actions.delete",
        "notifications.alertStudio.actions.newRule", "notifications.alertStudio.actions.reset", "notifications.alertStudio.actions.saving",
        "notifications.alertStudio.actions.templates", "notifications.alertStudio.actions.test", "notifications.alertStudio.actions.updateRule",
        "notifications.alertStudio.boolean.false", "notifications.alertStudio.boolean.true", "notifications.alertStudio.channels.alertHistory",
        "notifications.alertStudio.channels.browserToast", "notifications.alertStudio.channels.emptyDescription", "notifications.alertStudio.channels.emptyTitle",
        "notifications.alertStudio.channels.externalChannels", "notifications.alertStudio.channels.testTargetLabel", "notifications.alertStudio.editor.alertBehavior.forceChoose",
        "notifications.alertStudio.editor.alertBehavior.onceDesc", "notifications.alertStudio.editor.alertBehavior.onceLabel", "notifications.alertStudio.editor.alertBehavior.recommendBanner",
        "notifications.alertStudio.editor.alertBehavior.recommendBannerAlt", "notifications.alertStudio.editor.alertBehavior.repeatDesc", "notifications.alertStudio.editor.alertBehavior.repeatLabel",
        "notifications.alertStudio.editor.alertBehaviorLabel", "notifications.alertStudio.editor.alertBehaviorPlaceholder", "notifications.alertStudio.editor.allowedOperatorsLabel",
        "notifications.alertStudio.editor.allowedOperatorsPlaceholder", "notifications.alertStudio.editor.anyChangeDescription", "notifications.alertStudio.editor.booleanValueLabel",
        "notifications.alertStudio.editor.cooldownLabel", "notifications.alertStudio.editor.disabled", "notifications.alertStudio.editor.editTitle",
        "notifications.alertStudio.editor.enabled", "notifications.alertStudio.editor.enabledLabel", "notifications.alertStudio.editor.escalationAfterLabel",
        "notifications.alertStudio.editor.escalationAfterPlaceholder", "notifications.alertStudio.editor.escalationCheckboxLabel", "notifications.alertStudio.editor.escalationHint",
        "notifications.alertStudio.editor.escalationSeverityLabel", "notifications.alertStudio.editor.escalationSeverityPlaceholder", "notifications.alertStudio.editor.kindLabel",
        "notifications.alertStudio.editor.maxFiresHint", "notifications.alertStudio.editor.maxFiresLabel", "notifications.alertStudio.editor.maxFiresPlaceholder",
        "notifications.alertStudio.editor.maxValueLabel", "notifications.alertStudio.editor.minValueLabel", "notifications.alertStudio.editor.nameLabel",
        "notifications.alertStudio.editor.namePlaceholder", "notifications.alertStudio.editor.newTitle", "notifications.alertStudio.editor.noSignalDescription",
        "notifications.alertStudio.editor.noSignalTitle", "notifications.alertStudio.editor.numericValueLabel", "notifications.alertStudio.editor.operatorLabel",
        "notifications.alertStudio.editor.severityLabel", "notifications.alertStudio.editor.signalNameLabel", "notifications.alertStudio.editor.signalNamePlaceholder",
        "notifications.alertStudio.editor.signalTypeHint", "notifications.alertStudio.editor.textValueLabel", "notifications.alertStudio.editor.textValuePlaceholder",
        "notifications.alertStudio.editor.typedValueLabel", "notifications.alertStudio.editor.vehiclesLabel", "notifications.alertStudio.kind.computedMetric",
        "notifications.alertStudio.kind.computedMetricHint", "notifications.alertStudio.kind.signal", "notifications.alertStudio.kind.signalHint",
        "notifications.alertStudio.rules.confirmDelete", "notifications.alertStudio.rules.confirmDeleteTitle", "notifications.alertStudio.rules.countMany",
        "notifications.alertStudio.rules.countOne", "notifications.alertStudio.rules.deleteRule", "notifications.alertStudio.rules.disable",
        "notifications.alertStudio.rules.disableRule", "notifications.alertStudio.rules.emptyDescription", "notifications.alertStudio.rules.emptyTitle",
        "notifications.alertStudio.rules.enable", "notifications.alertStudio.rules.enableRule", "notifications.alertStudio.rules.noMatches",
        "notifications.alertStudio.rules.noMatchesTitle", "notifications.alertStudio.rules.onceMode", "notifications.alertStudio.rules.onceModeHint",
        "notifications.alertStudio.rules.searchPlaceholder", "notifications.alertStudio.rules.selectRow", "notifications.alertStudio.rules.title",
        "notifications.alertStudio.rules.untitled", "notifications.alertStudio.severity.critical", "notifications.alertStudio.severity.info",
        "notifications.alertStudio.severity.warn", "notifications.alertStudio.signalCategories.custom", "notifications.alertStudio.signals.customOptionLabel",
        "notifications.alertStudio.signals.optionLabel", "notifications.alertStudio.signalTypes.bool", "notifications.alertStudio.signalTypes.numeric",
        "notifications.alertStudio.signalTypes.text", "notifications.alertStudio.snooze.1h", "notifications.alertStudio.snooze.24h",
        "notifications.alertStudio.snooze.4h", "notifications.alertStudio.snooze.badge", "notifications.alertStudio.snooze.button",
        "notifications.alertStudio.snooze.cancel", "notifications.alertStudio.snooze.currentlySnoozed", "notifications.alertStudio.snooze.description",
        "notifications.alertStudio.snooze.manage", "notifications.alertStudio.snooze.title", "notifications.alertStudio.subtitle",
        "notifications.alertStudio.templates.allCategory", "notifications.alertStudio.templates.header", "notifications.alertStudio.templates.noMatches",
        "notifications.alertStudio.templates.noMatchesTitle", "notifications.alertStudio.templates.searchPlaceholder", "notifications.alertStudio.templates.use",
        "notifications.alertStudio.test.defaultMessage", "notifications.alertStudio.title",
    ];

    private static AlertStudioRule Rule(
        long id = 1,
        string name = "Battery low",
        string signal = "BatteryLevel",
        string op = "<",
        string severity = "warn",
        bool enabled = true,
        string triggerMode = "repeat",
        string? snoozedUntil = null) =>
        new(id, name, signal, op, severity, enabled, triggerMode, snoozedUntil, "2026-01-01T00:00:00Z");

    private static AlertStudioModel RichModel() => AlertStudioModel.Initial with
    {
        RulesLoading = false,
        ChannelsLoading = false,
        Rules = [Rule(1, enabled: true, triggerMode: "once"), Rule(2, name: "Tire low", signal: "TpmsPressureFl", severity: "critical", enabled: false)],
        Channels = [new AlertStudioChannel(10, "Ops Discord", "discord")],
        Vehicles = [new AlertStudioVehicle(100, "Model 3")],
    };

    // ── i18n key coverage (all 125 manifest strings) ───────────────────────────────

    [Fact]
    public void Resolve_requests_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AlertStudioStrings.Resolve(recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Resolve_requests_exactly_125_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = AlertStudioStrings.Resolve(recorder);

        Assert.Equal(125, recorder.Keys.Distinct().Count());
        Assert.Equal(125, RequiredStringKeys.Length);
    }

    [Fact]
    public void Projection_requests_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = AlertStudioProjection.Project(RichModel(), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states (rules source) ────────────────────────────────────────────

    [Fact]
    public void State_loading_when_rules_in_flight()
    {
        var display = AlertStudioProjection.Project(AlertStudioModel.Initial, Localizer);

        Assert.Equal(AlertStudioState.Loading, display.State);
        Assert.True(display.RulesLoading);
        Assert.False(display.RulesEmpty);
        Assert.False(display.RulesHasRows);
        Assert.False(display.RulesHasError);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rules()
    {
        var model = AlertStudioModel.Initial with { RulesLoading = false };
        var display = AlertStudioProjection.Project(model, Localizer);

        Assert.Equal(AlertStudioState.Empty, display.State);
        Assert.True(display.RulesEmpty);
        Assert.Equal("No alert rules yet", display.Strings.RulesEmptyTitle);
        Assert.Equal("Create your first rule or pick a template above.", display.Strings.RulesEmptyDescription);
    }

    [Fact]
    public void State_error_when_rules_fail()
    {
        var model = AlertStudioModel.Initial with { RulesLoading = false, RulesError = true, RulesErrorDetail = "boom" };
        var display = AlertStudioProjection.Project(model, Localizer);

        Assert.Equal(AlertStudioState.Error, display.State);
        Assert.True(display.RulesHasError);
        Assert.Equal("boom", display.RulesErrorText);
    }

    [Fact]
    public void State_success_when_rules_present()
    {
        var display = AlertStudioProjection.Project(RichModel(), Localizer);

        Assert.Equal(AlertStudioState.Success, display.State);
        Assert.True(display.RulesHasRows);
        Assert.Equal(2, display.RuleRows.Count);
    }

    // ── Channels data states (own loading/error/empty/list) ────────────────────────

    [Fact]
    public void Channels_loading_empty_error_and_list_states()
    {
        var loading = AlertStudioProjection.Project(AlertStudioModel.Initial, Localizer);
        Assert.True(loading.ChannelsLoading);

        var empty = AlertStudioProjection.Project(AlertStudioModel.Initial with { ChannelsLoading = false }, Localizer);
        Assert.True(empty.ChannelsEmpty);
        Assert.Equal("No external channels configured", empty.Strings.ChannelsEmptyTitle);

        var error = AlertStudioProjection.Project(AlertStudioModel.Initial with { ChannelsLoading = false, ChannelsError = true }, Localizer);
        Assert.True(error.ChannelsHasError);

        var list = AlertStudioProjection.Project(RichModel(), Localizer);
        Assert.True(list.ChannelsHasList);
        var chip = Assert.Single(list.ChannelChips);
        Assert.Equal("Ops Discord (discord)", chip.Label);
        Assert.True(chip.IsSelected); // null test-selection == all selected
    }

    // ── Panel: chrome ──────────────────────────────────────────────────────────────

    [Fact]
    public void Chrome_strings_match_web()
    {
        var display = AlertStudioProjection.Project(RichModel(), Localizer);

        Assert.Equal("Alert Studio", display.Title);
        Assert.Equal("Create custom rules from Fleet Telemetry signals", display.Subtitle);
        Assert.Equal("Templates", display.Strings.ActionsTemplates);
        Assert.Equal("New Rule", display.Strings.ActionsNewRule);
    }

    // ── Panel: templates ───────────────────────────────────────────────────────────

    [Fact]
    public void Templates_header_interpolates_catalog_count()
    {
        var display = AlertStudioProjection.Project(RichModel() with { ShowTemplates = true }, Localizer);

        int count = AlertStudioCatalog.Templates.Count;
        Assert.True(display.ShowTemplates);
        Assert.Contains(count.ToString(System.Globalization.CultureInfo.CurrentCulture), display.TemplatesHeaderText);
        Assert.Equal(count, display.TemplateCards.Count);
        Assert.False(display.TemplatesEmpty);
        Assert.Contains(display.TemplateCategoryChips, c => c.Value == "Battery");
    }

    [Fact]
    public void Templates_filter_by_category_and_search()
    {
        var byCategory = AlertStudioProjection.Project(RichModel() with { TemplateCategory = "Battery" }, Localizer);
        Assert.All(byCategory.TemplateCards, c => Assert.StartsWith("Battery", AlertStudioCatalog.Templates[c.Index].Category));

        var noMatch = AlertStudioProjection.Project(RichModel() with { TemplateSearch = "zzz-nope" }, Localizer);
        Assert.Empty(noMatch.TemplateCards);
        Assert.True(noMatch.TemplatesEmpty);
        Assert.Equal("No templates found", noMatch.Strings.TemplatesNoMatchesTitle);
    }

    // ── Panel: rules list ──────────────────────────────────────────────────────────

    [Fact]
    public void Rules_count_text_singular_and_plural()
    {
        var one = AlertStudioProjection.Project(AlertStudioModel.Initial with { RulesLoading = false, Rules = [Rule(1)] }, Localizer);
        Assert.Equal("1 rule", one.RulesCountText);

        var many = AlertStudioProjection.Project(RichModel(), Localizer);
        Assert.Equal("2 rules", many.RulesCountText);
    }

    [Fact]
    public void Rule_row_projects_badges_and_a11y_names()
    {
        var display = AlertStudioProjection.Project(RichModel(), Localizer);
        var onceRow = display.RuleRows[0];

        Assert.Equal("Battery low", onceRow.Name);
        Assert.True(onceRow.ShowOnceBadge);
        Assert.Equal("Select rule Battery low", onceRow.SelectRowLabel);
        Assert.Equal("Disable rule", onceRow.ToggleLabel); // enabled → offers disable
        Assert.Equal("BatteryLevel <", onceRow.SignalOpText);

        var disabledRow = display.RuleRows[1];
        Assert.Equal("Enable rule", disabledRow.ToggleLabel);
    }

    [Fact]
    public void Rule_row_uses_untitled_for_blank_name()
    {
        var model = AlertStudioModel.Initial with { RulesLoading = false, Rules = [Rule(7, name: string.Empty)] };
        var row = Assert.Single(AlertStudioProjection.Project(model, Localizer).RuleRows);

        Assert.Equal("Untitled", row.Name);
    }

    [Fact]
    public void Rule_search_no_matches_flag()
    {
        var model = RichModel() with { RuleSearch = "no-such-rule" };
        var display = AlertStudioProjection.Project(model, Localizer);

        Assert.True(display.ShowRulesNoMatches);
        Assert.Empty(display.RuleRows);
        Assert.Equal("No matching rules", display.Strings.RulesNoMatchesTitle);
    }

    [Fact]
    public void Snooze_active_row_shows_badge()
    {
        var future = System.DateTimeOffset.UtcNow.AddHours(2).ToString("o", System.Globalization.CultureInfo.InvariantCulture);
        var model = AlertStudioModel.Initial with { RulesLoading = false, Rules = [Rule(1, snoozedUntil: future)], Now = System.DateTimeOffset.UtcNow };
        var row = Assert.Single(AlertStudioProjection.Project(model, Localizer).RuleRows);

        Assert.True(row.Snoozed);
        Assert.Contains("Snoozed until", row.SnoozeBadgeText);
        Assert.Equal("Manage snooze", row.SnoozeLabel);
    }

    // ── Panel: editor ──────────────────────────────────────────────────────────────

    [Fact]
    public void Editor_title_switches_new_vs_edit()
    {
        var newRule = AlertStudioProjection.Project(RichModel(), Localizer);
        Assert.Equal("New Rule", newRule.EditorTitle);
        Assert.False(newRule.IsEditing);

        var editing = AlertStudioProjection.Project(RichModel() with { SelectedId = 1 }, Localizer);
        Assert.Equal("Edit Rule", editing.EditorTitle);
        Assert.True(editing.IsEditing);
    }

    [Fact]
    public void Editor_option_lists_match_web()
    {
        var display = AlertStudioProjection.Project(RichModel(), Localizer);

        Assert.Equal(new[] { "Info", "Warning", "Critical" }, display.SeverityOptions.Select(o => o.Label));
        Assert.Equal(new[] { "Enabled", "Disabled" }, display.EnabledOptions.Select(o => o.Label));
        Assert.Equal(new[] { "True", "False" }, display.BoolOptions.Select(o => o.Label));

        // behavior prompt option is disabled and first
        Assert.Equal("\u2014 Choose one \u2014", display.BehaviorOptions[0].Label);
        Assert.True(display.BehaviorOptions[0].Disabled);
    }

    [Fact]
    public void Editor_operator_options_depend_on_signal_value_type()
    {
        // numeric signal → full operator set
        var numeric = AlertStudioProjection.Project(
            RichModel() with { Editor = AlertStudioEditor.Fresh() with { SignalName = "BatteryLevel" } },
            Localizer);
        Assert.Contains("between", numeric.OperatorOptions.Select(o => o.Value));

        // bool signal → scalar set only
        var boolean = AlertStudioProjection.Project(
            RichModel() with { Editor = AlertStudioEditor.Fresh() with { SignalName = "Locked" } },
            Localizer);
        Assert.DoesNotContain("between", boolean.OperatorOptions.Select(o => o.Value));
        Assert.Equal(new[] { "=", "!=", "changed" }, boolean.OperatorOptions.Select(o => o.Value));
    }

    [Theory]
    [InlineData("BatteryLevel", "<", AlertValueKind.Number)]
    [InlineData("BatteryLevel", "between", AlertValueKind.Range)]
    [InlineData("BatteryLevel", "changed", AlertValueKind.None)]
    [InlineData("Locked", "=", AlertValueKind.Bool)]
    [InlineData("DetailedChargeState", "=", AlertValueKind.Text)]
    public void Editor_value_kind_matches_signal_and_op(string signal, string op, AlertValueKind expected)
    {
        var editor = AlertStudioEditor.Fresh() with { SignalName = signal, Op = op };
        var display = AlertStudioProjection.Project(RichModel() with { Editor = editor }, Localizer);

        Assert.Equal(expected, display.ValueEditorKind);
    }

    [Fact]
    public void Editor_allowed_operators_prompt_without_signal()
    {
        var display = AlertStudioProjection.Project(RichModel(), Localizer);
        Assert.Equal("Select a signal to see its operators", display.AllowedOperatorsText);
    }

    [Fact]
    public void Editor_computed_metric_hides_signal_fields()
    {
        var editor = AlertStudioEditor.Fresh() with { Kind = AlertRuleKindOption.ComputedMetric };
        var display = AlertStudioProjection.Project(RichModel() with { Editor = editor }, Localizer);

        Assert.True(display.ShowComputedMetric);
        Assert.False(display.ShowSignalFields);
        Assert.False(display.ShowAllowedOperators);
    }

    [Fact]
    public void Editor_force_choose_blocks_new_rule_until_behavior_picked()
    {
        var display = AlertStudioProjection.Project(RichModel(), Localizer);
        Assert.True(display.TriggerModeBlocked);

        var picked = AlertStudioProjection.Project(
            RichModel() with { Editor = AlertStudioEditor.Fresh() with { TriggerMode = TriggerModeOption.Once } },
            Localizer);
        Assert.False(picked.TriggerModeBlocked);
    }

    [Fact]
    public void Editor_recommend_banner_for_signal_rule()
    {
        var editor = AlertStudioEditor.Fresh() with { SignalName = "BatteryLevel", Op = "<" };
        var display = AlertStudioProjection.Project(RichModel() with { Editor = editor }, Localizer);

        Assert.True(display.ShowRecommendBanner);
        Assert.Contains("Re-alert until resolved", display.RecommendBannerText); // < recommends repeat
    }

    [Fact]
    public void Editor_escalation_only_visible_in_repeat_mode()
    {
        var once = AlertStudioProjection.Project(RichModel() with { Editor = AlertStudioEditor.Fresh() with { TriggerMode = TriggerModeOption.Once } }, Localizer);
        Assert.False(once.ShowEscalation);

        var repeat = AlertStudioProjection.Project(RichModel() with { Editor = AlertStudioEditor.Fresh() with { TriggerMode = TriggerModeOption.Repeat } }, Localizer);
        Assert.True(repeat.ShowEscalation);
        Assert.True(repeat.ShowMaxFires);
    }

    // ── canSave gate ───────────────────────────────────────────────────────────────

    [Fact]
    public void CanSave_requires_name_behavior_and_operand()
    {
        Assert.False(AlertStudioProjection.CanSave(AlertStudioEditor.Fresh(), isNewRule: true, []));

        var valid = AlertStudioEditor.Fresh() with
        {
            Name = "My rule",
            SignalName = "BatteryLevel",
            Op = "<",
            ValueNum = "20",
            TriggerMode = TriggerModeOption.Repeat,
        };
        Assert.True(AlertStudioProjection.CanSave(valid, isNewRule: true, []));
    }

    [Fact]
    public void CanSave_blocks_escalation_downgrade()
    {
        var editor = AlertStudioEditor.Fresh() with
        {
            Name = "r",
            SignalName = "BatteryLevel",
            Op = "<",
            ValueNum = "1",
            Severity = "critical",
            TriggerMode = TriggerModeOption.Repeat,
            EscalationEnabled = true,
            EscalationAfter = "30",
            EscalationSeverity = "warn", // lower than base critical → invalid
        };

        Assert.False(AlertStudioProjection.CanSave(editor, isNewRule: true, []));
    }

    // ── Static catalog + helpers ───────────────────────────────────────────────────

    [Fact]
    public void Catalog_has_every_web_template_and_sorted_categories()
    {
        Assert.Equal(47, AlertStudioCatalog.Templates.Count);
        Assert.Equal(AlertStudioCatalog.Categories.OrderBy(c => c, System.StringComparer.Ordinal), AlertStudioCatalog.Categories);
        Assert.Contains("Battery", AlertStudioCatalog.Categories);
    }

    [Theory]
    [InlineData("info", 1)]
    [InlineData("warn", 2)]
    [InlineData("critical", 3)]
    [InlineData("warning", 2)]
    public void SeverityRank_orders_info_warn_critical(string severity, int rank) =>
        Assert.Equal(rank, AlertStudioCatalog.SeverityRank(severity));

    [Fact]
    public void IsSnoozeActive_respects_now()
    {
        var now = System.DateTimeOffset.Parse("2026-01-01T00:00:00Z", System.Globalization.CultureInfo.InvariantCulture);
        Assert.True(AlertStudioCatalog.IsSnoozeActive("2026-01-01T01:00:00Z", now));
        Assert.False(AlertStudioCatalog.IsSnoozeActive("2025-12-31T23:00:00Z", now));
        Assert.False(AlertStudioCatalog.IsSnoozeActive(null, now));
    }

    // ── Tolerant parsers ───────────────────────────────────────────────────────────

    [Fact]
    public void ParseList_tolerates_partial_and_non_array()
    {
        using var notArray = JsonDocument.Parse("{\"x\":1}");
        Assert.Empty(AlertStudioRule.ParseList(notArray.RootElement));

        using var partial = JsonDocument.Parse("[{\"id\":5,\"name\":\"A\",\"signal_name\":\"s\",\"severity\":\"critical\",\"enabled\":true},{}]");
        var rules = AlertStudioRule.ParseList(partial.RootElement);
        Assert.Equal(2, rules.Count);
        Assert.Equal(5, rules[0].Id);
        Assert.Equal("info", rules[1].Severity); // default
    }

    // ── View-model load matrix + flows ─────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(1), Rule(2)] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AlertStudioState.Success, vm.Display.State);
        Assert.Equal(2, vm.Display.RuleRows.Count);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new AlertStudioPageViewModel(EmptyAlertStudioFeed.Instance, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AlertStudioState.Empty, vm.Display.State);
        Assert.True(vm.Display.RulesEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new FakeAlertStudioFeed { ThrowOnFetch = true };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(AlertStudioState.Error, vm.Display.State);
        Assert.True(vm.Display.RulesHasError);
    }

    [Fact]
    public async Task ViewModel_select_rule_loads_editor()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(9, name: "Existing", severity: "critical")] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        vm.SelectRule(9);

        Assert.True(vm.Display.IsEditing);
        Assert.Equal("Existing", vm.Display.Editor.Name);
        Assert.Equal("Edit Rule", vm.Display.EditorTitle);
    }

    [Fact]
    public async Task ViewModel_clone_template_resets_to_new_rule()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(1)] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        vm.CloneTemplate(0); // "Battery Low (< 20%)"

        Assert.False(vm.Display.IsEditing);
        Assert.Equal(AlertStudioCatalog.Templates[0].Name, vm.Display.Editor.Name);
        Assert.Equal("BatteryLevel", vm.Display.Editor.SignalName);
    }

    [Fact]
    public async Task ViewModel_bulk_enable_calls_feed_then_clears_and_reloads()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(1), Rule(2)] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.ToggleBulkSelect(1, true);
        vm.ToggleBulkSelect(2, true);

        await vm.BulkEnableAsync(vm.SelectedIds);

        Assert.Equal([1L, 2L], feed.LastBulkEnable!.OrderBy(x => x));
        Assert.Empty(vm.SelectedIds);
        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_toggle_and_delete_call_feed()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(5)] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);
        await vm.LoadAsync();

        await vm.ToggleAsync(5, false);
        Assert.Equal((5L, false), feed.LastToggle);

        await vm.DeleteAsync(5);
        Assert.Contains(5L, feed.DeletedIds);
    }

    [Fact]
    public async Task ViewModel_snooze_calls_feed_and_closes_sheet()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(8)] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.OpenSnooze(8);

        await vm.SnoozeAsync(8, 240);

        Assert.Equal((8L, 240), feed.LastSnooze);
        Assert.False(vm.Display.SnoozeOpen);
    }

    [Fact]
    public async Task ViewModel_test_sends_default_message_when_blank_template()
    {
        var feed = new FakeAlertStudioFeed { Rules = [Rule(1)], Channels = [new AlertStudioChannel(3, "C", "discord")] };
        using var vm = new AlertStudioPageViewModel(feed, Localizer);
        await vm.LoadAsync();
        vm.UpdateEditor(e => e with { Name = "My rule" });

        await vm.TestAsync();

        Assert.NotNull(feed.LastTestPayload);
        Assert.Equal("Test notification from Alert Studio", feed.LastTestPayload!["message"]);
        Assert.Equal(true, feed.LastTestPayload["all_channels"]);
    }

    // ── Payload builders ───────────────────────────────────────────────────────────

    [Fact]
    public void BuildSave_emits_snake_case_signal_payload()
    {
        var editor = AlertStudioEditor.Fresh() with
        {
            Name = " My rule ",
            SignalName = "BatteryLevel",
            Op = "<",
            ValueNum = "20",
            Severity = "warn",
            TriggerMode = TriggerModeOption.Repeat,
        };

        var payload = AlertStudioPayload.BuildSave(editor);

        Assert.Equal("My rule", payload["name"]);
        Assert.Equal("signal", payload["kind"]);
        Assert.Equal("BatteryLevel", payload["signal_name"]);
        Assert.Equal("<", payload["op"]);
        Assert.Equal("repeat", payload["trigger_mode"]);
        Assert.Equal(20d, payload["value_num"]);
    }

    [Fact]
    public void BuildSave_computed_metric_threshold_is_numeric()
    {
        var editor = AlertStudioEditor.Fresh() with
        {
            Name = "metric rule",
            Kind = AlertRuleKindOption.ComputedMetric,
            MetricId = "charge_cost",
            MetricWindow = "7d",
            MetricOp = ">",
            MetricThreshold = "12.5",
            TriggerMode = TriggerModeOption.Repeat,
        };

        var payload = AlertStudioPayload.BuildSave(editor);

        Assert.Equal("computed_metric", payload["kind"]);
        Assert.Equal("charge_cost", payload["metric_id"]);
        Assert.Equal(12.5d, payload["metric_threshold"]);
    }

    // ── Generated-client feed (web hooks → endpoints) ──────────────────────────────

    [Fact]
    public async Task ClientFeed_fetch_endpoints_use_correct_operation_ids()
    {
        Assert.Equal("get_api_v1_alerts_rules", await OperationOf(f => f.FetchRulesAsync(default), "[]"));
        Assert.Equal("get_api_v1_notifications", await OperationOf(f => f.FetchChannelsAsync(default), "[]"));
        Assert.Equal("get_api_v1_vehicles", await OperationOf(f => f.FetchVehiclesAsync(default), "[]"));
        Assert.Equal("get_api_v1_alerts_metrics", await OperationOf(f => f.FetchMetricsAsync(default), "[]"));
    }

    [Fact]
    public async Task ClientFeed_create_posts_and_update_puts_with_path()
    {
        var create = new FakeApiClient();
        create.ReturnsValue(Json("{}"));
        await new AlertStudioClientFeed(create).SaveRuleAsync(null, new Dictionary<string, object?> { ["name"] = "n" }, default);
        Assert.Equal("post_api_v1_alerts_rules", Assert.Single(create.Requests).OperationId);

        var update = new FakeApiClient();
        update.ReturnsValue(Json("{}"));
        await new AlertStudioClientFeed(update).SaveRuleAsync(5, new Dictionary<string, object?> { ["name"] = "n" }, default);
        var req = Assert.Single(update.Requests);
        Assert.Equal("put_api_v1_alerts_rules_ruleID", req.OperationId);
        Assert.Equal("5", req.PathParams!["ruleID"]);
    }

    [Fact]
    public async Task ClientFeed_toggle_puts_enabled_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));

        await new AlertStudioClientFeed(api).ToggleRuleAsync(3, false, default);

        var req = Assert.Single(api.Requests);
        Assert.Equal("put_api_v1_alerts_rules_ruleID", req.OperationId);
        Assert.Equal("3", req.PathParams!["ruleID"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(req.Body);
        Assert.Equal(false, body["enabled"]);
    }

    [Fact]
    public async Task ClientFeed_snooze_posts_minutes_with_rule_path()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));

        await new AlertStudioClientFeed(api).SnoozeRuleAsync(7, 60, default);

        var req = Assert.Single(api.Requests);
        Assert.Equal("post_api_v1_alerts_rules_ruleID_snooze", req.OperationId);
        Assert.Equal("7", req.PathParams!["ruleID"]);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(req.Body);
        Assert.Equal(60, body["minutes"]);
    }

    [Fact]
    public async Task ClientFeed_test_and_bulk_use_correct_endpoints()
    {
        var test = new FakeApiClient();
        test.ReturnsValue(Json("{}"));
        await new AlertStudioClientFeed(test).TestRuleAsync(new Dictionary<string, object?> { ["name"] = "n" }, default);
        Assert.Equal("post_api_v1_alerts_test", Assert.Single(test.Requests).OperationId);

        var enable = new FakeApiClient();
        enable.ReturnsValue(Json("{}"));
        await new AlertStudioClientFeed(enable).BulkEnableAsync([1, 2], default);
        var enableReq = Assert.Single(enable.Requests);
        Assert.Equal("post_api_v1_alerts_rules_bulk_enable", enableReq.OperationId);
        var body = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(enableReq.Body);
        Assert.Equal(new long[] { 1, 2 }, Assert.IsAssignableFrom<IReadOnlyList<long>>(body["ids"]));

        var disable = new FakeApiClient();
        disable.ReturnsValue(Json("{}"));
        await new AlertStudioClientFeed(disable).BulkDisableAsync([3], default);
        Assert.Equal("post_api_v1_alerts_rules_bulk_disable", Assert.Single(disable.Requests).OperationId);
    }

    private static async Task<string> OperationOf(System.Func<AlertStudioClientFeed, Task> call, string json)
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json(json));
        await call(new AlertStudioClientFeed(api));
        return Assert.Single(api.Requests).OperationId;
    }

    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement;

    // ── recording / fake doubles ───────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeAlertStudioFeed : IAlertStudioFeed
    {
        public IReadOnlyList<AlertStudioRule> Rules { get; init; } = System.Array.Empty<AlertStudioRule>();

        public IReadOnlyList<AlertStudioChannel> Channels { get; init; } = System.Array.Empty<AlertStudioChannel>();

        public bool ThrowOnFetch { get; init; }

        public int FetchCount { get; private set; }

        public IReadOnlyList<long>? LastBulkEnable { get; private set; }

        public IReadOnlyList<long>? LastBulkDisable { get; private set; }

        public List<long> DeletedIds { get; } = new();

        public (long Id, bool Enabled)? LastToggle { get; private set; }

        public (long Id, int Minutes)? LastSnooze { get; private set; }

        public IReadOnlyDictionary<string, object?>? LastTestPayload { get; private set; }

        public Task<IReadOnlyList<AlertStudioRule>> FetchRulesAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            if (ThrowOnFetch)
            {
                throw new System.InvalidOperationException("boom");
            }

            return Task.FromResult(Rules);
        }

        public Task<IReadOnlyList<AlertStudioChannel>> FetchChannelsAsync(CancellationToken cancellationToken) =>
            Task.FromResult(Channels);

        public Task<IReadOnlyList<AlertStudioVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<AlertStudioVehicle>>(System.Array.Empty<AlertStudioVehicle>());

        public Task<IReadOnlyList<AlertStudioMetric>> FetchMetricsAsync(CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<AlertStudioMetric>>(System.Array.Empty<AlertStudioMetric>());

        public Task SaveRuleAsync(long? id, IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken) =>
            Task.CompletedTask;

        public Task DeleteRuleAsync(long id, CancellationToken cancellationToken)
        {
            DeletedIds.Add(id);
            return Task.CompletedTask;
        }

        public Task ToggleRuleAsync(long id, bool enabled, CancellationToken cancellationToken)
        {
            LastToggle = (id, enabled);
            return Task.CompletedTask;
        }

        public Task SnoozeRuleAsync(long id, int minutes, CancellationToken cancellationToken)
        {
            LastSnooze = (id, minutes);
            return Task.CompletedTask;
        }

        public Task TestRuleAsync(IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken)
        {
            LastTestPayload = payload;
            return Task.CompletedTask;
        }

        public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
        {
            LastBulkEnable = ids.ToList();
            return Task.CompletedTask;
        }

        public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
        {
            LastBulkDisable = ids.ToList();
            return Task.CompletedTask;
        }
    }
}

using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the BulkActionsToolbar surface's UI-thread-free logic — the registration slug +
/// i18n keys/fallbacks (<see cref="BulkActionsToolbarRegistration"/>), the count/total interpolation adapter,
/// the per-state toolbar logic, the variant + confirm-intent projections, the confirm-then-run routing and the
/// per-action pending lifecycle (<see cref="BulkActionsToolbarViewModel"/>), the confirm seam
/// (<see cref="IBulkActionConfirmer"/> with its inert / auto / recording doubles) and the PII-safe
/// diagnostics. Mirrors the web spec one-for-one (web/src/components/data-display/BulkActionsToolbar.tsx,
/// web/src/hooks/useConfirm.ts). The WinUI view (BulkActionsToolbar.cs, which composes a TsGlassPanel +
/// TsBadge + TsButtons + TsConfirmDialog) is exercised by the app build.
/// </summary>
public sealed class BulkActionsToolbarTests
{
    // ── recording doubles ────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private sealed class RecordingConfirmer : IBulkActionConfirmer
    {
        private readonly bool _result;

        public RecordingConfirmer(bool result) => _result = result;

        public List<(BulkActionConfirmation Confirmation, BulkActionConfirmIntent Intent)> Calls { get; } = new();

        public Task<bool> ConfirmAsync(BulkActionConfirmation confirmation, BulkActionConfirmIntent intent)
        {
            Calls.Add((confirmation, intent));
            return Task.FromResult(_result);
        }
    }

    private static BulkActionsToolbarViewModel NewViewModel(
        IReadOnlyList<BulkAction>? actions = null,
        IBulkActionConfirmer? confirmer = null,
        ILocalizer? localizer = null,
        BulkItemNoun? itemNoun = null) =>
        new(
            actions ?? Array.Empty<BulkAction>(),
            confirmer ?? AutoBulkActionConfirmer.Instance,
            localizer ?? PassthroughLocalizer.Instance,
            itemNoun);

    private static IReadOnlyList<BulkSelectionId> Selection(int count)
    {
        var ids = new BulkSelectionId[count];
        for (int i = 0; i < count; i++)
        {
            ids[i] = BulkSelectionId.Number(i + 1);
        }

        return ids;
    }

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("BulkActionsToolbar", BulkActionsToolbarRegistration.Slug);

    [Theory]
    [InlineData(BulkActionsToolbarRegistration.ToolbarLabelKey, "translation.bulk.toolbarLabel")]
    [InlineData(BulkActionsToolbarRegistration.SelectedKey, "translation.bulk.selected")]
    [InlineData(BulkActionsToolbarRegistration.OfTotalKey, "translation.bulk.ofTotal")]
    [InlineData(BulkActionsToolbarRegistration.ClearKey, "translation.bulk.clear")]
    [InlineData(BulkActionsToolbarRegistration.ItemDefaultKey, "translation.bulk.itemDefault")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(BulkActionsToolbarRegistration.ToolbarLabelFallback, "Bulk actions for selected items")]
    [InlineData(BulkActionsToolbarRegistration.SelectedFallback, "{{count}} selected")]
    [InlineData(BulkActionsToolbarRegistration.OfTotalFallback, "of {{total}}")]
    [InlineData(BulkActionsToolbarRegistration.ClearFallback, "Clear selection")]
    [InlineData(BulkActionsToolbarRegistration.ItemDefaultFallback, "item")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    // ── adapter: count / total interpolation (web i18next {{count}} / {{total}}) ──────────────────────────

    [Fact]
    public void FormatSelected_interpolates_the_i18next_count_token() =>
        Assert.Equal("3 selected", BulkActionsToolbarRegistration.FormatSelected("{{count}} selected", 3));

    [Fact]
    public void FormatSelected_interpolates_the_native_positional_token() =>
        Assert.Equal("5 selected", BulkActionsToolbarRegistration.FormatSelected("{0} selected", 5));

    [Fact]
    public void FormatOfTotal_interpolates_the_i18next_total_token() =>
        Assert.Equal("of 27", BulkActionsToolbarRegistration.FormatOfTotal("of {{total}}", 27));

    // ── state: hidden vs visible (web count === 0 ? null) ─────────────────────────────────────────────────

    [Fact]
    public void Toolbar_is_hidden_when_nothing_is_selected()
    {
        BulkActionsToolbarViewModel vm = NewViewModel();

        Assert.Equal(0, vm.Count);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void Toolbar_is_visible_once_something_is_selected()
    {
        BulkActionsToolbarViewModel vm = NewViewModel();

        vm.SetSelection(Selection(2));

        Assert.Equal(2, vm.Count);
        Assert.True(vm.IsVisible);
    }

    [Fact]
    public void Count_label_reads_the_selected_key_with_the_count()
    {
        BulkActionsToolbarViewModel vm = NewViewModel();
        vm.SetSelection(Selection(4));

        Assert.Equal("4 selected", vm.CountLabel);
    }

    // ── state: noun caption (web {itemNoun && ...}) ───────────────────────────────────────────────────────

    [Fact]
    public void Noun_caption_is_hidden_when_no_item_noun_is_supplied()
    {
        BulkActionsToolbarViewModel vm = NewViewModel();
        vm.SetSelection(Selection(2));

        Assert.False(vm.HasNoun);
    }

    [Fact]
    public void Noun_is_singular_when_exactly_one_is_selected()
    {
        BulkActionsToolbarViewModel vm = NewViewModel(itemNoun: new BulkItemNoun("drive", "drives"));
        vm.SetSelection(Selection(1));

        Assert.True(vm.HasNoun);
        Assert.Equal("drive", vm.NounText);
    }

    [Fact]
    public void Noun_is_plural_when_more_than_one_is_selected()
    {
        BulkActionsToolbarViewModel vm = NewViewModel(itemNoun: new BulkItemNoun("drive", "drives"));
        vm.SetSelection(Selection(3));

        Assert.Equal("drives", vm.NounText);
    }

    [Fact]
    public void Noun_default_resolves_the_item_default_key_when_no_item_noun()
    {
        var localizer = new RecordingLocalizer();
        BulkActionsToolbarViewModel vm = NewViewModel(localizer: localizer);
        vm.SetSelection(Selection(2));

        Assert.Equal("item", vm.NounText);
        Assert.Contains("translation.bulk.itemDefault", localizer.RequestedKeys);
    }

    // ── state: "of total" caption (web typeof total === 'number') ─────────────────────────────────────────

    [Fact]
    public void Of_total_caption_is_absent_when_total_is_unknown()
    {
        BulkActionsToolbarViewModel vm = NewViewModel(itemNoun: new BulkItemNoun("drive", "drives"));
        vm.SetSelection(Selection(2));

        Assert.False(vm.HasTotal);
    }

    [Fact]
    public void Of_total_caption_is_present_and_interpolated_when_total_is_known()
    {
        BulkActionsToolbarViewModel vm = NewViewModel(itemNoun: new BulkItemNoun("drive", "drives"));
        vm.SetSelection(Selection(2), total: 27);

        Assert.True(vm.HasTotal);
        Assert.Equal("of 27", vm.OfTotalLabel);
    }

    // ── projection: button variant + confirm intent (web variant mapping) ─────────────────────────────────

    [Theory]
    [InlineData(BulkActionVariant.Default, ButtonVariant.Secondary)]
    [InlineData(BulkActionVariant.Danger, ButtonVariant.Destructive)]
    public void Button_variant_maps_default_to_secondary_and_danger_to_destructive(
        BulkActionVariant variant, ButtonVariant expected)
    {
        var action = new BulkAction("a", "A", _ => Task.CompletedTask, variant);

        Assert.Equal(expected, BulkActionsToolbarViewModel.ButtonVariantFor(action));
    }

    [Theory]
    [InlineData(BulkActionVariant.Default, BulkActionConfirmIntent.Warning)]
    [InlineData(BulkActionVariant.Danger, BulkActionConfirmIntent.Danger)]
    public void Confirm_intent_maps_default_to_warning_and_danger_to_danger(
        BulkActionVariant variant, BulkActionConfirmIntent expected)
    {
        var action = new BulkAction("a", "A", _ => Task.CompletedTask, variant);

        Assert.Equal(expected, BulkActionsToolbarViewModel.ConfirmIntentFor(action));
    }

    [Fact]
    public void Clear_button_uses_the_subtle_variant_for_the_web_ghost_button() =>
        Assert.Equal(ButtonVariant.Subtle, BulkActionsToolbarViewModel.ClearButtonVariant);

    // ── action invocation, pending lifecycle + confirm routing (web runAction) ────────────────────────────

    [Fact]
    public async Task Action_without_confirm_runs_with_the_current_selection()
    {
        IReadOnlyList<BulkSelectionId>? received = null;
        var action = new BulkAction("export", "Export", ids =>
        {
            received = ids;
            return Task.CompletedTask;
        });
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        IReadOnlyList<BulkSelectionId> selection = Selection(3);
        vm.SetSelection(selection);

        await vm.RunActionAsync(action);

        Assert.Same(selection, received);
    }

    [Fact]
    public async Task Action_sets_pending_while_in_flight_and_clears_it_after()
    {
        var gate = new TaskCompletionSource();
        var action = new BulkAction("delete", "Delete", _ => gate.Task);
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        vm.SetSelection(Selection(1));

        Task run = vm.RunActionAsync(action);
        Assert.True(vm.IsActionPending("delete"));

        gate.SetResult();
        await run;

        Assert.False(vm.IsActionPending("delete"));
    }

    [Fact]
    public async Task Action_ignores_reentrant_invocation_while_pending()
    {
        var gate = new TaskCompletionSource();
        int invocations = 0;
        var action = new BulkAction("delete", "Delete", _ =>
        {
            invocations++;
            return gate.Task;
        });
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        vm.SetSelection(Selection(1));

        Task first = vm.RunActionAsync(action);
        Task second = vm.RunActionAsync(action);

        Assert.True(second.IsCompleted);

        gate.SetResult();
        await first;
        await second;

        Assert.Equal(1, invocations);
    }

    [Fact]
    public async Task Confirm_bearing_action_runs_when_the_user_accepts()
    {
        var confirmer = new RecordingConfirmer(result: true);
        bool invoked = false;
        var action = new BulkAction(
            "delete",
            "Delete",
            _ =>
            {
                invoked = true;
                return Task.CompletedTask;
            },
            BulkActionVariant.Danger,
            confirm: new BulkActionConfirmation("Delete drives?", "This cannot be undone."));
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action }, confirmer);
        vm.SetSelection(Selection(2));

        await vm.RunActionAsync(action);

        Assert.True(invoked);
        Assert.Single(confirmer.Calls);
        Assert.Equal(BulkActionConfirmIntent.Danger, confirmer.Calls[0].Intent);
    }

    [Fact]
    public async Task Confirm_bearing_action_is_cancelled_when_the_user_dismisses()
    {
        var confirmer = new RecordingConfirmer(result: false);
        bool invoked = false;
        var action = new BulkAction(
            "delete",
            "Delete",
            _ =>
            {
                invoked = true;
                return Task.CompletedTask;
            },
            confirm: new BulkActionConfirmation("Delete?", "Sure?"));
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action }, confirmer);
        vm.SetSelection(Selection(2));

        await vm.RunActionAsync(action);

        Assert.False(invoked);
        Assert.False(vm.IsActionPending("delete"));
        Assert.Single(confirmer.Calls);
    }

    [Fact]
    public async Task Action_that_throws_leaves_pending_cleared_so_the_user_can_retry()
    {
        var action = new BulkAction("delete", "Delete", _ => Task.FromException(new InvalidOperationException()));
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        vm.SetSelection(Selection(1));

        await Assert.ThrowsAsync<InvalidOperationException>(() => vm.RunActionAsync(action));

        Assert.False(vm.IsActionPending("delete"));
    }

    [Fact]
    public void Invoke_runs_a_synchronously_completing_action()
    {
        bool invoked = false;
        var action = new BulkAction("export", "Export", _ =>
        {
            invoked = true;
            return Task.CompletedTask;
        });
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        vm.SetSelection(Selection(1));

        vm.Invoke(action);

        Assert.True(invoked);
    }

    [Fact]
    public void Disabled_action_is_not_enabled_regardless_of_selection()
    {
        var action = new BulkAction("export", "Export", _ => Task.CompletedTask, disabled: true);
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        vm.SetSelection(Selection(2));

        Assert.False(vm.IsActionEnabled(action));
    }

    // ── events: clear, selection change, action state change ──────────────────────────────────────────────

    [Fact]
    public void Request_clear_raises_the_clear_requested_event()
    {
        BulkActionsToolbarViewModel vm = NewViewModel();
        bool raised = false;
        vm.ClearRequested += (_, _) => raised = true;

        vm.RequestClear();

        Assert.True(raised);
    }

    [Fact]
    public void Set_selection_raises_property_changed_and_selection_changed()
    {
        BulkActionsToolbarViewModel vm = NewViewModel();
        bool propertyChanged = false;
        bool selectionChanged = false;
        vm.PropertyChanged += (_, _) => propertyChanged = true;
        vm.SelectionChanged += (_, _) => selectionChanged = true;

        vm.SetSelection(Selection(1));

        Assert.True(propertyChanged);
        Assert.True(selectionChanged);
    }

    [Fact]
    public async Task Action_state_changed_fires_for_pending_transitions()
    {
        var gate = new TaskCompletionSource();
        var action = new BulkAction("delete", "Delete", _ => gate.Task);
        BulkActionsToolbarViewModel vm = NewViewModel(new[] { action });
        vm.SetSelection(Selection(1));
        var transitions = new List<string>();
        vm.ActionStateChanged += (_, id) => transitions.Add(id);

        Task run = vm.RunActionAsync(action);
        gate.SetResult();
        await run;

        Assert.Equal(new[] { "delete", "delete" }, transitions);
    }

    // ── accessibility: every visible label resolves through the i18n facade (P1/S10) ──────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        BulkActionsToolbarViewModel vm = NewViewModel(localizer: localizer);
        vm.SetSelection(Selection(2));

        Assert.Equal("Bulk actions for selected items", vm.ToolbarLabel);
        Assert.Equal("Clear selection", vm.ClearLabel);
        Assert.Equal("2 selected", vm.CountLabel);

        Assert.Contains("translation.bulk.toolbarLabel", localizer.RequestedKeys);
        Assert.Contains("translation.bulk.clear", localizer.RequestedKeys);
        Assert.Contains("translation.bulk.selected", localizer.RequestedKeys);
    }

    // ── selection id value type (web string | number) ─────────────────────────────────────────────────────

    [Fact]
    public void Selection_id_renders_text_and_number_variants()
    {
        Assert.Equal("abc", BulkSelectionId.Text("abc").ToString());
        Assert.Equal("42", BulkSelectionId.Number(42).ToString());
        Assert.False(BulkSelectionId.Text("1").IsNumber);
        Assert.True(BulkSelectionId.Number(1).IsNumber);
        Assert.NotEqual(BulkSelectionId.Text("1"), BulkSelectionId.Number(1));
    }

    // ── confirm seam doubles (web useConfirm presence/absence) ────────────────────────────────────────────

    [Fact]
    public async Task Inert_confirmer_declines_so_confirm_actions_stay_inert()
    {
        bool result = await InertBulkActionConfirmer.Instance.ConfirmAsync(
            new BulkActionConfirmation("T", "D"), BulkActionConfirmIntent.Danger);

        Assert.False(result);
    }

    [Fact]
    public async Task Auto_confirmer_accepts()
    {
        bool result = await AutoBulkActionConfirmer.Instance.ConfirmAsync(
            new BulkActionConfirmation("T", "D"), BulkActionConfirmIntent.Warning);

        Assert.True(result);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new BulkActionsToolbarDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=BulkActionsToolbar", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}

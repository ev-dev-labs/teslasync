using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the CommandSelectDialog modal-dialog surface's UI-thread-free logic — the option
/// normalisation + label-resolution projection (the cached → projection adapter), the registration slug / default
/// icon / i18n key + fallback contract (which doubles as the Narrator-label source), the state-holder view-model's
/// per-branch flows (normal option list / loading-disabled / defensive empty / select / cancel) and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/system/components/CommandSelectDialog.tsx). The WinUI view
/// itself (CommandSelectDialog.cs) is exercised by the app build.
/// </summary>
public sealed class CommandSelectDialogTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static CommandSelectOption[] SampleOptions() =>
    [
        new("open", "commands.trunk.open", "Open", "Pop the trunk"),
        new("close", "commands.trunk.close", "Close"),
        new("vent", "commands.trunk.vent", "Vent", string.Empty),
    ];

    private static CommandSelectRequest SampleRequest(IEnumerable<CommandSelectOption>? options = null) =>
        new("commands.trunk.title", "Trunk", "which", options ?? SampleOptions(), "\uE7C3");

    // ── Projection: normalisation (web sc.options.map source list) ───────────────────────────────────────

    [Fact]
    public void Normalize_of_null_is_empty() =>
        Assert.Empty(CommandSelectProjection.Normalize(null));

    [Fact]
    public void Normalize_drops_null_entries_and_preserves_order()
    {
        var options = new CommandSelectOption?[]
        {
            new("a", "k.a", "A"),
            null,
            new("b", "k.b", "B"),
        };

        var result = CommandSelectProjection.Normalize(options!);

        Assert.Equal(2, result.Count);
        Assert.Equal("a", result[0].Value);
        Assert.Equal("b", result[1].Value);
    }

    [Fact]
    public void IsEmpty_tracks_the_option_count()
    {
        Assert.True(CommandSelectProjection.IsEmpty(CommandSelectProjection.Normalize(null)));
        Assert.True(CommandSelectProjection.IsEmpty(Array.Empty<CommandSelectOption>()));
        Assert.False(CommandSelectProjection.IsEmpty(CommandSelectProjection.Normalize(SampleOptions())));
    }

    // ── Projection: label resolution (web t(opt.labelKey, opt.labelFallback)) ─────────────────────────────

    [Fact]
    public void Resolve_resolves_the_label_and_keeps_value_and_description()
    {
        var resolved = CommandSelectProjection.Resolve(Localizer, new CommandSelectOption("open", "k.open", "Open", "Pop the trunk"));

        Assert.Equal("open", resolved.Value);
        Assert.Equal("Open", resolved.Label);
        Assert.Equal("Pop the trunk", resolved.Description);
        Assert.True(resolved.HasDescription);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Resolve_hides_an_absent_or_empty_description(string? description)
    {
        var resolved = CommandSelectProjection.Resolve(Localizer, new CommandSelectOption("v", "k.v", "Vent", description));

        Assert.False(resolved.HasDescription); // web {opt.description && …} — empty/undefined hides the sub-line
    }

    [Fact]
    public void ResolveAll_preserves_order_and_resolves_every_label()
    {
        var resolved = CommandSelectProjection.ResolveAll(Localizer, SampleOptions());

        Assert.Equal(3, resolved.Count);
        Assert.Equal(new[] { "Open", "Close", "Vent" }, resolved.Select(o => o.Label).ToArray());
        Assert.Equal(new[] { "open", "close", "vent" }, resolved.Select(o => o.Value).ToArray());
    }

    // ── Registration: slug + icon + i18n fallbacks (the Narrator-label source) ────────────────────────────

    [Fact]
    public void Registration_carries_the_slug_and_default_icon()
    {
        Assert.Equal("CommandSelectDialog", CommandSelectRegistration.Slug);
        Assert.False(string.IsNullOrEmpty(CommandSelectRegistration.DefaultIconGlyph));
    }

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Cancel", CommandSelectRegistration.CancelLabel(Localizer));
        Assert.Equal("No options available", CommandSelectRegistration.EmptyMessage(Localizer));
    }

    [Fact]
    public void Title_and_option_label_resolve_from_the_request_keys()
    {
        var request = SampleRequest();
        Assert.Equal("Trunk", CommandSelectRegistration.Title(Localizer, request));
        Assert.Equal("Open", CommandSelectRegistration.OptionLabel(Localizer, request.Options[0]));
    }

    [Fact]
    public void Cancel_label_routes_through_the_common_cancel_key()
    {
        var recorder = new RecordingLocalizer();

        _ = CommandSelectRegistration.CancelLabel(recorder);

        Assert.Contains("common.cancel", recorder.Keys);
    }

    [Fact]
    public void Empty_message_routes_through_a_commands_select_key()
    {
        var recorder = new RecordingLocalizer();

        _ = CommandSelectRegistration.EmptyMessage(recorder);

        Assert.Contains("commands.select.noOptions", recorder.Keys);
    }

    [Fact]
    public void Every_view_label_routes_through_a_localizer_key()
    {
        var recorder = new RecordingLocalizer();

        var vm = new CommandSelectDialogViewModel(SampleRequest(), recorder);
        _ = vm.Title;
        _ = vm.CancelLabel;
        _ = vm.EmptyMessage;
        _ = vm.Options; // resolves each option label

        Assert.Contains("commands.trunk.title", recorder.Keys);
        Assert.Contains("commands.trunk.open", recorder.Keys);
        Assert.Contains("common.cancel", recorder.Keys);
        Assert.Contains("commands.select.noOptions", recorder.Keys);
    }

    // ── View-model: initial (normal) state ────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_renders_the_resolved_option_list()
    {
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer);

        Assert.Equal("Trunk", vm.Title);
        Assert.Equal("\uE7C3", vm.IconGlyph);
        Assert.Equal("Cancel", vm.CancelLabel);
        Assert.True(vm.HasOptions);
        Assert.False(vm.IsEmpty);
        Assert.Equal(3, vm.Options.Count);
        Assert.False(vm.Loading);
        Assert.True(vm.CanSelect);
    }

    [Fact]
    public void Request_without_an_icon_falls_back_to_the_default_glyph()
    {
        var request = new CommandSelectRequest("k.title", "Title", "p", SampleOptions(), iconGlyph: null);
        var vm = new CommandSelectDialogViewModel(request, Localizer);

        Assert.Equal(CommandSelectRegistration.DefaultIconGlyph, vm.IconGlyph);
    }

    // ── View-model: empty branch (defensive — web always has options) ─────────────────────────────────────

    [Fact]
    public void Empty_request_shows_the_empty_branch()
    {
        var vm = new CommandSelectDialogViewModel(SampleRequest(Array.Empty<CommandSelectOption>()), Localizer);

        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasOptions);
        Assert.Empty(vm.Options);
        Assert.Equal("No options available", vm.EmptyMessage);
    }

    // ── View-model: loading state (web loading disables option buttons) ───────────────────────────────────

    [Fact]
    public void Loading_disables_selection_and_raises_can_select()
    {
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Loading = true;

        Assert.False(vm.CanSelect);
        Assert.Contains(nameof(CommandSelectDialogViewModel.CanSelect), changed);
    }

    // ── View-model: select (web onClick → onSelect(opt.value)) ────────────────────────────────────────────

    [Fact]
    public void Select_emits_the_option_value_and_records()
    {
        var lines = new List<string>();
        var diag = new CommandSelectDiagnostics(lines.Add);
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer, diag);
        string? captured = null;
        int closes = 0;
        vm.SelectRequested += (_, v) => captured = v;
        vm.CloseRequested += (_, _) => closes++;

        bool selected = vm.Select("close");

        Assert.True(selected);
        Assert.Equal("close", captured);
        Assert.Equal(1, diag.OptionsSelected);
        Assert.Equal(0, closes); // a select is not a cancel
    }

    [Fact]
    public void Select_of_an_unknown_value_is_a_no_op()
    {
        var diag = new CommandSelectDiagnostics();
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer, diag);
        int selects = 0;
        vm.SelectRequested += (_, _) => selects++;

        bool selected = vm.Select("not-an-option");

        Assert.False(selected);
        Assert.Equal(0, selects);
        Assert.Equal(0, diag.OptionsSelected);
    }

    [Fact]
    public void Select_while_loading_is_a_no_op()
    {
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer);
        int selects = 0;
        vm.SelectRequested += (_, _) => selects++;
        vm.Loading = true;

        bool selected = vm.Select("open");

        Assert.False(selected);
        Assert.Equal(0, selects);
    }

    // ── View-model: cancel / close (web onClose, never gated) ─────────────────────────────────────────────

    [Fact]
    public void RequestClose_always_raises_close()
    {
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        bool closed = vm.RequestClose();

        Assert.True(closed);
        Assert.Equal(1, closes);
    }

    [Fact]
    public void RequestClose_works_even_while_loading()
    {
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer) { Loading = true };
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        bool closed = vm.RequestClose();

        Assert.True(closed); // web Cancel carries no disabled prop
        Assert.Equal(1, closes);
    }

    // ── View-model: diagnostics on open (web open) ────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_records_the_view_opened_event()
    {
        var lines = new List<string>();
        var diag = new CommandSelectDiagnostics(lines.Add);
        var vm = new CommandSelectDialogViewModel(SampleRequest(), Localizer, diag);

        vm.NotifyOpened();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=CommandSelectDialog", Assert.Single(lines));
    }

    // ── Diagnostics (PII-safe, P1/S11) ────────────────────────────────────────────────────────────────────

    [Fact]
    public void RecordOptionSelected_emits_slug_without_the_chosen_value()
    {
        var lines = new List<string>();
        var diag = new CommandSelectDiagnostics(lines.Add);

        diag.RecordOptionSelected();

        Assert.Equal(1, diag.OptionsSelected);
        Assert.Equal("command.optionSelected slug=CommandSelectDialog", Assert.Single(lines));
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}

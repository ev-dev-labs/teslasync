using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Combobox surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks (<see cref="ComboboxRegistration"/>), the count/overflow interpolation + result-count
/// ternary, the static-array / async-loader option seam (<see cref="IComboboxOptionsSource"/> with its
/// error→empty + cancellation mapping), and the per-state view-model: open/close, type-ahead filtering,
/// the capped visible list + overflow count, wrap-around active descendant, commit / free-text / clear /
/// close-revert, the loading / empty / results projection, the live result-count announcement, and the
/// PII-safe diagnostics (<see cref="ComboboxViewModel"/>, <see cref="ComboboxDiagnostics"/>). Mirrors the web
/// spec one-for-one (web/src/components/forms/Combobox.tsx). The WinUI view (Combobox.cs, which composes the
/// input box + clear/chevron TsButtons + a ProgressRing + a Popup listbox) is exercised by the app build.
/// </summary>
public sealed class ComboboxTests
{
    private const char Zwsp = AnnouncerText.ZeroWidthSpace;

    private static IReadOnlyList<ComboOption> Models =>
    [
        new("3", "Model 3"),
        new("y", "Model Y"),
        new("s", "Model S", Disabled: true),
        new("x", "Model X"),
    ];

    // ── recording double ──────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = new();

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }

    private static ComboboxViewModel NewStatic(
        IReadOnlyList<ComboOption>? options = null,
        ILocalizer? localizer = null,
        IAnnouncerBus? announcer = null,
        bool allowFreeText = false,
        int maxVisibleOptions = ComboboxRegistration.DefaultMaxVisibleOptions) =>
        new(
            new StaticComboboxOptionsSource(options ?? Models),
            localizer ?? PassthroughLocalizer.Instance,
            "Vehicle",
            announcer,
            allowFreeText,
            maxVisibleOptions);

    private static List<string> CaptureAnnouncements(AnnouncerBus bus)
    {
        var captured = new List<string>();
        bus.Subscribe((msg, _) => captured.Add(msg.TrimEnd(Zwsp)));
        return captured;
    }

    // ── registration: diagnostics slug + i18n keys/fallbacks (web verbatim) ───────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Combobox", ComboboxRegistration.Slug);

    [Theory]
    [InlineData(ComboboxRegistration.NoResultsKey, "translation.combobox.noResults")]
    [InlineData(ComboboxRegistration.ResultsCountOneKey, "translation.combobox.resultsCountOne")]
    [InlineData(ComboboxRegistration.ResultsCountKey, "translation.combobox.resultsCount")]
    [InlineData(ComboboxRegistration.LoadingKey, "translation.combobox.loading")]
    [InlineData(ComboboxRegistration.ClearAriaKey, "translation.combobox.clearAria")]
    [InlineData(ComboboxRegistration.CloseListAriaKey, "translation.combobox.closeListAria")]
    [InlineData(ComboboxRegistration.OpenListAriaKey, "translation.combobox.openListAria")]
    [InlineData(ComboboxRegistration.MoreHiddenKey, "translation.combobox.moreHidden")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(ComboboxRegistration.NoResultsFallback, "No results")]
    [InlineData(ComboboxRegistration.ResultsCountOneFallback, "1 result")]
    [InlineData(ComboboxRegistration.ResultsCountFallback, "{{count}} results")]
    [InlineData(ComboboxRegistration.LoadingFallback, "Loading")]
    [InlineData(ComboboxRegistration.ClearAriaFallback, "Clear selection")]
    [InlineData(ComboboxRegistration.CloseListAriaFallback, "Hide options")]
    [InlineData(ComboboxRegistration.OpenListAriaFallback, "Show options")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void MoreHidden_fallback_keeps_the_web_em_dash_copy() =>
        Assert.Equal("{{count}} more \u2014 refine search", ComboboxRegistration.MoreHiddenFallback);

    // ── adapter: count / overflow interpolation (web i18next {{count}}) ───────────────────────────────────

    [Fact]
    public void FormatResultsCount_interpolates_the_i18next_count_token() =>
        Assert.Equal("5 results", ComboboxRegistration.FormatResultsCount("{{count}} results", 5));

    [Fact]
    public void FormatResultsCount_interpolates_the_native_positional_token() =>
        Assert.Equal("5 results", ComboboxRegistration.FormatResultsCount("{0} results", 5));

    [Fact]
    public void FormatMoreHidden_interpolates_both_token_styles()
    {
        Assert.Equal("7 more \u2014 refine search", ComboboxRegistration.FormatMoreHidden("{{count}} more \u2014 refine search", 7));
        Assert.Equal("7 more \u2014 refine search", ComboboxRegistration.FormatMoreHidden("{0} more \u2014 refine search", 7));
    }

    [Theory]
    [InlineData(0, "No results")]
    [InlineData(1, "1 result")]
    [InlineData(4, "4 results")]
    public void ResultsAnnouncement_chooses_the_web_zero_one_many_branch(int count, string expected) =>
        Assert.Equal(
            expected,
            ComboboxRegistration.ResultsAnnouncement(count, "No results", "1 result", "{{count}} results"));

    // ── adapter: static option source (web defaultFilter via the shared ComboboxFilter) ──────────────────

    [Fact]
    public async Task Static_source_is_synchronous_and_filters_case_insensitively()
    {
        var source = new StaticComboboxOptionsSource(Models);

        Assert.False(source.IsAsync);
        Assert.Equal(4, (await source.LoadAsync("  ", CancellationToken.None)).Count);
        Assert.Equal(4, (await source.LoadAsync("model", CancellationToken.None)).Count);

        IReadOnlyList<ComboOption> single = await source.LoadAsync("y", CancellationToken.None);
        Assert.Equal("y", Assert.Single(single).Value);
    }

    // ── adapter: async option source (web loader + error/cancel mapping) ──────────────────────────────────

    [Fact]
    public void Async_source_reports_itself_async() =>
        Assert.True(new AsyncComboboxOptionsSource((_, _) => Task.FromResult<IReadOnlyList<ComboOption>>(Models)).IsAsync);

    [Fact]
    public async Task Async_source_maps_a_null_result_to_an_empty_list()
    {
        var source = new AsyncComboboxOptionsSource((_, _) => Task.FromResult<IReadOnlyList<ComboOption>>(null!));

        Assert.Empty(await source.LoadAsync("q", CancellationToken.None));
    }

    [Fact]
    public async Task Async_source_maps_a_failed_load_to_an_empty_list()
    {
        var source = new AsyncComboboxOptionsSource((_, _) => Task.FromException<IReadOnlyList<ComboOption>>(new InvalidOperationException()));

        Assert.Empty(await source.LoadAsync("q", CancellationToken.None));
    }

    [Fact]
    public async Task Async_source_propagates_cancellation_so_a_stale_result_is_dropped()
    {
        using var cts = new CancellationTokenSource();
        var source = new AsyncComboboxOptionsSource(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return Models;
        });

        Task<IReadOnlyList<ComboOption>> load = source.LoadAsync("q", cts.Token);
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => load);
    }

    // ── state: closed → open (web focus / chevron open) ──────────────────────────────────────────────────

    [Fact]
    public void Static_combobox_seeds_its_filtered_options_and_starts_closed()
    {
        ComboboxViewModel vm = NewStatic();

        Assert.False(vm.IsOpen);
        Assert.Equal(4, vm.VisibleOptions.Count);
        Assert.Equal(-1, vm.ActiveIndex);
    }

    [Fact]
    public async Task Opening_shows_results_and_activates_the_first_option()
    {
        ComboboxViewModel vm = NewStatic();

        await vm.OpenAsync();

        Assert.True(vm.IsOpen);
        Assert.Equal(ComboboxResultStatus.Results, vm.Status);
        Assert.Equal(0, vm.ActiveIndex);
    }

    // ── state: type-ahead filtering + empty (web defaultFilter + "No results") ────────────────────────────

    [Fact]
    public async Task Typing_filters_the_visible_options()
    {
        ComboboxViewModel vm = NewStatic();

        await vm.SetInputTextAsync("Model X");

        Assert.True(vm.IsOpen);
        Assert.Equal("x", Assert.Single(vm.VisibleOptions).Value);
        Assert.Equal(0, vm.ActiveIndex);
    }

    [Fact]
    public async Task A_query_with_no_matches_renders_the_empty_state()
    {
        ComboboxViewModel vm = NewStatic();

        await vm.SetInputTextAsync("zzz");

        Assert.Empty(vm.VisibleOptions);
        Assert.Equal(0, vm.FilteredCount);
        Assert.Equal(ComboboxResultStatus.Empty, vm.Status);
        Assert.Equal(-1, vm.ActiveIndex);
    }

    // ── state: capped list + overflow row (web maxVisibleOptions + "more — refine search") ────────────────

    [Fact]
    public async Task The_list_is_capped_and_reports_the_hidden_overflow_count()
    {
        var many = Enumerable.Range(0, 5).Select(i => new ComboOption($"v{i}", $"Item {i}")).ToList();
        ComboboxViewModel vm = NewStatic(many, maxVisibleOptions: 3);

        await vm.OpenAsync();

        Assert.Equal(3, vm.VisibleOptions.Count);
        Assert.Equal(5, vm.FilteredCount);
        Assert.Equal(2, vm.HiddenCount);
        Assert.True(vm.HasOverflow);
        Assert.Equal("2 more \u2014 refine search", vm.OverflowLabel);
    }

    // ── state: wrap-around active descendant + Home / End (web ArrowUp/ArrowDown/Home/End) ────────────────

    [Fact]
    public async Task Move_active_wraps_around_both_ends()
    {
        ComboboxViewModel vm = NewStatic();
        await vm.OpenAsync();

        Assert.Equal(0, vm.ActiveIndex);
        vm.MoveActive(-1);
        Assert.Equal(3, vm.ActiveIndex); // wrap to last
        vm.MoveActive(1);
        Assert.Equal(0, vm.ActiveIndex); // wrap to first
    }

    [Fact]
    public async Task Home_and_end_jump_to_the_first_and_last_option()
    {
        ComboboxViewModel vm = NewStatic();
        await vm.OpenAsync();

        vm.ActivateLast();
        Assert.Equal(3, vm.ActiveIndex);
        vm.ActivateFirst();
        Assert.Equal(0, vm.ActiveIndex);
    }

    // ── commit: option, disabled-skip, free-text (web commitOption / commitFreeText) ──────────────────────

    [Fact]
    public async Task Committing_an_option_sets_the_selection_closes_and_echoes_the_label()
    {
        ComboboxViewModel vm = NewStatic();
        ComboOption? committed = null;
        vm.SelectionChanged += (_, opt) => committed = opt;
        await vm.SetInputTextAsync("Model X");

        Assert.True(vm.CommitActiveOrFreeText());

        Assert.Equal("x", vm.SelectedValue);
        Assert.Equal("Model X", vm.InputText);
        Assert.False(vm.IsOpen);
        Assert.Equal("x", committed?.Value);
    }

    [Fact]
    public async Task A_disabled_active_option_is_not_committed()
    {
        ComboboxViewModel vm = NewStatic();
        await vm.SetInputTextAsync("Model S"); // the only match is the disabled option

        Assert.Equal("s", Assert.Single(vm.VisibleOptions).Value);
        Assert.False(vm.CommitActiveOrFreeText());
        Assert.Null(vm.SelectedValue);
        Assert.True(vm.IsOpen);
    }

    [Fact]
    public void Commit_option_ignores_a_disabled_option()
    {
        ComboboxViewModel vm = NewStatic();

        vm.CommitOption(new ComboOption("s", "Model S", Disabled: true));

        Assert.Null(vm.SelectedValue);
    }

    [Fact]
    public async Task Free_text_commit_fires_when_allowed_and_no_option_is_active()
    {
        ComboboxViewModel vm = NewStatic(allowFreeText: true);
        string? freeText = null;
        bool selectionCleared = false;
        vm.FreeTextCommitted += (_, text) => freeText = text;
        vm.SelectionChanged += (_, opt) => selectionCleared = opt is null;
        await vm.SetInputTextAsync("custom value"); // no option matches -> no active option

        Assert.True(vm.CommitActiveOrFreeText());

        Assert.Equal("custom value", freeText);
        Assert.True(selectionCleared);
        Assert.False(vm.IsOpen);
    }

    [Fact]
    public async Task Free_text_is_not_committed_when_the_mode_is_off()
    {
        ComboboxViewModel vm = NewStatic(allowFreeText: false);
        await vm.SetInputTextAsync("custom value");

        Assert.False(vm.CommitActiveOrFreeText());
    }

    // ── close / clear (web closeWithoutCommit / handleClear) ──────────────────────────────────────────────

    [Fact]
    public async Task Closing_without_committing_reverts_the_text_to_the_selected_label()
    {
        ComboboxViewModel vm = NewStatic();
        await vm.SetInputTextAsync("Model Y");
        Assert.True(vm.CommitActiveOrFreeText()); // selects Model Y, text = "Model Y"

        await vm.SetInputTextAsync("partial edit"); // reopen + edit
        vm.Close();

        Assert.False(vm.IsOpen);
        Assert.Equal("Model Y", vm.InputText);
    }

    [Fact]
    public async Task Clearing_resets_selection_and_text_then_reopens()
    {
        ComboboxViewModel vm = NewStatic();
        await vm.SetInputTextAsync("Model Y");
        Assert.True(vm.CommitActiveOrFreeText());
        bool cleared = false;
        vm.SelectionChanged += (_, opt) => cleared = opt is null;

        await vm.ClearAsync();

        Assert.Null(vm.SelectedValue);
        Assert.Equal(string.Empty, vm.InputText);
        Assert.True(vm.IsOpen);
        Assert.True(cleared);
        Assert.True(vm.ShowClear is false || vm.InputText.Length == 0);
    }

    [Fact]
    public void Set_selected_option_echoes_the_label_while_closed()
    {
        ComboboxViewModel vm = NewStatic();

        vm.SetSelectedOption(new ComboOption("3", "Model 3"));

        Assert.Equal("3", vm.SelectedValue);
        Assert.Equal("Model 3", vm.InputText);
    }

    // ── disabled gate (web disabled) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_disabled_combobox_does_not_open_or_accept_input()
    {
        ComboboxViewModel vm = NewStatic();
        vm.IsDisabled = true;

        await vm.OpenAsync();
        await vm.SetInputTextAsync("Model 3");

        Assert.False(vm.IsOpen);
        Assert.Equal(string.Empty, vm.InputText);
        Assert.False(vm.ShowClear);
    }

    // ── async loading lifecycle (web loadingProp || asyncLoading) ─────────────────────────────────────────

    [Fact]
    public async Task An_async_load_shows_the_loading_state_then_resolves_to_results()
    {
        var gate = new TaskCompletionSource<IReadOnlyList<ComboOption>>();
        var source = new AsyncComboboxOptionsSource((_, _) => gate.Task);
        var vm = new ComboboxViewModel(source, PassthroughLocalizer.Instance, "Address", asyncDebounceMs: 0);

        Task open = vm.OpenAsync();
        Assert.True(vm.IsLoading);
        Assert.Equal(ComboboxResultStatus.Loading, vm.Status);

        gate.SetResult([new ComboOption("1", "221B Baker Street")]);
        await open;

        Assert.False(vm.IsLoading);
        Assert.Equal(ComboboxResultStatus.Results, vm.Status);
        Assert.Equal("221B Baker Street", Assert.Single(vm.VisibleOptions).Label);
    }

    [Fact]
    public async Task A_superseded_async_keystroke_is_cancelled_and_its_result_dropped()
    {
        int firstCalls = 0;
        var firstGate = new TaskCompletionSource<IReadOnlyList<ComboOption>>();
        var source = new AsyncComboboxOptionsSource((query, ct) =>
        {
            if (query == "a")
            {
                firstCalls++;
                ct.Register(() => firstGate.TrySetCanceled(ct));
                return firstGate.Task;
            }

            return Task.FromResult<IReadOnlyList<ComboOption>>([new ComboOption("b", "Beta")]);
        });
        var vm = new ComboboxViewModel(source, PassthroughLocalizer.Instance, "Address", asyncDebounceMs: 0);

        Task first = vm.SetInputTextAsync("a"); // in-flight
        await vm.SetInputTextAsync("b");        // supersedes -> cancels the first
        await first;

        Assert.Equal(1, firstCalls);
        Assert.False(vm.IsLoading);
        Assert.Equal("Beta", Assert.Single(vm.VisibleOptions).Label);
    }

    // ── announcements (web announce(resultCount)) ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Opening_announces_the_result_count()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        ComboboxViewModel vm = NewStatic(announcer: bus);

        await vm.OpenAsync();

        Assert.Equal("4 results", Assert.Single(announced));
    }

    [Fact]
    public async Task An_empty_query_announces_no_results()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        ComboboxViewModel vm = NewStatic(announcer: bus);
        await vm.OpenAsync();

        await vm.SetInputTextAsync("zzz");

        Assert.Equal("No results", announced[^1]);
    }

    [Fact]
    public async Task A_single_match_announces_the_singular_copy()
    {
        var bus = new AnnouncerBus();
        List<string> announced = CaptureAnnouncements(bus);
        ComboboxViewModel vm = NewStatic(announcer: bus);

        await vm.SetInputTextAsync("Model X");

        Assert.Equal("1 result", announced[^1]);
    }

    // ── accessibility: every label resolves through the i18n facade (P1/S10) ──────────────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        ComboboxViewModel vm = NewStatic(localizer: localizer);

        Assert.Equal("Loading", vm.LoadingLabel);
        Assert.Equal("No results", vm.NoResultsLabel);
        Assert.Equal("Clear selection", vm.ClearLabel);
        Assert.Equal("Show options", vm.ToggleLabel); // closed

        Assert.Contains("translation.combobox.loading", localizer.RequestedKeys);
        Assert.Contains("translation.combobox.noResults", localizer.RequestedKeys);
        Assert.Contains("translation.combobox.clearAria", localizer.RequestedKeys);
        Assert.Contains("translation.combobox.openListAria", localizer.RequestedKeys);
    }

    [Fact]
    public async Task Toggle_label_switches_to_the_close_copy_once_open()
    {
        var localizer = new RecordingLocalizer();
        ComboboxViewModel vm = NewStatic(localizer: localizer);

        await vm.OpenAsync();

        Assert.Equal("Hide options", vm.ToggleLabel);
        Assert.Contains("translation.combobox.closeListAria", localizer.RequestedKeys);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new ComboboxDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=Combobox", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    [Fact]
    public void View_model_rejects_null_construction_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new ComboboxViewModel(null!, PassthroughLocalizer.Instance, "L"));
        Assert.Throws<ArgumentNullException>(() => new ComboboxViewModel(StaticComboboxOptionsSource.Empty, null!, "L"));
        Assert.Throws<ArgumentNullException>(() => new ComboboxViewModel(StaticComboboxOptionsSource.Empty, PassthroughLocalizer.Instance, null!));
    }
}

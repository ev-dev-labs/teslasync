using System.Collections.Generic;
using System.Linq;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the SearchInput surface's UI-thread-free logic — the registration slug + i18n
/// keys/fallbacks + remove-aria interpolation (<see cref="SearchInputRegistration"/>); the pure recent-search
/// adapter with its dedup / cap / trim / resilient-JSON contract (<see cref="SearchHistoryEnvelope"/>); the
/// JSON-backed history store (<see cref="JsonSearchHistoryStore"/> over an in-memory blob); the controlled
/// value + debounce coalescing + dropdown-state machine + history operations + localized labels
/// (<see cref="SearchInputViewModel"/>); and the PII-safe diagnostics (<see cref="SearchInputDiagnostics"/>).
/// Mirrors the web spec one-for-one (web/src/components/forms/SearchInput.tsx + web/src/lib/searchHistory.ts).
/// The WinUI view (SearchInput.cs, which composes the field chrome + a recent-searches Popup + the debounce
/// timer) is exercised by the app build.
/// </summary>
public sealed class SearchInputTests
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

    private sealed class RecordingSearchHistoryStore : ISearchHistoryStore
    {
        private readonly Dictionary<string, List<string>> _scopes = new(StringComparer.Ordinal);

        public List<string> Ops { get; } = new();

        public void Seed(string scope, params string[] entries) => _scopes[scope] = entries.ToList();

        public void Record(string scope, string query)
        {
            Ops.Add($"record:{scope}:{query}");
            List<string> list = _scopes.TryGetValue(scope, out List<string>? existing) ? existing : new List<string>();
            list.RemoveAll(e => string.Equals(e, query, StringComparison.OrdinalIgnoreCase));
            list.Insert(0, query);
            _scopes[scope] = list;
        }

        public IReadOnlyList<string> GetRecent(string scope, int max)
        {
            Ops.Add($"getRecent:{scope}:{max}");
            return _scopes.TryGetValue(scope, out List<string>? list)
                ? list.Take(Math.Max(0, max)).ToList()
                : Array.Empty<string>();
        }

        public void Remove(string scope, string query)
        {
            Ops.Add($"remove:{scope}:{query}");
            if (_scopes.TryGetValue(scope, out List<string>? list))
            {
                list.RemoveAll(e => string.Equals(e, query, StringComparison.OrdinalIgnoreCase));
            }
        }

        public void ClearScope(string scope)
        {
            Ops.Add($"clear:{scope}");
            _scopes.Remove(scope);
        }
    }

    private static SearchInputViewModel NewViewModel(
        ILocalizer? localizer = null,
        ISearchHistoryStore? store = null,
        string? scope = null,
        bool showHistoryOnFocus = true,
        int maxHistory = SearchInputRegistration.DefaultMaxHistory) =>
        new(localizer ?? PassthroughLocalizer.Instance, store, scope, showHistoryOnFocus, maxHistory);

    // ── registration (diagnostics slug + i18n keys/fallbacks, web verbatim) ──────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("SearchInput", SearchInputRegistration.Slug);

    [Theory]
    [InlineData(SearchInputRegistration.ClearKey, "translation.common.clear")]
    [InlineData(SearchInputRegistration.HistoryTitleKey, "translation.search.history.title")]
    [InlineData(SearchInputRegistration.RemoveAriaKey, "translation.search.history.removeAria")]
    [InlineData(SearchInputRegistration.ClearHistoryKey, "translation.search.history.clear")]
    public void I18n_keys_carry_the_translation_prefixed_web_key(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Theory]
    [InlineData(SearchInputRegistration.ClearFallback, "Clear")]
    [InlineData(SearchInputRegistration.HistoryTitleFallback, "Recent searches")]
    [InlineData(SearchInputRegistration.ClearHistoryFallback, "Clear history")]
    public void I18n_fallbacks_match_the_web_english_copy(string actual, string expected) =>
        Assert.Equal(expected, actual);

    [Fact]
    public void Remove_aria_fallback_matches_the_web_template() =>
        Assert.Equal("Remove \"{{query}}\" from search history", SearchInputRegistration.RemoveAriaFallback);

    [Theory]
    [InlineData(250, SearchInputRegistration.DefaultDebounceMs)]
    [InlineData(8, SearchInputRegistration.DefaultMaxHistory)]
    [InlineData(12, SearchInputRegistration.Cap)]
    [InlineData(2, SearchInputRegistration.MinQueryLen)]
    public void Constants_match_the_web_source(int expected, int actual) => Assert.Equal(expected, actual);

    [Fact]
    public void FormatRemoveAria_interpolates_the_i18next_query_token() =>
        Assert.Equal(
            "Remove \"Model 3\" from search history",
            SearchInputRegistration.FormatRemoveAria("Remove \"{{query}}\" from search history", "Model 3"));

    [Fact]
    public void FormatRemoveAria_interpolates_the_native_positional_token() =>
        Assert.Equal(
            "Remove \"Model 3\" from search history",
            SearchInputRegistration.FormatRemoveAria("Remove \"{0}\" from search history", "Model 3"));

    // ── adapter: SearchHistoryEnvelope record / dedup / cap / trim (web recordSearch) ────────────────────

    [Fact]
    public void Record_stores_a_query_and_get_recent_returns_it()
    {
        var env = new SearchHistoryEnvelope();
        Assert.True(env.Record("drives", "model 3", 1));
        Assert.Equal(new[] { "model 3" }, env.GetRecent("drives", 8));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("a")]
    public void Record_ignores_blank_and_shorter_than_minimum_queries(string query)
    {
        var env = new SearchHistoryEnvelope();
        Assert.False(env.Record("drives", query, 1));
        Assert.Empty(env.GetRecent("drives", 8));
    }

    [Fact]
    public void Record_trims_whitespace_before_storing()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "  hello  ", 1);
        Assert.Equal(new[] { "hello" }, env.GetRecent("drives", 8));
    }

    [Fact]
    public void Record_dedupes_case_insensitively_and_promotes_the_newest_casing()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "model 3", 1);
        env.Record("drives", "tesla", 2);
        env.Record("drives", "MODEL 3", 3);

        // web: the prior casefolded match is dropped and the new submission (its casing) takes the top slot.
        Assert.Equal(new[] { "MODEL 3", "tesla" }, env.GetRecent("drives", 8));
    }

    [Fact]
    public void Record_caps_each_scope_at_twelve_newest_first()
    {
        var env = new SearchHistoryEnvelope();
        for (int i = 0; i < 15; i++)
        {
            env.Record("drives", $"query{i:00}", i);
        }

        IReadOnlyList<string> recent = env.GetRecent("drives", SearchInputRegistration.Cap);
        Assert.Equal(SearchInputRegistration.Cap, recent.Count);
        Assert.Equal("query14", recent[0]);
        Assert.Equal("query03", recent[^1]);
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(3, 3)]
    [InlineData(99, 12)]
    public void Get_recent_clamps_the_requested_count_to_zero_and_the_cap(int requested, int expected)
    {
        var env = new SearchHistoryEnvelope();
        for (int i = 0; i < 12; i++)
        {
            env.Record("drives", $"query{i:00}", i);
        }

        Assert.Equal(expected, env.GetRecent("drives", requested).Count);
    }

    [Fact]
    public void Remove_deletes_case_insensitively_and_reports_change()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "alpha", 1);
        env.Record("drives", "beta", 2);

        Assert.True(env.Remove("drives", "ALPHA"));
        Assert.Equal(new[] { "beta" }, env.GetRecent("drives", 8));
        Assert.False(env.Remove("drives", "missing"));
    }

    [Fact]
    public void Remove_drops_the_scope_once_its_last_entry_is_gone()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "alpha", 1);
        env.Remove("drives", "alpha");
        Assert.Equal(0, env.ScopeCount);
    }

    [Fact]
    public void Clear_scope_wipes_only_the_named_scope()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "alpha", 1);
        env.Record("charging", "beta", 2);

        Assert.True(env.ClearScope("drives"));
        Assert.Empty(env.GetRecent("drives", 8));
        Assert.Equal(new[] { "beta" }, env.GetRecent("charging", 8));
        Assert.False(env.ClearScope("unknown"));
    }

    [Fact]
    public void Scopes_are_independent()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "alpha", 1);
        Assert.Empty(env.GetRecent("charging", 8));
    }

    // ── adapter: resilient JSON parse / serialize (web load() / save()) ──────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json {{{")]
    [InlineData("[1,2,3]")]
    [InlineData("42")]
    [InlineData("{}")]
    [InlineData("{\"scopes\":[]}")]
    [InlineData("{\"scopes\":{\"drives\":\"oops\"}}")]
    public void Parse_degrades_malformed_or_unexpected_payloads_to_an_empty_history(string? blob)
    {
        SearchHistoryEnvelope env = SearchHistoryEnvelope.Parse(blob);
        Assert.Equal(0, env.ScopeCount);
    }

    [Fact]
    public void Parse_filters_entries_that_are_not_query_plus_finite_timestamp()
    {
        const string blob =
            "{\"scopes\":{\"drives\":[{\"q\":\"good\",\"ts\":5},{\"q\":\"\",\"ts\":6},{\"q\":\"noTs\"},{\"ts\":7}]}}";
        SearchHistoryEnvelope env = SearchHistoryEnvelope.Parse(blob);
        Assert.Equal(new[] { "good" }, env.GetRecent("drives", 8));
    }

    [Fact]
    public void Json_round_trips_through_parse()
    {
        var env = new SearchHistoryEnvelope();
        env.Record("drives", "alpha", 1);
        env.Record("drives", "beta", 2);
        env.Record("charging", "gamma", 3);

        SearchHistoryEnvelope round = SearchHistoryEnvelope.Parse(env.ToJson());
        Assert.Equal(new[] { "beta", "alpha" }, round.GetRecent("drives", 8));
        Assert.Equal(new[] { "gamma" }, round.GetRecent("charging", 8));
    }

    [Fact]
    public void Parse_caps_each_scope_at_twelve()
    {
        var entries = string.Join(",", Enumerable.Range(0, 20).Select(i => $"{{\"q\":\"q{i}\",\"ts\":{i}}}"));
        SearchHistoryEnvelope env = SearchHistoryEnvelope.Parse($"{{\"scopes\":{{\"drives\":[{entries}]}}}}");
        Assert.Equal(SearchInputRegistration.Cap, env.GetRecent("drives", 99).Count);
    }

    // ── source: JsonSearchHistoryStore over the in-memory blob (web localStorage round-trip) ─────────────

    [Fact]
    public void Store_records_and_reads_back_through_the_blob()
    {
        var store = new JsonSearchHistoryStore(new InMemorySearchHistoryBlobStore());
        store.Record("drives", "model 3");
        store.Record("drives", "model y");

        Assert.Equal(new[] { "model y", "model 3" }, store.GetRecent("drives", 8));
    }

    [Fact]
    public void Store_survives_a_malformed_blob()
    {
        var blob = new InMemorySearchHistoryBlobStore();
        blob.Write("totally not json");
        var store = new JsonSearchHistoryStore(blob);

        Assert.Empty(store.GetRecent("drives", 8));
        store.Record("drives", "recovered");
        Assert.Equal(new[] { "recovered" }, store.GetRecent("drives", 8));
    }

    [Fact]
    public void Store_uses_the_injected_clock_for_timestamps()
    {
        var blob = new InMemorySearchHistoryBlobStore();
        var store = new JsonSearchHistoryStore(blob, () => 4242L);
        store.Record("drives", "model 3");

        Assert.Contains("\"ts\":4242", blob.Read());
    }

    [Fact]
    public void Store_remove_and_clear_persist()
    {
        var store = new JsonSearchHistoryStore(new InMemorySearchHistoryBlobStore());
        store.Record("drives", "alpha");
        store.Record("drives", "beta");

        store.Remove("drives", "alpha");
        Assert.Equal(new[] { "beta" }, store.GetRecent("drives", 8));

        store.ClearScope("drives");
        Assert.Empty(store.GetRecent("drives", 8));
    }

    // ── view-model: state machine (web local / dropdownVisible / showClear) ───────────────────────────────

    [Fact]
    public void History_less_field_starts_idle_and_empty()
    {
        SearchInputViewModel vm = NewViewModel();
        Assert.False(vm.HistoryEnabled);
        Assert.False(vm.ShowClear);
        Assert.False(vm.DropdownVisible);
        Assert.Equal(SearchInputContentState.Empty, vm.ContentState);
    }

    [Fact]
    public void Typing_shows_the_clear_affordance_and_the_typing_state()
    {
        SearchInputViewModel vm = NewViewModel();
        vm.Type("mode");

        Assert.Equal("mode", vm.LocalText);
        Assert.True(vm.ShowClear);
        Assert.Equal(SearchInputContentState.Typing, vm.ContentState);
        Assert.False(vm.DropdownVisible);
    }

    [Fact]
    public void Focusing_an_empty_field_with_history_shows_the_dropdown()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha", "beta");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");

        vm.Focus();

        Assert.True(vm.DropdownVisible);
        Assert.Equal(SearchInputContentState.History, vm.ContentState);
        Assert.Equal(new[] { "alpha", "beta" }, vm.Entries);
    }

    [Fact]
    public void Empty_history_keeps_the_dropdown_hidden_when_focused()
    {
        var store = new RecordingSearchHistoryStore();
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");

        vm.Focus();

        Assert.False(vm.DropdownVisible);
        Assert.Equal(SearchInputContentState.Empty, vm.ContentState);
    }

    [Fact]
    public void Typing_suppresses_the_dropdown_even_when_focused_with_history()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");

        vm.Focus();
        vm.Type("a");

        Assert.False(vm.DropdownVisible);
        Assert.Equal(SearchInputContentState.Typing, vm.ContentState);
    }

    [Fact]
    public void Show_history_on_focus_disabled_keeps_the_dropdown_hidden()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives", showHistoryOnFocus: false);

        vm.Focus();

        Assert.False(vm.DropdownVisible);
    }

    [Fact]
    public void Content_state_enum_covers_only_the_states_the_web_source_renders()
    {
        // The web field reads a synchronous local store with no fetch, so it has no loading / error / stale /
        // offline chrome — the three states below are the complete set (honest parity, not a shortcut).
        var names = Enum.GetNames<SearchInputContentState>().OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Assert.Equal(new[] { "Empty", "History", "Typing" }, names);
    }

    // ── view-model: debounce coalescing (web debounce effect) ─────────────────────────────────────────────

    [Fact]
    public void Rapid_typing_then_a_single_flush_commits_once_with_the_latest_text()
    {
        SearchInputViewModel vm = NewViewModel();
        var commits = new List<string>();
        vm.ValueCommitted += (_, v) => commits.Add(v);

        vm.Type("t");
        vm.Type("te");
        vm.Type("tes");
        vm.Type("test");
        Assert.Empty(commits);

        vm.FlushDebounced();

        Assert.Equal(new[] { "test" }, commits);
        Assert.Equal("test", vm.Value);
    }

    [Fact]
    public void Flush_is_a_no_op_when_the_buffered_text_equals_the_committed_value()
    {
        SearchInputViewModel vm = NewViewModel();
        vm.Value = "abc";
        var commits = new List<string>();
        vm.ValueCommitted += (_, v) => commits.Add(v);

        vm.FlushDebounced();

        Assert.Empty(commits);
    }

    [Fact]
    public void External_value_change_resyncs_the_buffered_text()
    {
        SearchInputViewModel vm = NewViewModel();
        vm.Type("typed");
        vm.Value = "external";

        Assert.Equal("external", vm.LocalText);
    }

    [Fact]
    public void Clear_resets_to_empty_and_the_next_flush_commits_an_empty_value()
    {
        SearchInputViewModel vm = NewViewModel();
        vm.Value = "hello";
        var commits = new List<string>();
        vm.ValueCommitted += (_, v) => commits.Add(v);

        vm.Clear();
        Assert.Equal(string.Empty, vm.LocalText);
        Assert.False(vm.ShowClear);

        vm.FlushDebounced();
        Assert.Equal(new[] { string.Empty }, commits);
    }

    [Fact]
    public void Local_text_changed_fires_on_type_and_clear()
    {
        SearchInputViewModel vm = NewViewModel();
        int signals = 0;
        vm.LocalTextChanged += (_, _) => signals++;

        vm.Type("a");
        vm.Clear();

        Assert.Equal(2, signals);
    }

    // ── view-model: history operations (web selectEntry / handleRemoveEntry / handleClearAll / blur) ──────

    [Fact]
    public void Select_entry_commits_immediately_records_and_requests_focus()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Focus();

        var commits = new List<string>();
        int focusRequests = 0;
        vm.ValueCommitted += (_, v) => commits.Add(v);
        vm.FocusRequested += (_, _) => focusRequests++;

        vm.SelectEntry("alpha");

        Assert.Equal(new[] { "alpha" }, commits);
        Assert.Equal("alpha", vm.Value);
        Assert.Equal(1, focusRequests);
        Assert.Contains("record:drives:alpha", store.Ops);
    }

    [Fact]
    public void Remove_entry_deletes_from_the_store_refreshes_and_requests_focus()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha", "beta");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Focus();

        int focusRequests = 0;
        vm.FocusRequested += (_, _) => focusRequests++;

        vm.RemoveEntry("alpha");

        Assert.Contains("remove:drives:alpha", store.Ops);
        Assert.Equal(new[] { "beta" }, vm.Entries);
        Assert.Equal(1, focusRequests);
    }

    [Fact]
    public void Clear_all_wipes_the_scope_and_empties_the_dropdown()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha", "beta");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Focus();

        vm.ClearAll();

        Assert.Contains("clear:drives", store.Ops);
        Assert.Empty(vm.Entries);
        Assert.False(vm.DropdownVisible);
    }

    [Fact]
    public void Blur_records_buffered_text_to_history_when_long_enough()
    {
        var store = new RecordingSearchHistoryStore();
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Type("model 3");

        vm.Blur();

        Assert.Contains("record:drives:model 3", store.Ops);
        Assert.False(vm.IsFocused);
    }

    [Fact]
    public void Blur_does_not_record_text_shorter_than_the_minimum()
    {
        var store = new RecordingSearchHistoryStore();
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Type("a");

        vm.Blur();

        Assert.DoesNotContain(store.Ops, op => op.StartsWith("record:", StringComparison.Ordinal));
    }

    [Fact]
    public void History_operations_are_no_ops_without_a_scope()
    {
        var store = new RecordingSearchHistoryStore();
        SearchInputViewModel vm = NewViewModel(store: store);

        vm.RemoveEntry("x");
        vm.ClearAll();
        vm.Type("model 3");
        vm.Blur();

        Assert.DoesNotContain(store.Ops, op => op.StartsWith("remove:", StringComparison.Ordinal));
        Assert.DoesNotContain(store.Ops, op => op.StartsWith("clear:", StringComparison.Ordinal));
        Assert.DoesNotContain(store.Ops, op => op.StartsWith("record:", StringComparison.Ordinal));
    }

    // ── view-model: keyboard active descendant (web Arrow / Enter / Escape) ───────────────────────────────

    [Fact]
    public void Arrow_keys_move_the_active_row_clamped_within_the_dropdown()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha", "beta", "gamma");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Focus();

        Assert.Equal(-1, vm.ActiveIndex);
        Assert.True(vm.MoveActiveDown());
        Assert.Equal(0, vm.ActiveIndex);
        vm.MoveActiveDown();
        vm.MoveActiveDown();
        vm.MoveActiveDown();
        Assert.Equal(2, vm.ActiveIndex);          // clamped at the last row
        Assert.Equal("gamma", vm.ActiveEntry);

        vm.MoveActiveUp();
        vm.MoveActiveUp();
        vm.MoveActiveUp();
        Assert.Equal(-1, vm.ActiveIndex);          // clamped at "no selection"
        Assert.Null(vm.ActiveEntry);
    }

    [Fact]
    public void Arrow_keys_are_unhandled_when_the_dropdown_is_closed()
    {
        SearchInputViewModel vm = NewViewModel();
        Assert.False(vm.MoveActiveDown());
        Assert.False(vm.MoveActiveUp());
    }

    [Fact]
    public void Enter_on_an_active_row_selects_it()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha", "beta");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Focus();
        vm.MoveActiveDown();
        vm.MoveActiveDown();

        var commits = new List<string>();
        vm.ValueCommitted += (_, v) => commits.Add(v);

        Assert.True(vm.CommitActiveOrRecord());
        Assert.Equal(new[] { "beta" }, commits);
    }

    [Fact]
    public void Enter_without_an_active_row_records_the_buffered_text()
    {
        var store = new RecordingSearchHistoryStore();
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Type("model 3");

        Assert.False(vm.CommitActiveOrRecord());
        Assert.Contains("record:drives:model 3", store.Ops);
    }

    [Fact]
    public void Escape_closes_the_dropdown_when_open()
    {
        var store = new RecordingSearchHistoryStore();
        store.Seed("drives", "alpha");
        SearchInputViewModel vm = NewViewModel(store: store, scope: "drives");
        vm.Focus();
        Assert.True(vm.DropdownVisible);

        Assert.True(vm.Escape());
        Assert.False(vm.DropdownVisible);
        Assert.False(vm.IsFocused);
    }

    [Fact]
    public void Escape_is_unhandled_when_the_dropdown_is_closed()
    {
        SearchInputViewModel vm = NewViewModel();
        Assert.False(vm.Escape());
    }

    // ── accessibility: every label resolves through the i18n facade (P1/S10) ──────────────────────────────

    [Fact]
    public void Accessible_labels_resolve_through_the_localizer_keys()
    {
        var localizer = new RecordingLocalizer();
        SearchInputViewModel vm = NewViewModel(localizer: localizer, scope: "drives");

        Assert.Equal("Clear", vm.ClearLabel);
        Assert.Equal("Recent searches", vm.HistoryTitle);
        Assert.Equal("Clear history", vm.ClearHistoryLabel);
        Assert.Equal("Remove \"Model 3\" from search history", vm.RemoveAriaFor("Model 3"));

        Assert.Contains("translation.common.clear", localizer.RequestedKeys);
        Assert.Contains("translation.search.history.title", localizer.RequestedKeys);
        Assert.Contains("translation.search.history.clear", localizer.RequestedKeys);
        Assert.Contains("translation.search.history.removeAria", localizer.RequestedKeys);
    }

    [Fact]
    public void Clear_label_override_wins_over_the_localized_default()
    {
        SearchInputViewModel vm = NewViewModel();
        vm.ClearLabelOverride = "Reset";
        Assert.Equal("Reset", vm.ClearLabel);
    }

    // ── diagnostics (P1/S11): view.opened with the surface slug ───────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_the_slug()
    {
        string? captured = null;
        var diagnostics = new SearchInputDiagnostics(value => captured = value);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=SearchInput", captured);
        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}

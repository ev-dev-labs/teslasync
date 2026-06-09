using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ResponseViewer feature view's UI-thread-free logic — the three-branch
/// projection adapter (loading / empty / response), the formatBytes / statusColor / method-badge helpers
/// (mapped to semantic tokens, never neon), the body-rendering rule (indented JSON vs raw text), the
/// self-hiding header + history strips, the pure code-snippet generator (cURL / JavaScript / Python / Go with
/// the GET-vs-body branch) and snippet projection, the i18n routing, the accessibility names, the
/// state-holder view-model's transitions, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/ResponseViewer.tsx). The WinUI views themselves are exercised by the
/// app build.
/// </summary>
public sealed class ResponseViewerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ResponseViewerDisplay Project(ResponseViewerInput input, ILocalizer? localizer = null) =>
        ResponseViewerProjection.Project(input, localizer ?? Localizer);

    private static ApiResponseSnapshot Response(
        int status = 200,
        string statusText = "OK",
        IReadOnlyList<HttpHeaderEntry>? headers = null,
        object? body = null,
        string bodyText = "",
        double duration = 120,
        long size = 256,
        string contentType = "application/json") =>
        new(status, statusText, headers ?? System.Array.Empty<HttpHeaderEntry>(), body, bodyText, duration, size, contentType);

    private static RequestHistoryEntry History(
        string method = "GET",
        string path = "/vehicles",
        int status = 200,
        double duration = 85,
        string timestamp = "2026-01-01T00:00:00Z") =>
        new(method, path, status, duration, timestamp);

    // ── Projection: loading branch ───────────────────────────────────────────────────

    [Fact]
    public void Project_loading_when_loading_flag_set()
    {
        var display = Project(ResponseViewerInput.Busy());

        Assert.Equal(ResponseViewerState.Loading, display.State);
        Assert.False(display.HasResponse);
        Assert.Equal(string.Empty, display.BodyText);
    }

    [Fact]
    public void Project_loading_still_projects_history()
    {
        var input = new ResponseViewerInput(true, null, new[] { History() });
        var display = Project(input);

        Assert.Equal(ResponseViewerState.Loading, display.State);
        Assert.True(display.HasHistory);
        Assert.Single(display.History);
    }

    // ── Projection: empty branch ─────────────────────────────────────────────────────

    [Fact]
    public void Project_empty_when_not_loading_and_no_response()
    {
        var display = Project(ResponseViewerInput.Idle);

        Assert.Equal(ResponseViewerState.Empty, display.State);
        Assert.False(display.HasResponse);
        Assert.Equal("Send a request to see the response", display.EmptyMessage);
    }

    [Fact]
    public void Project_empty_hides_history_when_empty()
    {
        var display = Project(ResponseViewerInput.Idle);

        Assert.False(display.HasHistory);
        Assert.Empty(display.History);
    }

    // ── Projection: response branch ──────────────────────────────────────────────────

    [Fact]
    public void Project_response_when_present()
    {
        var body = new Dictionary<string, object?> { ["ok"] = true };
        var display = Project(new ResponseViewerInput(false, Response(body: body), System.Array.Empty<RequestHistoryEntry>()));

        Assert.Equal(ResponseViewerState.Response, display.State);
        Assert.True(display.HasResponse);
        Assert.Equal("200 OK", display.StatusText);
    }

    [Fact]
    public void Project_response_status_line_drops_empty_status_text()
    {
        var display = Project(new ResponseViewerInput(false, Response(status: 204, statusText: string.Empty), System.Array.Empty<RequestHistoryEntry>()));
        Assert.Equal("204", display.StatusText);
    }

    [Fact]
    public void Project_response_meta_line_formats_duration_and_size()
    {
        var display = Project(new ResponseViewerInput(false, Response(duration: 120, size: 2048), System.Array.Empty<RequestHistoryEntry>()));
        Assert.Equal("120ms · 2.0 KB", display.MetaText);
    }

    // ── Body rendering rule ──────────────────────────────────────────────────────────

    [Fact]
    public void BodyText_serializes_json_payload_indented()
    {
        var body = new Dictionary<string, object?> { ["status"] = "ok", ["count"] = 3 };
        string text = ResponseViewerProjection.BodyText(Response(body: body, contentType: "application/json"));

        Assert.Contains("\n", text);
        Assert.Contains("  \"status\": \"ok\"", text);
        Assert.Contains("\"count\": 3", text);
    }

    [Fact]
    public void BodyText_uses_raw_text_when_not_json()
    {
        string text = ResponseViewerProjection.BodyText(Response(body: null, bodyText: "plain", contentType: "text/plain"));
        Assert.Equal("plain", text);
    }

    [Fact]
    public void BodyText_uses_raw_text_when_body_is_string_even_if_json()
    {
        string text = ResponseViewerProjection.BodyText(Response(body: "literal", bodyText: "raw-body", contentType: "application/json"));
        Assert.Equal("raw-body", text);
    }

    // ── formatBytes ──────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(512, "512 B")]
    [InlineData(1023, "1023 B")]
    [InlineData(2048, "2.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(1572864, "1.5 MB")]
    public void FormatBytes_matches_web_helper(long bytes, string expected) =>
        Assert.Equal(expected, ResponseViewerProjection.FormatBytes(bytes));

    // ── statusColor → semantic tokens ────────────────────────────────────────────────

    [Theory]
    [InlineData(200, "TsColorSuccessBrush")]
    [InlineData(299, "TsColorSuccessBrush")]
    [InlineData(301, "TsColorWarningBrush")]
    [InlineData(399, "TsColorWarningBrush")]
    [InlineData(404, "TsColorDangerBrush")]
    [InlineData(500, "TsColorDangerBrush")]
    public void StatusBrushKey_maps_status_to_semantic_token(int status, string expected) =>
        Assert.Equal(expected, ResponseViewerProjection.StatusBrushKey(status));

    // ── method badge → semantic tokens ───────────────────────────────────────────────

    [Theory]
    [InlineData("GET", "TsColorSuccessBrush")]
    [InlineData("POST", "TsColorInfoBrush")]
    [InlineData("DELETE", "TsColorDangerBrush")]
    [InlineData("PUT", "TsColorWarningBrush")]
    [InlineData("PATCH", "TsColorWarningBrush")]
    [InlineData("get", "TsColorSuccessBrush")]
    public void MethodBrushKey_maps_method_to_semantic_token(string method, string expected) =>
        Assert.Equal(expected, ResponseViewerProjection.MethodBrushKey(method));

    [Fact]
    public void All_tints_use_semantic_tokens_not_neon()
    {
        var headers = new[] { new HttpHeaderEntry("Content-Type", "application/json") };
        var display = Project(new ResponseViewerInput(
            false,
            Response(status: 404, headers: headers),
            new[] { History("POST", status: 500) }));

        AssertSemantic(display.StatusBrushKey);
        foreach (var row in display.History)
        {
            AssertSemantic(row.MethodBrushKey);
            AssertSemantic(row.StatusBrushKey);
        }
    }

    private static void AssertSemantic(string key)
    {
        Assert.StartsWith("TsColor", key, StringComparison.Ordinal);
        Assert.EndsWith("Brush", key, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", key, StringComparison.OrdinalIgnoreCase);
    }

    // ── Headers strip (self-hiding) ──────────────────────────────────────────────────

    [Fact]
    public void Project_headers_when_present()
    {
        var headers = new[]
        {
            new HttpHeaderEntry("Content-Type", "application/json"),
            new HttpHeaderEntry("X-Trace", "abc"),
        };
        var display = Project(new ResponseViewerInput(false, Response(headers: headers), System.Array.Empty<RequestHistoryEntry>()));

        Assert.True(display.HasHeaders);
        Assert.Equal(2, display.HeadersCount);
        Assert.Equal("Response Headers (2)", display.HeadersCountLabel);
        Assert.Equal(2, display.Headers.Count);
    }

    [Fact]
    public void Project_hides_headers_when_none()
    {
        var display = Project(new ResponseViewerInput(false, Response(headers: System.Array.Empty<HttpHeaderEntry>()), System.Array.Empty<RequestHistoryEntry>()));
        Assert.False(display.HasHeaders);
        Assert.Equal(0, display.HeadersCount);
    }

    // ── History strip ────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_history_rows_carry_formatted_fields()
    {
        var entry = History("POST", "/charging", 201, 85);
        var display = Project(new ResponseViewerInput(false, null, new[] { entry }));

        var row = Assert.Single(display.History);
        Assert.Same(entry, row.Entry);
        Assert.Equal("POST", row.Method);
        Assert.Equal("TsColorInfoBrush", row.MethodBrushKey);
        Assert.Equal("/charging", row.Path);
        Assert.Equal(201, row.Status);
        Assert.Equal("TsColorSuccessBrush", row.StatusBrushKey);
        Assert.Equal("85ms", row.DurationText);
        Assert.Equal("POST /charging → 201 (85ms)", row.Tooltip);
        Assert.Equal(row.Tooltip, row.AutomationName);
    }

    [Fact]
    public void Project_history_preserves_order_and_entries()
    {
        var a = History("GET", "/a", 200);
        var b = History("DELETE", "/b", 404);
        var display = Project(new ResponseViewerInput(false, null, new[] { a, b }));

        Assert.Equal(2, display.History.Count);
        Assert.Same(a, display.History[0].Entry);
        Assert.Same(b, display.History[1].Entry);
        Assert.Equal("TsColorDangerBrush", display.History[1].MethodBrushKey);
    }

    // ── i18n routing ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(ResponseViewerInput.Idle, new PrefixLocalizer());

        Assert.Equal("L:translation.playground.response", display.ResponseTitle);
        Assert.Equal("L:translation.playground.noResponse", display.EmptyMessage);
        Assert.Equal("L:translation.playground.history", display.HistoryTitle);
    }

    [Fact]
    public void Project_headers_label_routes_through_localizer()
    {
        var headers = new[] { new HttpHeaderEntry("A", "b") };
        var display = Project(new ResponseViewerInput(false, Response(headers: headers), System.Array.Empty<RequestHistoryEntry>()), new PrefixLocalizer());
        Assert.Equal("L:translation.playground.responseHeaders (1)", display.HeadersCountLabel);
    }

    // ── Accessibility names ──────────────────────────────────────────────────────────

    [Fact]
    public void Project_region_and_body_names_are_non_empty()
    {
        var display = Project(new ResponseViewerInput(false, Response(), System.Array.Empty<RequestHistoryEntry>()));
        Assert.False(string.IsNullOrWhiteSpace(display.ResponseRegionName));
        Assert.False(string.IsNullOrWhiteSpace(display.StatusBodyName));
    }

    [Fact]
    public void Project_empty_body_name_falls_back_to_title()
    {
        var display = Project(ResponseViewerInput.Idle);
        Assert.Equal(display.ResponseTitle, display.StatusBodyName);
    }

    // ── Projection guards ────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_null_input() =>
        Assert.Throws<ArgumentNullException>(() => ResponseViewerProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ResponseViewerProjection.Project(ResponseViewerInput.Idle, null!));

    // ── Snippet generator (verbatim port of generateSnippet) ─────────────────────────

    [Fact]
    public void Snippet_curl_get_has_no_body()
    {
        string snippet = ResponseSnippet.Generate("GET", "https://x/api", SnippetFormat.Curl, null);
        Assert.Contains("curl -X GET 'https://x/api'", snippet);
        Assert.DoesNotContain("-d '", snippet);
    }

    [Fact]
    public void Snippet_curl_post_includes_body_and_content_type()
    {
        string snippet = ResponseSnippet.Generate("POST", "https://x/api", SnippetFormat.Curl, "{\"a\":1}");
        Assert.Contains("curl -X POST 'https://x/api'", snippet);
        Assert.Contains("-H 'Content-Type: application/json'", snippet);
        Assert.Contains("-d '{\"a\":1}'", snippet);
    }

    [Fact]
    public void Snippet_get_with_body_still_omits_body()
    {
        // Web rule: body is only emitted for non-GET requests (body && method !== 'GET').
        string snippet = ResponseSnippet.Generate("GET", "https://x/api", SnippetFormat.Curl, "{\"a\":1}");
        Assert.DoesNotContain("-d '", snippet);
    }

    [Fact]
    public void Snippet_javascript_includes_stringified_body_for_post()
    {
        string snippet = ResponseSnippet.Generate("POST", "https://x/api", SnippetFormat.JavaScript, "{\"a\":1}");
        Assert.Contains("await fetch('https://x/api'", snippet);
        Assert.Contains("JSON.stringify({\"a\":1})", snippet);
    }

    [Fact]
    public void Snippet_python_get_and_post()
    {
        Assert.Contains("requests.get('https://x/api')", ResponseSnippet.Generate("GET", "https://x/api", SnippetFormat.Python, null));
        Assert.Contains("requests.post('https://x/api', json={\"a\":1})", ResponseSnippet.Generate("POST", "https://x/api", SnippetFormat.Python, "{\"a\":1}"));
    }

    [Fact]
    public void Snippet_go_get_uses_http_get()
    {
        string snippet = ResponseSnippet.Generate("GET", "https://x/api", SnippetFormat.Go, null);
        Assert.Contains("http.Get(\"https://x/api\")", snippet);
    }

    [Fact]
    public void Snippet_go_post_uses_new_request_and_default_body()
    {
        string snippet = ResponseSnippet.Generate("DELETE", "https://x/api", SnippetFormat.Go, null);
        Assert.Contains("strings.NewReader(`{}`)", snippet);
        Assert.Contains("http.NewRequest(\"DELETE\", \"https://x/api\"", snippet);
    }

    [Fact]
    public void Snippet_go_post_uses_supplied_body()
    {
        string snippet = ResponseSnippet.Generate("POST", "https://x/api", SnippetFormat.Go, "{\"a\":1}");
        Assert.Contains("strings.NewReader(`{\"a\":1}`)", snippet);
    }

    // ── Snippet projection ───────────────────────────────────────────────────────────

    [Fact]
    public void SnippetProjection_exposes_four_formats_with_one_selected()
    {
        var display = ResponseSnippet.Project(new SnippetInput("GET", "https://x", null), SnippetFormat.Python, Localizer);

        Assert.Equal(4, display.Formats.Count);
        Assert.Single(display.Formats, f => f.IsSelected);
        Assert.Equal(SnippetFormat.Python, display.SelectedFormat);
        Assert.Contains(display.Formats, f => f.Format == SnippetFormat.Python && f.IsSelected);
    }

    [Fact]
    public void SnippetProjection_resolves_chrome_labels()
    {
        var display = ResponseSnippet.Project(new SnippetInput("GET", "https://x", null), SnippetFormat.Curl, Localizer);
        Assert.Equal("Code Snippet", display.ToggleLabel);
        Assert.Equal("Copy", display.CopyLabel);
        Assert.Equal("Copied", display.CopiedLabel);
    }

    [Fact]
    public void SnippetProjection_routes_labels_through_localizer()
    {
        var display = ResponseSnippet.Project(new SnippetInput("GET", "https://x", null), SnippetFormat.Curl, new PrefixLocalizer());
        Assert.Equal("L:translation.playground.codeSnippet", display.ToggleLabel);
        Assert.Equal("L:translation.playground.copy", display.CopyLabel);
        Assert.Equal("L:translation.playground.copied", display.CopiedLabel);
    }

    [Fact]
    public void SnippetProjection_format_labels_are_brand_names_when_absent_from_catalog()
    {
        var display = ResponseSnippet.Project(new SnippetInput("GET", "https://x", null), SnippetFormat.Curl, Localizer);
        Assert.Contains(display.Formats, f => f.Label == "cURL");
        Assert.Contains(display.Formats, f => f.Label == "JavaScript");
        Assert.Contains(display.Formats, f => f.Label == "Python");
        Assert.Contains(display.Formats, f => f.Label == "Go");
    }

    [Fact]
    public void SnippetProjection_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => ResponseSnippet.Project(null!, SnippetFormat.Curl, Localizer));
        Assert.Throws<ArgumentNullException>(() => ResponseSnippet.Project(new SnippetInput("GET", "x", null), SnippetFormat.Curl, null!));
    }

    // ── View-model: seeding + transitions ────────────────────────────────────────────

    [Fact]
    public void ViewModel_seeds_from_source()
    {
        var vm = new ResponseViewerViewModel(StaticResponseViewerSource.Idle(), Localizer);

        Assert.Equal(ResponseViewerState.Empty, vm.State);
        Assert.False(vm.HasResponse);
        Assert.False(vm.HasHistory);
    }

    [Fact]
    public void ViewModel_update_transitions_state_and_raises()
    {
        var vm = new ResponseViewerViewModel(StaticResponseViewerSource.Idle(), Localizer);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Update(new ResponseViewerInput(false, Response(), new[] { History() }));

        Assert.Equal(ResponseViewerState.Response, vm.State);
        Assert.True(vm.HasResponse);
        Assert.True(vm.HasHistory);
        Assert.Contains(nameof(ResponseViewerViewModel.Display), raised);
        Assert.Contains(nameof(ResponseViewerViewModel.State), raised);
        Assert.Contains(nameof(ResponseViewerViewModel.HasResponse), raised);
        Assert.Contains(nameof(ResponseViewerViewModel.HasHistory), raised);
    }

    [Fact]
    public void ViewModel_update_to_loading_state()
    {
        var vm = new ResponseViewerViewModel(StaticResponseViewerSource.Idle(), Localizer);
        vm.Update(ResponseViewerInput.Busy());
        Assert.Equal(ResponseViewerState.Loading, vm.State);
    }

    [Fact]
    public void ViewModel_refresh_repulls_the_source()
    {
        var source = new MutableSource(ResponseViewerInput.Idle);
        var vm = new ResponseViewerViewModel(source, Localizer);
        Assert.Equal(ResponseViewerState.Empty, vm.State);

        source.Current = new ResponseViewerInput(false, Response(), System.Array.Empty<RequestHistoryEntry>());
        vm.Refresh();

        Assert.Equal(ResponseViewerState.Response, vm.State);
    }

    [Fact]
    public void ViewModel_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new ResponseViewerViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new ResponseViewerViewModel(StaticResponseViewerSource.Idle(), null!));
    }

    // ── Source seam ──────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_returns_seeded_input()
    {
        var input = new ResponseViewerInput(true, null, System.Array.Empty<RequestHistoryEntry>());
        Assert.Same(input, new StaticResponseViewerSource(input).GetInput());
    }

    [Fact]
    public void StaticSource_rejects_null_input() =>
        Assert.Throws<ArgumentNullException>(() => new StaticResponseViewerSource(null!));

    // ── Diagnostics (view.opened, PII-safe) ──────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ResponseViewerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ResponseViewer", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new ResponseViewerDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_matches_diagnostics_event() =>
        Assert.Equal("ResponseViewer", ResponseViewerRegistration.Slug);

    // ── Test doubles ─────────────────────────────────────────────────────────────────

    private sealed class MutableSource(ResponseViewerInput initial) : IResponseViewerSource
    {
        public ResponseViewerInput Current { get; set; } = initial;

        public ResponseViewerInput GetInput() => Current;
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}

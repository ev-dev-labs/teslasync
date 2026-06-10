using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ComputedMetricEditor view-model — the metric-registry state matrix
/// (loading / loaded / empty / error / stale / offline), the derived metric/window/operator option
/// projections, the "ready" gate with JS parseFloat parity, the select/window/operator/threshold edits
/// with the onChange (ValueChanged) coupling, and the live preview's idle / rendered / error states.
/// Mirrors the web spec (web/src/features/notifications/components/ComputedMetricEditor.tsx).
/// </summary>
public sealed class ComputedMetricEditorViewModelTests
{
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly ComputedMetricSummary DefaultMetric =
        Summary("charge_cost", "Charge cost", "mi", new[] { "7d", "30d" }, new[] { ">", "<" });

    // ---- Metric registry state matrix -----------------------------------------------

    [Fact]
    public void Initial_state_is_loading()
    {
        using var vm = NewViewModel();

        Assert.Equal(ComputedMetricCatalogState.Loading, vm.CatalogState);
        Assert.True(vm.MetricsLoading);
        Assert.False(vm.MetricEnabled);
        Assert.Equal("Loading metrics\u2026", vm.MetricPrompt);
    }

    [Fact]
    public async Task Catalog_loaded_exposes_options_and_enables_metric()
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Loaded(DefaultMetric) });
        await vm.LoadAsync();

        Assert.Equal(ComputedMetricCatalogState.Loaded, vm.CatalogState);
        Assert.False(vm.MetricsLoading);
        Assert.True(vm.MetricEnabled);
        Assert.Equal("charge_cost", Assert.Single(vm.MetricOptions).Value);
        Assert.Equal("Charge cost", vm.MetricOptions[0].Label);
    }

    [Fact]
    public async Task Catalog_empty_renders_empty()
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Empty() });
        await vm.LoadAsync();

        Assert.Equal(ComputedMetricCatalogState.Empty, vm.CatalogState);
        Assert.Empty(vm.MetricOptions);
    }

    [Fact]
    public async Task Catalog_failure_renders_error_with_message()
    {
        using var vm = NewViewModel(catalog: new[]
        {
            Loading(),
            RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
        });
        await vm.LoadAsync();

        Assert.Equal(ComputedMetricCatalogState.Error, vm.CatalogState);
        Assert.Equal("boom", vm.CatalogError);
    }

    [Fact]
    public async Task Catalog_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(catalog: new[]
        {
            Loading(),
            RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Cached(new[] { DefaultMetric }, Now, stale: true),
        });
        await vm.LoadAsync();

        Assert.Equal(ComputedMetricCatalogState.Stale, vm.CatalogState);
        Assert.Single(vm.MetricOptions);
    }

    [Fact]
    public async Task Catalog_offline_renders_offline_with_cached_rows()
    {
        using var vm = NewViewModel(catalog: new[]
        {
            Loading(),
            RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.OfflineCached(
                new[] { DefaultMetric }, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
        });
        await vm.LoadAsync();

        Assert.Equal(ComputedMetricCatalogState.Offline, vm.CatalogState);
        Assert.Single(vm.MetricOptions);
        Assert.Equal("down", vm.CatalogError);
    }

    [Fact]
    public async Task ReloadMetricsAsync_retries_the_source()
    {
        var source = new FakeCatalogSource(new[] { Loading(), Loaded(DefaultMetric) });
        using var vm = new ComputedMetricEditorViewModel(
            source,
            new FakePreviewSource(_ => ComputedMetricPreviewOutcome.Ok(Preview(1, false))),
            Localizer,
            initialValue: null,
            previewDelay: _ => Task.CompletedTask);

        await vm.ReloadMetricsAsync();
        await vm.ReloadMetricsAsync();

        Assert.Equal(2, source.Calls);
    }

    // ---- Derived option projections --------------------------------------------------

    [Fact]
    public void Op_options_fall_back_to_all_ops_when_no_metric_selected()
    {
        using var vm = NewViewModel();

        Assert.Equal(ComputedMetricOps.All.Count, vm.OpOptions.Count);
        Assert.Empty(vm.WindowOptions);
        Assert.False(vm.WindowEnabled);
        Assert.False(vm.OpEnabled);
    }

    [Fact]
    public async Task Selecting_a_metric_resets_window_and_operator_to_first_pair()
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Loaded(DefaultMetric) });
        await vm.LoadAsync();

        vm.SelectMetric("charge_cost");

        Assert.Equal("charge_cost", vm.MetricId);
        Assert.Equal("7d", vm.MetricWindow);
        Assert.Equal(">", vm.MetricOp);
        Assert.NotNull(vm.Selected);
        Assert.Equal(new[] { "7d", "30d" }, vm.WindowOptions.Select(o => o.Value));
        Assert.Equal(new[] { ">", "<" }, vm.OpOptions.Select(o => o.Value));
        Assert.True(vm.WindowEnabled);
        Assert.True(vm.OpEnabled);
    }

    // ---- Ready gate (web parseFloat parity) ------------------------------------------

    [Fact]
    public async Task Ready_requires_metric_window_operator_and_finite_threshold()
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Loaded(DefaultMetric) });
        await vm.LoadAsync();
        vm.SelectMetric("charge_cost");

        Assert.False(vm.Ready);

        vm.SetThreshold("200");
        Assert.True(vm.Ready);
    }

    [Theory]
    [InlineData("200", true)]
    [InlineData("200abc", true)]
    [InlineData("1.5e2", true)]
    [InlineData("-3.2", true)]
    [InlineData("", false)]
    [InlineData("abc", false)]
    [InlineData(".", false)]
    public async Task Threshold_readiness_follows_parseFloat(string raw, bool ready)
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Loaded(DefaultMetric) });
        await vm.LoadAsync();
        vm.SelectMetric("charge_cost");

        vm.SetThreshold(raw);

        Assert.Equal(ready, vm.Ready);
    }

    // ---- Edits raise ValueChanged (web onChange) -------------------------------------

    [Fact]
    public void SetThreshold_raises_value_changed_with_updated_value()
    {
        using var vm = NewViewModel();
        ComputedMetricEditorValue? captured = null;
        vm.ValueChanged += (_, value) => captured = value;

        vm.SetThreshold("42");

        Assert.Equal("42", vm.MetricThreshold);
        Assert.NotNull(captured);
        Assert.Equal("42", captured!.MetricThreshold);
    }

    [Fact]
    public async Task Selecting_a_metric_raises_value_changed()
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Loaded(DefaultMetric) });
        await vm.LoadAsync();
        ComputedMetricEditorValue? captured = null;
        vm.ValueChanged += (_, value) => captured = value;

        vm.SelectMetric("charge_cost");

        Assert.NotNull(captured);
        Assert.Equal("charge_cost", captured!.MetricId);
        Assert.Equal("7d", captured.MetricWindow);
    }

    // ---- Live preview state matrix ---------------------------------------------------

    [Fact]
    public async Task Preview_idle_until_ready()
    {
        using var vm = NewViewModel(catalog: new[] { Loading(), Loaded(DefaultMetric) });
        await vm.LoadAsync();

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(ComputedMetricPreviewState.Idle, vm.PreviewState);
        Assert.Null(vm.PreviewValueText);
    }

    [Fact]
    public async Task Preview_rendered_composes_value_suffix_and_verdict()
    {
        var preview = new FakePreviewSource(_ => ComputedMetricPreviewOutcome.Ok(Preview(234.5, wouldTrigger: false)));
        using var vm = NewViewModel(
            catalog: new[] { Loading(), Loaded(DefaultMetric) },
            preview: preview,
            initial: new ComputedMetricEditorValue("charge_cost", "7d", ">", "200", null));
        await vm.LoadAsync();

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(ComputedMetricPreviewState.Rendered, vm.PreviewState);
        Assert.Contains("234.50 mi", vm.PreviewValueText!, StringComparison.Ordinal);
        Assert.Contains("NOT", vm.PreviewValueText!, StringComparison.Ordinal);
        Assert.Equal("computed_metric", preview.LastRequest!.Kind);
        Assert.Equal("charge_cost", preview.LastRequest.MetricId);
        Assert.Equal("7d", preview.LastRequest.MetricWindow);
        Assert.Equal(200d, preview.LastRequest.MetricThreshold);
    }

    [Fact]
    public async Task Preview_would_trigger_uses_empty_verdict()
    {
        var preview = new FakePreviewSource(_ => ComputedMetricPreviewOutcome.Ok(Preview(50, wouldTrigger: true)));
        using var vm = NewViewModel(
            catalog: new[] { Loading(), Loaded(DefaultMetric) },
            preview: preview,
            initial: new ComputedMetricEditorValue("charge_cost", "7d", ">", "10", null));
        await vm.LoadAsync();

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(ComputedMetricPreviewState.Rendered, vm.PreviewState);
        Assert.DoesNotContain("NOT", vm.PreviewValueText!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Preview_error_sets_error_state_with_message()
    {
        var preview = new FakePreviewSource(_ =>
            ComputedMetricPreviewOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "preview failed")));
        using var vm = NewViewModel(
            catalog: new[] { Loading(), Loaded(DefaultMetric) },
            preview: preview,
            initial: new ComputedMetricEditorValue("charge_cost", "7d", ">", "200", null));
        await vm.LoadAsync();

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(ComputedMetricPreviewState.Error, vm.PreviewState);
        Assert.Equal("preview failed", vm.PreviewError);
        Assert.Null(vm.PreviewValueText);
    }

    [Fact]
    public async Task Preview_parses_threshold_with_parseFloat_semantics()
    {
        var preview = new FakePreviewSource(_ => ComputedMetricPreviewOutcome.Ok(Preview(1, false)));
        using var vm = NewViewModel(
            catalog: new[] { Loading(), Loaded(DefaultMetric) },
            preview: preview,
            initial: new ComputedMetricEditorValue("charge_cost", "7d", ">", "200abc", null));
        await vm.LoadAsync();

        await vm.RefreshPreviewNowAsync();

        Assert.Equal(200d, preview.LastRequest!.MetricThreshold);
    }

    [Fact]
    public void Dispose_is_idempotent()
    {
        var vm = NewViewModel();

        vm.Dispose();
        vm.Dispose();
    }

    // ---- Helpers ---------------------------------------------------------------------

    private static ComputedMetricEditorViewModel NewViewModel(
        RepositoryResult<IReadOnlyList<ComputedMetricSummary>>[]? catalog = null,
        IComputedMetricPreviewSource? preview = null,
        ComputedMetricEditorValue? initial = null) =>
        new(
            new FakeCatalogSource(catalog ?? new[] { Loaded(DefaultMetric) }),
            preview ?? new FakePreviewSource(_ => ComputedMetricPreviewOutcome.Ok(Preview(1, false))),
            Localizer,
            initial,
            previewDelay: _ => Task.CompletedTask);

    private static ComputedMetricSummary Summary(string id, string label, string unit, string[] windows, string[] ops) =>
        new(id, label, unit, windows, ops);

    private static ComputedMetricPreview Preview(double value, bool wouldTrigger) =>
        new("charge_cost", "7d", ">", 200d, value, wouldTrigger, null, null);

    private static RepositoryResult<IReadOnlyList<ComputedMetricSummary>> Loading() =>
        RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Loading();

    private static RepositoryResult<IReadOnlyList<ComputedMetricSummary>> Empty() =>
        RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Empty(Now);

    private static RepositoryResult<IReadOnlyList<ComputedMetricSummary>> Loaded(params ComputedMetricSummary[] metrics) =>
        RepositoryResult<IReadOnlyList<ComputedMetricSummary>>.Loaded(metrics, Now);

    private sealed class FakeCatalogSource(RepositoryResult<IReadOnlyList<ComputedMetricSummary>>[] emissions)
        : IComputedMetricCatalogSource
    {
        public int Calls { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ComputedMetricSummary>>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            Calls++;
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakePreviewSource(Func<ComputedMetricPreviewRequest, ComputedMetricPreviewOutcome> responder)
        : IComputedMetricPreviewSource
    {
        public int Calls { get; private set; }

        public ComputedMetricPreviewRequest? LastRequest { get; private set; }

        public Task<ComputedMetricPreviewOutcome> PreviewAsync(
            ComputedMetricPreviewRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastRequest = request;
            return Task.FromResult(responder(request));
        }
    }
}

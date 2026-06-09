using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the UuidGenerator feature-view's UI-thread-free logic — the pure history
/// projection (the web <c>[uuid, ...prev].slice(0, 10)</c>), the RFC 4122 v4 generation seam + format, the
/// state-holder view-model's per-state transitions (empty / ready), localized labels and Narrator names, the
/// exact set of i18n keys, the registry metadata, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/UuidGenerator.tsx and web/src/lib/safeUUID.ts). The
/// WinUI view itself is exercised by the app build; its per-state branch selection is driven entirely by the
/// view-model <see cref="UuidGeneratorViewModel.State"/> asserted here.
/// </summary>
public sealed class UuidGeneratorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static UuidGeneratorViewModel NewViewModel(ILocalizer? localizer = null, IUuidFactory? factory = null) =>
        new(localizer ?? Localizer, factory);

    // ---- History projection (web [uuid, ...prev].slice(0, max) parity) -------------

    [Fact]
    public void Prepend_places_the_new_value_first()
    {
        var result = UuidHistory.Prepend(new[] { "a", "b" }, "c", 10);

        Assert.Equal(new[] { "c", "a", "b" }, result);
    }

    [Fact]
    public void Prepend_caps_at_max_dropping_the_oldest()
    {
        var previous = new[] { "1", "2", "3" };

        var result = UuidHistory.Prepend(previous, "0", 3);

        Assert.Equal(new[] { "0", "1", "2" }, result);
    }

    [Fact]
    public void Prepend_does_not_mutate_the_previous_list()
    {
        var previous = new List<string> { "a" };

        _ = UuidHistory.Prepend(previous, "b", 10);

        Assert.Equal(new[] { "a" }, previous);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Prepend_with_non_positive_max_is_empty(int max)
    {
        Assert.Empty(UuidHistory.Prepend(new[] { "a" }, "b", max));
    }

    [Fact]
    public void Prepend_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => UuidHistory.Prepend(null!, "x", 10));
        Assert.Throws<ArgumentNullException>(() => UuidHistory.Prepend(Array.Empty<string>(), null!, 10));
    }

    // ---- Generation seam + RFC 4122 v4 format (web safeRandomUUID parity) -----------

    [Fact]
    public void GuidUuidFactory_produces_a_valid_v4_uuid()
    {
        string uuid = GuidUuidFactory.Instance.NewUuid();

        Assert.True(UuidFormat.IsV4(uuid));
        Assert.Equal(UuidFormat.Length, uuid.Length);
    }

    [Fact]
    public void GuidUuidFactory_produces_distinct_values()
    {
        Assert.NotEqual(GuidUuidFactory.Instance.NewUuid(), GuidUuidFactory.Instance.NewUuid());
    }

    [Theory]
    [InlineData("3b82f6a1-1c2d-4e5f-8a9b-0c1d2e3f4a5b")]   // canonical v4 (variant 8)
    [InlineData("00000000-0000-4000-b000-000000000000")]   // variant b
    [InlineData("3B82F6A1-1C2D-4E5F-9A9B-0C1D2E3F4A5B")]   // upper-case, variant 9
    public void IsV4_accepts_canonical_v4(string uuid)
    {
        Assert.True(UuidFormat.IsV4(uuid));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("3b82f6a1-1c2d-4e5f-8a9b-0c1d2e3f4a5")]    // too short
    [InlineData("3b82f6a1-1c2d-3e5f-8a9b-0c1d2e3f4a5b")]   // version nibble 3, not 4
    [InlineData("3b82f6a1-1c2d-4e5f-7a9b-0c1d2e3f4a5b")]   // variant nibble 7, out of 8..b
    [InlineData("3b82f6a1_1c2d_4e5f_8a9b_0c1d2e3f4a5b")]   // wrong separators
    [InlineData("zzzzzzzz-1c2d-4e5f-8a9b-0c1d2e3f4a5b")]   // non-hex
    public void IsV4_rejects_non_v4(string? uuid)
    {
        Assert.False(UuidFormat.IsV4(uuid));
    }

    // ---- View-model: initial (empty) state -----------------------------------------

    [Fact]
    public void ViewModel_starts_empty()
    {
        var vm = NewViewModel();

        Assert.Equal(UuidGeneratorState.Empty, vm.State);
        Assert.False(vm.HasResults);
        Assert.Empty(vm.Uuids);
        Assert.Null(vm.LastAnnouncement);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    // ---- View-model: ready state + capping -----------------------------------------

    [Fact]
    public void ViewModel_generate_moves_to_ready_with_one_value()
    {
        var factory = new SequenceUuidFactory();
        var vm = NewViewModel(factory: factory);

        vm.Generate();

        Assert.Equal(UuidGeneratorState.Ready, vm.State);
        Assert.True(vm.HasResults);
        Assert.Equal(new[] { "uuid-1" }, vm.Uuids);
    }

    [Fact]
    public void ViewModel_generate_prepends_newest_first()
    {
        var vm = NewViewModel(factory: new SequenceUuidFactory());

        vm.Generate();
        vm.Generate();
        vm.Generate();

        Assert.Equal(new[] { "uuid-3", "uuid-2", "uuid-1" }, vm.Uuids);
    }

    [Fact]
    public void ViewModel_caps_history_at_ten_newest_first()
    {
        var vm = NewViewModel(factory: new SequenceUuidFactory());

        for (int i = 0; i < 12; i++)
        {
            vm.Generate();
        }

        Assert.Equal(UuidGeneratorRegistration.MaxHistory, vm.Uuids.Count);
        Assert.Equal("uuid-12", vm.Uuids[0]);
        Assert.Equal("uuid-3", vm.Uuids[^1]);
    }

    [Fact]
    public void ViewModel_announcement_carries_the_latest_value()
    {
        var vm = NewViewModel(factory: new SequenceUuidFactory());

        vm.Generate();

        Assert.Contains("uuid-1", vm.LastAnnouncement!, StringComparison.Ordinal);
    }

    // ---- View-model: change notifications ------------------------------------------

    [Fact]
    public void ViewModel_first_generate_raises_uuids_state_and_has_results()
    {
        var vm = NewViewModel(factory: new SequenceUuidFactory());
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Generate();

        Assert.Contains(nameof(UuidGeneratorViewModel.Uuids), raised);
        Assert.Contains(nameof(UuidGeneratorViewModel.State), raised);
        Assert.Contains(nameof(UuidGeneratorViewModel.HasResults), raised);
        Assert.Contains(nameof(UuidGeneratorViewModel.LastAnnouncement), raised);
    }

    [Fact]
    public void ViewModel_subsequent_generate_raises_uuids_but_not_state()
    {
        var vm = NewViewModel(factory: new SequenceUuidFactory());
        vm.Generate(); // empty -> ready

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Generate(); // ready -> ready

        Assert.Contains(nameof(UuidGeneratorViewModel.Uuids), raised);
        Assert.DoesNotContain(nameof(UuidGeneratorViewModel.State), raised);
        Assert.DoesNotContain(nameof(UuidGeneratorViewModel.HasResults), raised);
    }

    // ---- Localized labels + a11y names (web t('Uuid Generator') / t('Generate')) ----

    [Fact]
    public void ViewModel_labels_resolve_to_web_literals()
    {
        var vm = NewViewModel();

        Assert.Equal("Uuid Generator", vm.Title);
        Assert.Equal("Uuid Generator Desc", vm.Description);
        Assert.Equal("Generate", vm.GenerateLabel);
        Assert.Equal("Copy", vm.CopyLabel);
        Assert.Equal("Copied", vm.CopiedLabel);
    }

    [Fact]
    public void ViewModel_labels_flow_through_the_localizer()
    {
        var vm = NewViewModel(new PrefixLocalizer());

        Assert.Equal("L:Uuid Generator", vm.Title);
        Assert.Equal("L:Uuid Generator Desc", vm.Description);
        Assert.Equal("L:Generate", vm.GenerateLabel);
        Assert.Equal("L:common.copyButton.copy", vm.CopyLabel);
        Assert.Equal("L:devtools.uuidGenerator.empty", vm.EmptyMessage);
        Assert.Equal("L:devtools.uuidGenerator.generateName", vm.GenerateAccessibleName);
    }

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_names()
    {
        var vm = NewViewModel();

        Assert.False(string.IsNullOrWhiteSpace(vm.GenerateAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.CopyName("3b82f6a1-1c2d-4e5f-8a9b-0c1d2e3f4a5b")));
    }

    [Fact]
    public void ViewModel_copy_name_is_scoped_to_the_value()
    {
        var vm = NewViewModel();
        const string Uuid = "3b82f6a1-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

        Assert.Contains(Uuid, vm.CopyName(Uuid), StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_copy_name_rejects_null()
    {
        var vm = NewViewModel();

        Assert.Throws<ArgumentNullException>(() => vm.CopyName(null!));
    }

    [Fact]
    public void ViewModel_rejects_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new UuidGeneratorViewModel(null!));
    }

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new UuidGeneratorViewModel(recorder, new SequenceUuidFactory());

        _ = vm.Title;
        _ = vm.Description;
        _ = vm.GenerateLabel;
        _ = vm.CopyLabel;
        _ = vm.CopiedLabel;
        _ = vm.EmptyMessage;
        _ = vm.GenerateAccessibleName;
        _ = vm.CopyName("3b82f6a1-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
        vm.Generate();

        string[] expected =
        [
            "Uuid Generator",
            "Uuid Generator Desc",
            "Generate",
            "common.copyButton.copy",
            "common.copyButton.copied",
            "devtools.uuidGenerator.empty",
            "devtools.uuidGenerator.generateName",
            "devtools.uuidGenerator.copyName",
            "devtools.uuidGenerator.announce",
        ];

        foreach (string key in expected)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Registry + view slug (web uuid tool metadata) ------------------------------

    [Fact]
    public void Registration_metadata_is_stable_and_semantic()
    {
        Assert.Equal("uuid", UuidGeneratorRegistration.Id);
        Assert.Equal("devtools", UuidGeneratorRegistration.Category);
        Assert.Equal("UuidGenerator", UuidGeneratorRegistration.Slug);
        Assert.Equal("\uE8D7", UuidGeneratorRegistration.Glyph);
        Assert.Equal(10, UuidGeneratorRegistration.MaxHistory);

        Assert.StartsWith("TsColor", UuidGeneratorRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.EndsWith("Brush", UuidGeneratorRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", UuidGeneratorRegistration.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
        Assert.False(string.IsNullOrEmpty(UuidGeneratorRegistration.AccentColorKey));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new UuidGeneratorDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UuidGenerator", Assert.Single(sink));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new UuidGeneratorDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_never_emits_a_generated_uuid()
    {
        // The view-model owns generation; the diagnostics sink must never receive a produced value.
        var lines = new List<string>();
        var diagnostics = new UuidGeneratorDiagnostics(lines.Add);
        var factory = new SequenceUuidFactory();
        var vm = new UuidGeneratorViewModel(Localizer, factory);
        vm.Generate();

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains("uuid-1", StringComparison.Ordinal));
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class SequenceUuidFactory : IUuidFactory
    {
        private int _counter;

        public string NewUuid() => $"uuid-{++_counter}";
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}

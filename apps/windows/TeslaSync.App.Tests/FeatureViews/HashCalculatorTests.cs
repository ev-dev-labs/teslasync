using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the HashCalculator feature-view's UI-thread-free logic — the SHA-256 digest
/// adapter (web <c>crypto.subtle.digest('SHA-256', …)</c> over a UTF-8 buffer, lowercase hex), the outcome
/// classification, the registry/diagnostics, and the state-holder view-model's per-state transitions (empty /
/// computing / computed / failed) plus the localized labels and Narrator names. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/HashCalculator.tsx).
/// </summary>
public sealed class HashCalculatorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // Independently-verified NIST / reference SHA-256 vectors (lowercase hex of the UTF-8 bytes).
    private const string EmptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    private const string AbcHash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    private const string HelloHash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    private const string CafeUtf8Hash = "850f7dc43910ff890f8879c0ed26fe697c93a067ad93a7d50f466a7028a9bf4e";

    private static HashCalculatorViewModel NewViewModel(IHashComputer? computer = null) =>
        new(computer ?? new Sha256HashComputer(), Localizer);

    // ---- Pure digest adapter (web crypto.subtle.digest parity) ----------------------

    [Theory]
    [InlineData("", EmptyHash)]
    [InlineData("abc", AbcHash)]
    [InlineData("hello", HelloHash)]
    public void Sha256Hex_matches_reference_vectors(string input, string expected) =>
        Assert.Equal(expected, HashCalculatorFormat.Sha256Hex(input));

    [Fact]
    public void Sha256Hex_is_lowercase_64_char_hex()
    {
        string hex = HashCalculatorFormat.Sha256Hex("hello");

        Assert.Equal(64, hex.Length);
        Assert.Equal(hex.ToLowerInvariant(), hex);
        Assert.All(hex, c => Assert.Contains(c, "0123456789abcdef"));
    }

    [Fact]
    public void Sha256Hex_null_is_the_empty_string_digest() =>
        Assert.Equal(EmptyHash, HashCalculatorFormat.Sha256Hex(null));

    [Fact]
    public void Sha256Hex_encodes_input_as_utf8_not_latin1()
    {
        // "café" hashed as UTF-8 (é = C3 A9) yields a vector distinct from any single-byte encoding; this
        // pins the web TextEncoder (UTF-8) behaviour.
        Assert.Equal(CafeUtf8Hash, HashCalculatorFormat.Sha256Hex("café"));
    }

    [Fact]
    public void Sha256Hex_is_deterministic() =>
        Assert.Equal(HashCalculatorFormat.Sha256Hex("repeat"), HashCalculatorFormat.Sha256Hex("repeat"));

    [Fact]
    public async Task Computer_returns_success_with_the_hex_digest()
    {
        var outcome = await new Sha256HashComputer().ComputeAsync("abc");

        Assert.True(outcome.Ok);
        Assert.Equal(AbcHash, outcome.Hash);
    }

    [Fact]
    public async Task Computer_honours_a_cancelled_token()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => new Sha256HashComputer().ComputeAsync("abc", cts.Token));
    }

    // ---- Outcome model --------------------------------------------------------------

    [Fact]
    public void Outcome_succeeded_carries_the_hash()
    {
        var outcome = HashCalculatorOutcome.Succeeded(AbcHash);

        Assert.True(outcome.Ok);
        Assert.Equal(AbcHash, outcome.Hash);
    }

    [Fact]
    public void Outcome_faulted_has_no_hash()
    {
        var outcome = HashCalculatorOutcome.Faulted();

        Assert.False(outcome.Ok);
        Assert.Null(outcome.Hash);
    }

    // ---- Registry + diagnostics metadata --------------------------------------------

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("hash-calculator", HashCalculatorRegistration.Id);
        Assert.Equal("admin", HashCalculatorRegistration.Category);
        Assert.Equal("HashCalculator", HashCalculatorRegistration.Slug);
        Assert.False(string.IsNullOrEmpty(HashCalculatorRegistration.Glyph));
        Assert.Equal("Hash Calculator", HashCalculatorRegistration.Title(Localizer));
        Assert.Equal("Hash Calculator Desc", HashCalculatorRegistration.Description(Localizer));
    }

    [Fact]
    public void Registration_accent_uses_a_semantic_token_not_neon()
    {
        Assert.StartsWith("TsColor", HashCalculatorRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.EndsWith("Brush", HashCalculatorRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", HashCalculatorRegistration.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Registration_labels_flow_through_localizer()
    {
        var prefix = new PrefixLocalizer();

        Assert.Equal("L:Hash Calculator", HashCalculatorRegistration.Title(prefix));
        Assert.Equal("L:Hash Calculator Desc", HashCalculatorRegistration.Description(prefix));
    }

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new HashCalculatorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HashCalculator", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new HashCalculatorDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- View-model: empty (idle) state ---------------------------------------------

    [Fact]
    public void Initial_state_is_empty_with_idle_result_and_no_run()
    {
        var vm = NewViewModel();

        Assert.Equal(HashCalculatorState.Empty, vm.State);
        Assert.True(vm.IsEmpty);
        Assert.False(vm.IsComputing);
        Assert.False(vm.HasHash);
        Assert.False(vm.ShowError);
        Assert.True(vm.ShowResultIdle);
        Assert.Null(vm.HashResult);
        Assert.Equal(StatusKind.Neutral, vm.ResultTrayStatus);
        Assert.Null(vm.LastAnnouncement);
        Assert.False(vm.CanCompute); // empty input
    }

    [Fact]
    public void Input_enables_compute()
    {
        var vm = NewViewModel();

        Assert.False(vm.CanCompute);
        vm.InputText = "abc";
        Assert.True(vm.CanCompute);
    }

    [Fact]
    public void Input_change_raises_input_and_can_compute()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.InputText = "abc";

        Assert.Contains(nameof(HashCalculatorViewModel.InputText), raised);
        Assert.Contains(nameof(HashCalculatorViewModel.CanCompute), raised);
    }

    [Fact]
    public void Input_set_to_same_value_is_a_noop()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.InputText = string.Empty;

        Assert.Empty(raised);
    }

    // ---- View-model: computing state ------------------------------------------------

    [Fact]
    public async Task Computing_state_spins_and_blocks_recompute()
    {
        var gated = new GatedComputer();
        var vm = NewViewModel(gated);
        vm.InputText = "abc";

        var run = vm.ComputeAsync();

        Assert.Equal(HashCalculatorState.Computing, vm.State);
        Assert.True(vm.IsComputing);
        Assert.False(vm.CanCompute);
        Assert.True(vm.ShowResultIdle); // no prior digest

        await vm.ComputeAsync(); // second run while in flight is a no-op
        Assert.Equal(1, gated.Calls);

        gated.Complete(HashCalculatorOutcome.Succeeded(AbcHash));
        await run;

        Assert.Equal(HashCalculatorState.Computed, vm.State);
    }

    // ---- View-model: computed (success) state ---------------------------------------

    [Fact]
    public async Task Computed_state_exposes_hex_copy_payload_and_announcement()
    {
        var vm = NewViewModel();
        vm.InputText = "abc";

        await vm.ComputeAsync();

        Assert.Equal(HashCalculatorState.Computed, vm.State);
        Assert.True(vm.HasHash);
        Assert.False(vm.ShowError);
        Assert.False(vm.ShowResultIdle);
        Assert.Equal(AbcHash, vm.HashResult);
        Assert.Equal(StatusKind.Danger, vm.ResultTrayStatus);
        Assert.Equal("SHA-256 hash ready", vm.LastAnnouncement);
        Assert.True(vm.CanCompute);
    }

    [Fact]
    public async Task Computed_state_raises_state_and_result()
    {
        var vm = NewViewModel();
        vm.InputText = "abc";
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        await vm.ComputeAsync();

        Assert.Contains(nameof(HashCalculatorViewModel.State), raised);
        Assert.Contains(nameof(HashCalculatorViewModel.HasHash), raised);
        Assert.Contains(nameof(HashCalculatorViewModel.HashResult), raised);
        Assert.Contains(nameof(HashCalculatorViewModel.LastAnnouncement), raised);
    }

    [Fact]
    public async Task Whitespace_input_computes_a_digest()
    {
        // JS truthiness: a non-empty whitespace string is truthy, so the web compute() runs (only "" returns).
        var vm = NewViewModel();
        vm.InputText = " ";

        await vm.ComputeAsync();

        Assert.Equal(HashCalculatorState.Computed, vm.State);
        Assert.Equal(HashCalculatorFormat.Sha256Hex(" "), vm.HashResult);
    }

    [Fact]
    public async Task Empty_input_compute_is_a_noop()
    {
        // Web: `if (!inputVal) return` — the empty string short-circuits before hashing.
        var computer = new CountingComputer(HashCalculatorOutcome.Succeeded(AbcHash));
        var vm = NewViewModel(computer);

        await vm.ComputeAsync();

        Assert.Equal(0, computer.Calls);
        Assert.Equal(HashCalculatorState.Empty, vm.State);
    }

    [Fact]
    public async Task Input_change_keeps_the_prior_digest_until_recompute()
    {
        // Web parity: editing inputVal does not clear hashResult; only the next compute replaces it.
        var vm = NewViewModel();
        vm.InputText = "abc";
        await vm.ComputeAsync();
        string? first = vm.HashResult;

        vm.InputText = "abcd";

        Assert.Equal(HashCalculatorState.Computed, vm.State);
        Assert.Equal(first, vm.HashResult);
        Assert.True(vm.CanCompute);

        await vm.ComputeAsync();
        Assert.Equal(HashCalculatorFormat.Sha256Hex("abcd"), vm.HashResult);
    }

    [Fact]
    public async Task Recompute_after_settling_is_allowed()
    {
        var computer = new CountingComputer(HashCalculatorOutcome.Succeeded(AbcHash));
        var vm = NewViewModel(computer);
        vm.InputText = "abc";

        await vm.ComputeAsync();
        Assert.Equal(HashCalculatorState.Computed, vm.State);

        await vm.ComputeAsync();
        Assert.Equal(HashCalculatorState.Computed, vm.State);
        Assert.Equal(2, computer.Calls);
    }

    // ---- View-model: failed state ---------------------------------------------------

    [Fact]
    public async Task Failed_state_shows_error_and_clears_hash()
    {
        var vm = NewViewModel(new CountingComputer(HashCalculatorOutcome.Faulted()));
        vm.InputText = "abc";

        await vm.ComputeAsync();

        Assert.Equal(HashCalculatorState.Failed, vm.State);
        Assert.True(vm.ShowError);
        Assert.False(vm.HasHash);
        Assert.False(vm.ShowResultIdle);
        Assert.Null(vm.HashResult);
        Assert.Equal(StatusKind.Danger, vm.ResultTrayStatus);
        Assert.Equal("Hash Error", vm.LastAnnouncement);
        Assert.True(vm.CanCompute);
    }

    [Fact]
    public async Task Failure_then_success_recovers_to_computed()
    {
        var computer = new SequencedComputer(
            HashCalculatorOutcome.Faulted(),
            HashCalculatorOutcome.Succeeded(AbcHash));
        var vm = NewViewModel(computer);
        vm.InputText = "abc";

        await vm.ComputeAsync();
        Assert.Equal(HashCalculatorState.Failed, vm.State);

        await vm.ComputeAsync();
        Assert.Equal(HashCalculatorState.Computed, vm.State);
        Assert.False(vm.ShowError);
        Assert.Equal(AbcHash, vm.HashResult);
    }

    // ---- Localized labels + a11y names (web t('…') literals) -------------------------

    [Fact]
    public void Labels_resolve_to_web_literals()
    {
        var vm = NewViewModel();

        Assert.Equal("Hash Calculator", vm.Title);
        Assert.Equal("Hash Calculator Desc", vm.Description);
        Assert.Equal("Hash Input", vm.InputLabel);
        Assert.Equal("Hash Placeholder", vm.InputHint); // parity:allow web HashCalculator.tsx t('Hash Placeholder') i18n key
        Assert.Equal("Compute Sha256", vm.ComputeLabel);
        Assert.Equal("Hash Error", vm.HashErrorLabel);
        Assert.Equal("No hash yet", vm.NoResultLabel);
        Assert.Equal("Copy", vm.CopyLabel);
        Assert.Equal("Copied", vm.CopiedLabel);
    }

    [Fact]
    public void Labels_flow_through_localizer()
    {
        var vm = new HashCalculatorViewModel(new Sha256HashComputer(), new PrefixLocalizer());

        Assert.Equal("L:Hash Calculator", vm.Title);
        Assert.Equal("L:Hash Input", vm.InputLabel);
        Assert.Equal("L:devtools.utils.computeSha256", vm.ComputeLabel);
        Assert.Equal("L:Hash Error", vm.HashErrorLabel);
    }

    [Fact]
    public void Accessibility_names_are_present_and_scoped()
    {
        var vm = NewViewModel();

        Assert.False(string.IsNullOrWhiteSpace(vm.ComputeActionName));
        Assert.Equal(vm.ComputeLabel, vm.ComputeActionName);
        Assert.False(string.IsNullOrWhiteSpace(vm.ComputingLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.InputLabel));
        Assert.False(string.IsNullOrWhiteSpace(vm.ResultLabel));
    }

    // ---- Disposal -------------------------------------------------------------------

    [Fact]
    public void Dispose_is_idempotent()
    {
        var vm = NewViewModel();
        vm.Dispose();
        vm.Dispose();
    }

    [Fact]
    public async Task Compute_after_dispose_is_a_noop()
    {
        var computer = new CountingComputer(HashCalculatorOutcome.Succeeded(AbcHash));
        var vm = NewViewModel(computer);
        vm.InputText = "abc";
        vm.Dispose();

        await vm.ComputeAsync();

        Assert.Equal(0, computer.Calls);
    }

    // ---- Test doubles ---------------------------------------------------------------

    private sealed class CountingComputer : IHashComputer
    {
        private readonly HashCalculatorOutcome _outcome;

        public CountingComputer(HashCalculatorOutcome outcome) => _outcome = outcome;

        public int Calls { get; private set; }

        public Task<HashCalculatorOutcome> ComputeAsync(string input, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(_outcome);
        }
    }

    private sealed class SequencedComputer : IHashComputer
    {
        private readonly Queue<HashCalculatorOutcome> _outcomes;

        public SequencedComputer(params HashCalculatorOutcome[] outcomes) => _outcomes = new Queue<HashCalculatorOutcome>(outcomes);

        public Task<HashCalculatorOutcome> ComputeAsync(string input, CancellationToken cancellationToken = default) =>
            Task.FromResult(_outcomes.Dequeue());
    }

    private sealed class GatedComputer : IHashComputer
    {
        private readonly TaskCompletionSource<HashCalculatorOutcome> _gate =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int Calls { get; private set; }

        public Task<HashCalculatorOutcome> ComputeAsync(string input, CancellationToken cancellationToken = default)
        {
            Calls++;
            return _gate.Task;
        }

        public void Complete(HashCalculatorOutcome outcome) => _gate.TrySetResult(outcome);
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}

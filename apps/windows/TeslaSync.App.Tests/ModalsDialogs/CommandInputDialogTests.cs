using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the CommandInputDialog modal-dialog surface's UI-thread-free logic — the
/// <c>validateField</c> rule (required / PIN / whole-number / decimal, with the JS <c>parseInt</c> /
/// <c>parseFloat</c> accept-reject boundary and the min/max bound messages), the <c>buildInitialValues</c>
/// seeding (multi-field empties, single-field default / getDefaultValue), the <c>isValid</c> submit gate, the
/// registration slug + i18n key / fallback contract (the Cancel / Send buttons + the validation messages,
/// which double as the Narrator-label source) and the state-holder view-model's per-branch flows (idle / live
/// validity / touch-gated errors / loading-disabled submit / submit + reset-on-open / cancel) plus the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/system/components/CommandInputDialog.tsx). The WinUI view
/// itself (CommandInputDialog.cs) is exercised by the app build.
/// </summary>
public sealed class CommandInputDialogTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Form builders mirroring real web command-input configs ───────────────────────────────────────────

    private static CommandInputForm PinForm() => new()
    {
        TitleKey = "commands.security.speedActivate",
        TitleFallback = "Activate",
        SubtitleKey = "commands.security.speedLimitMode",
        SubtitleFallback = "Speed Limit",
        IconGlyph = "\uE72E",
        PromptKey = "commands.security.enterSpeedPin",
        PromptFallback = "Enter 4-digit PIN:",
        ParamName = "pin",
        Validation = CommandInputValidation.Pin,
    };

    private static CommandInputForm SpeedLimitForm() => new()
    {
        TitleKey = "commands.security.setSpeedLimit",
        TitleFallback = "Set Speed Limit",
        PromptKey = "commands.security.enterSpeedLimit",
        PromptFallback = "Enter speed limit (50-90 MPH):",
        ParamName = "limit_mph",
        Validation = CommandInputValidation.Number,
        Min = 50,
        Max = 90,
    };

    private static CommandInputForm TempForm() => new()
    {
        TitleKey = "commands.climate.setTemp",
        TitleFallback = "Set Temp",
        PromptKey = "commands.climate.enterTemp",
        PromptFallback = "Enter temperature (15-30 °C):",
        ParamName = "driver_temp",
        Validation = CommandInputValidation.Real,
        Min = 15,
        Max = 30,
    };

    private static CommandInputForm RenameForm(string? vehicleDefault) => new()
    {
        TitleKey = "commands.vehicle.rename",
        TitleFallback = "Rename",
        SubtitleKey = "commands.vehicle.changeName",
        SubtitleFallback = "Change name",
        PromptKey = "commands.vehicle.enterName",
        PromptFallback = "Enter new vehicle name:",
        ParamName = "vehicle_name",
        Validation = CommandInputValidation.Text,
        ResolveDefaultValue = _ => vehicleDefault ?? string.Empty,
    };

    private static CommandInputForm LatLonForm() => new()
    {
        TitleKey = "commands.nav.navigateTo",
        TitleFallback = "Navigate To",
        PromptKey = "commands.nav.enterCoords",
        PromptFallback = "Enter coordinates:",
        ParamName = "unused",
        Fields =
        [
            new CommandInputField("lat", "commands.nav.latitude", "Latitude", "37.7749", CommandInputValidation.Real),
            new CommandInputField("lon", "commands.nav.longitude", "Longitude", "-122.4194", CommandInputValidation.Real),
        ],
    };

    // ── Projection: required check (web !trimmed → 'Required') ───────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Validate_blank_is_required_for_every_rule(string? value)
    {
        Assert.Equal("Required", CommandInputProjection.Validate(value, CommandInputValidation.Text, null, null, Localizer));
        Assert.Equal("Required", CommandInputProjection.Validate(value, CommandInputValidation.Pin, null, null, Localizer));
        Assert.Equal("Required", CommandInputProjection.Validate(value, CommandInputValidation.Number, null, null, Localizer));
        Assert.Equal("Required", CommandInputProjection.Validate(value, CommandInputValidation.Real, null, null, Localizer));
    }

    [Fact]
    public void Validate_text_accepts_any_non_blank_value() =>
        Assert.Null(CommandInputProjection.Validate("My Model 3", CommandInputValidation.Text, null, null, Localizer));

    // ── Projection: PIN (web /^\d{4}$/) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Validate_pin_accepts_exactly_four_digits() =>
        Assert.Null(CommandInputProjection.Validate("1234", CommandInputValidation.Pin, null, null, Localizer));

    [Theory]
    [InlineData("123")]
    [InlineData("12345")]
    [InlineData("12a4")]
    [InlineData("abcd")]
    [InlineData("12 4")]
    public void Validate_pin_rejects_non_four_digit(string value) =>
        Assert.Equal("Enter a 4-digit PIN", CommandInputProjection.Validate(value, CommandInputValidation.Pin, null, null, Localizer));

    // ── Projection: whole number (web parseInt + String(n) === v) ────────────────────────────────────────

    [Theory]
    [InlineData("50")]
    [InlineData("90")]
    [InlineData("-3")]
    public void Validate_number_accepts_canonical_integers(string value) =>
        Assert.Null(CommandInputProjection.Validate(value, CommandInputValidation.Number, null, null, Localizer));

    [Theory]
    [InlineData("50.5")]
    [InlineData("abc")]
    [InlineData("007")]
    [InlineData("+5")]
    [InlineData("1e3")]
    [InlineData("12abc")]
    public void Validate_number_rejects_non_canonical_integers(string value) =>
        Assert.Equal("Enter a whole number", CommandInputProjection.Validate(value, CommandInputValidation.Number, null, null, Localizer));

    [Fact]
    public void Validate_number_enforces_min_and_max()
    {
        Assert.Equal("Minimum: 50", CommandInputProjection.Validate("49", CommandInputValidation.Number, 50, 90, Localizer));
        Assert.Equal("Maximum: 90", CommandInputProjection.Validate("91", CommandInputValidation.Number, 50, 90, Localizer));
        Assert.Null(CommandInputProjection.Validate("50", CommandInputValidation.Number, 50, 90, Localizer));
        Assert.Null(CommandInputProjection.Validate("90", CommandInputValidation.Number, 50, 90, Localizer));
    }

    // ── Projection: decimal (web parseFloat) ─────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("37.7749")]
    [InlineData("-122.4194")]
    [InlineData(".5")]
    [InlineData("5.")]
    [InlineData("21")]
    public void Validate_decimal_accepts_real_numbers(string value) =>
        Assert.Null(CommandInputProjection.Validate(value, CommandInputValidation.Real, null, null, Localizer));

    [Fact]
    public void Validate_decimal_matches_parseFloat_leniency() =>
        // parseFloat('1.5abc') === 1.5 → accepted (web parity).
        Assert.Null(CommandInputProjection.Validate("1.5abc", CommandInputValidation.Real, null, null, Localizer));

    [Theory]
    [InlineData("abc")]
    [InlineData("x12")]
    public void Validate_decimal_rejects_non_numbers(string value) =>
        Assert.Equal("Enter a valid number", CommandInputProjection.Validate(value, CommandInputValidation.Real, null, null, Localizer));

    [Fact]
    public void Validate_decimal_enforces_min_and_max()
    {
        Assert.Equal("Minimum: 15", CommandInputProjection.Validate("14.9", CommandInputValidation.Real, 15, 30, Localizer));
        Assert.Equal("Maximum: 30", CommandInputProjection.Validate("30.1", CommandInputValidation.Real, 15, 30, Localizer));
        Assert.Null(CommandInputProjection.Validate("15", CommandInputValidation.Real, 15, 30, Localizer));
        Assert.Null(CommandInputProjection.Validate("30", CommandInputValidation.Real, 15, 30, Localizer));
    }

    // ── Projection: the JS-faithful parsers ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("0", true, 0)]
    [InlineData("42", true, 42)]
    [InlineData("-7", true, -7)]
    [InlineData("007", false, 0)]
    [InlineData("+5", false, 0)]
    [InlineData("1.0", false, 0)]
    [InlineData("1e3", false, 0)]
    public void TryParseJsInt_matches_parseInt_round_trip(string input, bool ok, long expected)
    {
        bool parsed = CommandInputProjection.TryParseJsInt(input, out long value);
        Assert.Equal(ok, parsed);
        if (ok)
        {
            Assert.Equal(expected, value);
        }
    }

    [Theory]
    [InlineData("1.5", true, 1.5)]
    [InlineData("1.5abc", true, 1.5)]
    [InlineData(".25", true, 0.25)]
    [InlineData("abc", false, 0)]
    public void TryParseJsFloat_matches_parseFloat(string input, bool ok, double expected)
    {
        bool parsed = CommandInputProjection.TryParseJsFloat(input, out double value);
        Assert.Equal(ok, parsed);
        if (ok)
        {
            Assert.Equal(expected, value, 6);
        }
    }

    // ── Projection: buildInitialValues ───────────────────────────────────────────────────────────────────

    [Fact]
    public void BuildInitialValues_seeds_each_multi_field_empty()
    {
        var values = CommandInputProjection.BuildInitialValues(LatLonForm(), null);

        Assert.Equal(2, values.Count);
        Assert.Equal(string.Empty, values["lat"]);
        Assert.Equal(string.Empty, values["lon"]);
    }

    [Fact]
    public void BuildInitialValues_single_field_uses_default_value()
    {
        var form = new CommandInputForm
        {
            TitleKey = "k",
            TitleFallback = "T",
            PromptKey = "p",
            PromptFallback = "P",
            ParamName = "x",
            DefaultValue = "hello",
        };

        var values = CommandInputProjection.BuildInitialValues(form, null);

        Assert.Equal("hello", values["x"]);
    }

    [Fact]
    public void BuildInitialValues_getDefaultValue_wins_over_default_and_reads_vehicle_name()
    {
        var form = new CommandInputForm
        {
            TitleKey = "k",
            TitleFallback = "T",
            PromptKey = "p",
            PromptFallback = "P",
            ParamName = "vehicle_name",
            DefaultValue = "ignored",
            ResolveDefaultValue = name => name ?? string.Empty,
        };

        Assert.Equal("Lightning", CommandInputProjection.BuildInitialValues(form, "Lightning")["vehicle_name"]);
    }

    [Fact]
    public void BuildInitialValues_single_field_defaults_to_empty() =>
        Assert.Equal(string.Empty, CommandInputProjection.BuildInitialValues(PinForm(), null)["pin"]);

    // ── Projection: isValid submit gate ──────────────────────────────────────────────────────────────────

    [Fact]
    public void IsValid_is_false_until_required_single_field_is_filled()
    {
        var form = PinForm();
        Assert.False(CommandInputProjection.IsValid(form, new Dictionary<string, string> { ["pin"] = "" }, Localizer));
        Assert.False(CommandInputProjection.IsValid(form, new Dictionary<string, string> { ["pin"] = "12" }, Localizer));
        Assert.True(CommandInputProjection.IsValid(form, new Dictionary<string, string> { ["pin"] = "1234" }, Localizer));
    }

    [Fact]
    public void IsValid_requires_every_multi_field()
    {
        var form = LatLonForm();
        Assert.False(CommandInputProjection.IsValid(
            form, new Dictionary<string, string> { ["lat"] = "37.77", ["lon"] = "" }, Localizer));
        Assert.True(CommandInputProjection.IsValid(
            form, new Dictionary<string, string> { ["lat"] = "37.77", ["lon"] = "-122.41" }, Localizer));
    }

    // ── Registration: slug + i18n fallbacks (the Narrator-label source) ──────────────────────────────────

    [Fact]
    public void Registration_carries_the_surface_slug() =>
        Assert.Equal("CommandInputDialog", CommandInputRegistration.Slug);

    [Fact]
    public void Button_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Cancel", CommandInputRegistration.CancelLabel(Localizer));
        Assert.Equal("Send", CommandInputRegistration.SubmitLabel(Localizer));
    }

    [Fact]
    public void Validation_message_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Required", CommandInputRegistration.RequiredMessage(Localizer));
        Assert.Equal("Enter a 4-digit PIN", CommandInputRegistration.PinMessage(Localizer));
        Assert.Equal("Enter a whole number", CommandInputRegistration.WholeNumberMessage(Localizer));
        Assert.Equal("Enter a valid number", CommandInputRegistration.DecimalMessage(Localizer));
    }

    [Fact]
    public void Bound_messages_interpolate_like_the_web_template_literal()
    {
        Assert.Equal("Minimum: 50", CommandInputRegistration.MinimumMessage(Localizer, 50));
        Assert.Equal("Maximum: 90", CommandInputRegistration.MaximumMessage(Localizer, 90));
        Assert.Equal("Minimum: 15", CommandInputRegistration.MinimumMessage(Localizer, 15));
    }

    [Theory]
    [InlineData(50, "50")]
    [InlineData(15, "15")]
    [InlineData(15.5, "15.5")]
    [InlineData(-122.4194, "-122.4194")]
    public void FormatBound_prints_like_a_javascript_number(double bound, string expected) =>
        Assert.Equal(expected, CommandInputRegistration.FormatBound(bound));

    [Fact]
    public void Surface_owned_labels_route_through_common_and_commands_input_keys()
    {
        var recorder = new RecordingLocalizer();

        _ = CommandInputRegistration.CancelLabel(recorder);
        _ = CommandInputRegistration.SubmitLabel(recorder);
        _ = CommandInputRegistration.RequiredMessage(recorder);
        _ = CommandInputRegistration.PinMessage(recorder);
        _ = CommandInputRegistration.WholeNumberMessage(recorder);
        _ = CommandInputRegistration.DecimalMessage(recorder);
        _ = CommandInputRegistration.MinimumMessage(recorder, 1);
        _ = CommandInputRegistration.MaximumMessage(recorder, 1);

        Assert.Contains("common.cancel", recorder.Keys);
        Assert.Contains("common.send", recorder.Keys);
        Assert.All(
            recorder.Keys.Where(k => k.StartsWith("commands.", StringComparison.Ordinal)),
            key => Assert.StartsWith("commands.input.", key, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(CommandInputValidation.Text, "text")]
    [InlineData(CommandInputValidation.Pin, "pin")]
    [InlineData(CommandInputValidation.Number, "number")]
    [InlineData(CommandInputValidation.Real, "decimal")]
    public void Validation_tokens_round_trip(CommandInputValidation validation, string token)
    {
        Assert.Equal(token, CommandInputValidations.ToToken(validation));
        Assert.Equal(validation, CommandInputValidations.FromToken(token));
    }

    [Fact]
    public void Unknown_validation_token_maps_to_text() =>
        Assert.Equal(CommandInputValidation.Text, CommandInputValidations.FromToken("bogus"));

    // ── View-model: initial state ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_single_field_pin_state_matches_the_web()
    {
        var vm = new CommandInputDialogViewModel(PinForm(), null, Localizer);

        var field = Assert.Single(vm.Fields);
        Assert.Equal("pin", field.Name);
        Assert.True(field.IsSecret);
        Assert.Equal("Speed Limit", field.Label);
        Assert.True(field.HasLabel);
        Assert.Equal(string.Empty, field.Value);
        Assert.False(field.Touched);
        Assert.Null(field.DisplayError); // not touched → no error shown
        Assert.False(vm.CanSubmit); // required, empty
        Assert.True(vm.HasIcon);
        Assert.Equal("Activate", vm.Title);
        Assert.Equal("Enter 4-digit PIN:", vm.Prompt);
    }

    [Fact]
    public void Initial_rename_field_is_seeded_with_the_vehicle_name_and_submittable()
    {
        var vm = new CommandInputDialogViewModel(RenameForm("My Model 3"), "My Model 3", Localizer);

        var field = Assert.Single(vm.Fields);
        Assert.Equal("My Model 3", field.Value);
        Assert.Equal("Change name", field.Label);
        Assert.True(vm.CanSubmit); // non-empty text passes
    }

    [Fact]
    public void Single_field_without_subtitle_has_no_label()
    {
        var vm = new CommandInputDialogViewModel(SpeedLimitForm(), null, Localizer);

        var field = Assert.Single(vm.Fields);
        Assert.Null(field.Label);
        Assert.False(field.HasLabel);
        Assert.False(vm.HasIcon);
    }

    // ── View-model: touch-gated errors (web handleChange / handleBlur) ───────────────────────────────────

    [Fact]
    public void SetValue_before_touch_does_not_surface_an_error_but_updates_the_gate()
    {
        var vm = new CommandInputDialogViewModel(PinForm(), null, Localizer);
        var field = vm.Fields[0];

        vm.SetValue(field, "12");

        Assert.Equal("12", field.Value);
        Assert.Null(field.DisplayError); // untouched
        Assert.False(vm.CanSubmit);

        vm.SetValue(field, "1234");
        Assert.True(vm.CanSubmit);
    }

    [Fact]
    public void Blur_reveals_the_validation_error()
    {
        var vm = new CommandInputDialogViewModel(PinForm(), null, Localizer);
        var field = vm.Fields[0];
        vm.SetValue(field, "12");

        vm.Blur(field);

        Assert.True(field.Touched);
        Assert.True(field.HasError);
        Assert.Equal("Enter a 4-digit PIN", field.DisplayError);
    }

    [Fact]
    public void SetValue_after_touch_revalidates_live()
    {
        var vm = new CommandInputDialogViewModel(PinForm(), null, Localizer);
        var field = vm.Fields[0];
        vm.Blur(field); // touched, now empty → required error
        Assert.Equal("Required", field.DisplayError);

        vm.SetValue(field, "1234");

        Assert.Null(field.DisplayError); // cleared live once valid
        Assert.True(vm.CanSubmit);
    }

    // ── View-model: submit (web handleSubmit) ────────────────────────────────────────────────────────────

    [Fact]
    public void Submit_invalid_marks_all_fields_touched_and_is_a_no_op()
    {
        var lines = new List<string>();
        var vm = new CommandInputDialogViewModel(LatLonForm(), null, Localizer, new CommandInputDiagnostics(lines.Add));
        int submits = 0;
        vm.SubmitRequested += (_, _) => submits++;
        vm.SetValue(vm.Fields[0], "37.77"); // lat valid, lon empty

        bool ok = vm.Submit();

        Assert.False(ok);
        Assert.Equal(0, submits);
        Assert.True(vm.Fields[1].Touched);
        Assert.True(vm.Fields[1].HasError);
        Assert.Empty(lines); // no submit diagnostics
    }

    [Fact]
    public void Submit_valid_emits_values_and_records()
    {
        var lines = new List<string>();
        var vm = new CommandInputDialogViewModel(LatLonForm(), null, Localizer, new CommandInputDiagnostics(lines.Add));
        CommandInputSubmission? captured = null;
        vm.SubmitRequested += (_, s) => captured = s;
        vm.SetValue(vm.Fields[0], "37.7749");
        vm.SetValue(vm.Fields[1], "-122.4194");

        bool ok = vm.Submit();

        Assert.True(ok);
        Assert.NotNull(captured);
        Assert.Equal("37.7749", captured!.Values["lat"]);
        Assert.Equal("-122.4194", captured.Values["lon"]);
        Assert.Equal("command.input.submitted slug=CommandInputDialog", Assert.Single(lines));
    }

    [Fact]
    public void Loading_disables_submit_even_when_valid()
    {
        var vm = new CommandInputDialogViewModel(PinForm(), null, Localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);
        vm.SetValue(vm.Fields[0], "1234");
        Assert.True(vm.CanSubmit);

        vm.Loading = true;

        Assert.False(vm.CanSubmit); // web Button disabled = disabled || loading
        Assert.Contains(nameof(CommandInputDialogViewModel.Loading), changed);
        Assert.Contains(nameof(CommandInputDialogViewModel.CanSubmit), changed);
    }

    // ── View-model: reset + diagnostics on open (web open useEffect) ─────────────────────────────────────

    [Fact]
    public void NotifyOpened_reseeds_fields_clears_errors_and_records()
    {
        var lines = new List<string>();
        var vm = new CommandInputDialogViewModel(RenameForm("Roadster"), "Roadster", Localizer, new CommandInputDiagnostics(lines.Add));
        var field = vm.Fields[0];
        vm.SetValue(field, "scratch");
        vm.Blur(field);

        vm.NotifyOpened();

        Assert.Equal("Roadster", field.Value); // reseeded from getDefaultValue
        Assert.False(field.Touched);
        Assert.Null(field.DisplayError);
        Assert.Equal("view.opened slug=CommandInputDialog", Assert.Single(lines));
    }

    [Fact]
    public void RequestClose_raises_close()
    {
        var vm = new CommandInputDialogViewModel(PinForm(), null, Localizer);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        vm.RequestClose();

        Assert.Equal(1, closes);
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_slugs_without_content()
    {
        var lines = new List<string>();
        var diag = new CommandInputDiagnostics(lines.Add);

        diag.RecordViewOpened();
        diag.RecordSubmitted();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal(1, diag.Submitted);
        Assert.Equal("view.opened slug=CommandInputDialog", lines[0]);
        Assert.Equal("command.input.submitted slug=CommandInputDialog", lines[1]);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}

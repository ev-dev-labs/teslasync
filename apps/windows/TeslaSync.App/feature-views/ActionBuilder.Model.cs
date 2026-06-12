using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The four automation action kinds the <see cref="ActionBuilder"/> surface edits — the native union of the web
/// <c>AutomationActionKind</c> (web/src/types/automations.ts). Each maps to a stable wire discriminator via
/// <see cref="AutomationActionKinds"/> so the model round-trips the exact <c>action_command</c> /
/// <c>action_notify</c> / <c>action_set_setting</c> / <c>action_call_automation</c> strings the API expects.
/// </summary>
public enum AutomationActionKind
{
    /// <summary>Issue a vehicle command (web <c>action_command</c>).</summary>
    Command,

    /// <summary>Send a notification through a channel (web <c>action_notify</c>).</summary>
    Notify,

    /// <summary>Persist an application setting (web <c>action_set_setting</c>).</summary>
    SetSetting,

    /// <summary>Invoke another automation (web <c>action_call_automation</c>).</summary>
    CallAutomation,
}

/// <summary>
/// The value editor shape for an <see cref="AutomationActionKind.SetSetting"/> action — the native analogue of
/// the web <c>SettingValueKind</c> ('text' | 'number' | 'boolean'). Chosen from which of the action's value
/// fields is populated and which input control the value row renders.
/// </summary>
public enum SettingValueKind
{
    /// <summary>A free-text value persisted to <see cref="AutomationActionStepInput.ValueText"/>.</summary>
    Text,

    /// <summary>A numeric value persisted to <see cref="AutomationActionStepInput.ValueNum"/>.</summary>
    Number,

    /// <summary>A boolean value persisted to <see cref="AutomationActionStepInput.ValueBool"/>.</summary>
    Boolean,
}

/// <summary>Wire-discriminator mapping for <see cref="AutomationActionKind"/> (web <c>action_*</c> literals).</summary>
public static class AutomationActionKinds
{
    /// <summary>Wire discriminator for <see cref="AutomationActionKind.Command"/>.</summary>
    public const string CommandWire = "action_command";

    /// <summary>Wire discriminator for <see cref="AutomationActionKind.Notify"/>.</summary>
    public const string NotifyWire = "action_notify";

    /// <summary>Wire discriminator for <see cref="AutomationActionKind.SetSetting"/>.</summary>
    public const string SetSettingWire = "action_set_setting";

    /// <summary>Wire discriminator for <see cref="AutomationActionKind.CallAutomation"/>.</summary>
    public const string CallAutomationWire = "action_call_automation";

    /// <summary>The wire discriminator for <paramref name="kind"/>.</summary>
    public static string ToWire(AutomationActionKind kind) => kind switch
    {
        AutomationActionKind.Command => CommandWire,
        AutomationActionKind.Notify => NotifyWire,
        AutomationActionKind.SetSetting => SetSettingWire,
        AutomationActionKind.CallAutomation => CallAutomationWire,
        _ => CommandWire,
    };

    /// <summary>Parse <paramref name="wire"/> into a kind, returning <see langword="false"/> when unrecognized.</summary>
    public static bool TryFromWire(string? wire, out AutomationActionKind kind)
    {
        switch (wire)
        {
            case CommandWire:
                kind = AutomationActionKind.Command;
                return true;
            case NotifyWire:
                kind = AutomationActionKind.Notify;
                return true;
            case SetSettingWire:
                kind = AutomationActionKind.SetSetting;
                return true;
            case CallAutomationWire:
                kind = AutomationActionKind.CallAutomation;
                return true;
            default:
                kind = AutomationActionKind.Command;
                return false;
        }
    }
}

/// <summary>Wire-discriminator mapping for <see cref="SettingValueKind"/> (web 'text' | 'number' | 'boolean').</summary>
public static class SettingValueKinds
{
    /// <summary>Wire discriminator for <see cref="SettingValueKind.Text"/>.</summary>
    public const string TextWire = "text";

    /// <summary>Wire discriminator for <see cref="SettingValueKind.Number"/>.</summary>
    public const string NumberWire = "number";

    /// <summary>Wire discriminator for <see cref="SettingValueKind.Boolean"/>.</summary>
    public const string BooleanWire = "boolean";

    /// <summary>The wire discriminator for <paramref name="kind"/>.</summary>
    public static string ToWire(SettingValueKind kind) => kind switch
    {
        SettingValueKind.Number => NumberWire,
        SettingValueKind.Boolean => BooleanWire,
        _ => TextWire,
    };

    /// <summary>Parse <paramref name="wire"/> into a value kind (defaults to <see cref="SettingValueKind.Text"/>).</summary>
    public static SettingValueKind FromWire(string? wire) => wire switch
    {
        NumberWire => SettingValueKind.Number,
        BooleanWire => SettingValueKind.Boolean,
        _ => SettingValueKind.Text,
    };
}

/// <summary>
/// The minimal notification-channel projection the <see cref="ActionBuilder"/> notify row binds to — the native
/// analogue of the fields the web <c>ActionBuilder</c> reads off each <c>NotificationChannel</c> prop
/// (web/src/types/notifications.ts): the id (the select value), the display name and kind (the label) and the
/// enabled flag (a disabled channel is shown but not selectable).
/// </summary>
/// <param name="Id">The channel id (the option value).</param>
/// <param name="Name">The channel display name.</param>
/// <param name="Kind">The channel transport kind (e.g. <c>discord</c>), shown in parentheses.</param>
/// <param name="Enabled">Whether the channel is enabled (a disabled channel renders as a disabled option).</param>
public sealed record AutomationChannel(long Id, string Name, string Kind, bool Enabled);

/// <summary>
/// One automation action draft — the native, UI-free analogue of the web <c>AutomationActionStepInput</c>
/// discriminated union (web/src/features/automations/components/stepInputTypes.ts). A single record carries every
/// kind's fields; <see cref="Kind"/> selects which are meaningful, mirroring the web union member for that kind.
/// Command parameters are held as the canonical compact JSON object string in <see cref="CommandParamsJson"/>
/// (the web parsed <c>command_params</c> object) so the model stays value-comparable and free of UI types.
/// </summary>
/// <param name="Kind">The action kind discriminator.</param>
public sealed record AutomationActionStepInput(AutomationActionKind Kind)
{
    /// <summary>The vehicle command name (web <c>command_name</c>); meaningful for <see cref="AutomationActionKind.Command"/>.</summary>
    public string CommandName { get; init; } = string.Empty;

    /// <summary>The validated command parameters as a compact JSON object string, or <see langword="null"/> (web <c>command_params</c>).</summary>
    public string? CommandParamsJson { get; init; }

    /// <summary>The notification channel id (web <c>channel_id</c>); meaningful for <see cref="AutomationActionKind.Notify"/>.</summary>
    public long ChannelId { get; init; }

    /// <summary>The notification message template (web <c>template</c>); meaningful for <see cref="AutomationActionKind.Notify"/>.</summary>
    public string Template { get; init; } = string.Empty;

    /// <summary>The setting key (web <c>setting_key</c>); meaningful for <see cref="AutomationActionKind.SetSetting"/>.</summary>
    public string SettingKey { get; init; } = string.Empty;

    /// <summary>The text setting value (web <c>value_text</c>), or <see langword="null"/> when the value is not text.</summary>
    public string? ValueText { get; init; }

    /// <summary>The numeric setting value (web <c>value_num</c>), or <see langword="null"/> when the value is not numeric.</summary>
    public double? ValueNum { get; init; }

    /// <summary>The boolean setting value (web <c>value_bool</c>), or <see langword="null"/> when the value is not boolean.</summary>
    public bool? ValueBool { get; init; }

    /// <summary>The target automation id (web <c>target_automation_id</c>); meaningful for <see cref="AutomationActionKind.CallAutomation"/>.</summary>
    public long TargetAutomationId { get; init; }

    /// <summary>
    /// Build the default action for <paramref name="kind"/> — the native port of the web <c>createDefaultAction</c>:
    /// a command defaults to <c>climate_on</c>, a notify to the supplied channel with an empty template, a
    /// set-setting to an empty text value and a call-automation to id 0.
    /// </summary>
    /// <param name="kind">The kind to seed.</param>
    /// <param name="channelId">The default channel id for a notify action (web <c>defaultChannelId</c>).</param>
    public static AutomationActionStepInput CreateDefault(AutomationActionKind kind, long channelId = 0) => kind switch
    {
        AutomationActionKind.Command => new AutomationActionStepInput(AutomationActionKind.Command) { CommandName = "climate_on" },
        AutomationActionKind.Notify => new AutomationActionStepInput(AutomationActionKind.Notify) { ChannelId = channelId, Template = string.Empty },
        AutomationActionKind.SetSetting => new AutomationActionStepInput(AutomationActionKind.SetSetting) { SettingKey = string.Empty, ValueText = string.Empty },
        AutomationActionKind.CallAutomation => new AutomationActionStepInput(AutomationActionKind.CallAutomation) { TargetAutomationId = 0 },
        _ => new AutomationActionStepInput(AutomationActionKind.Command) { CommandName = "climate_on" },
    };

    /// <summary>
    /// The current value editor shape for a set-setting action — the native port of the web
    /// <c>settingValueKind</c>: a populated <see cref="ValueNum"/> is numeric, a populated <see cref="ValueBool"/>
    /// is boolean, otherwise text.
    /// </summary>
    /// <param name="action">The set-setting action to inspect.</param>
    public static SettingValueKind SettingValueKindOf(AutomationActionStepInput action)
    {
        ArgumentNullException.ThrowIfNull(action);
        if (action.ValueNum is not null)
        {
            return SettingValueKind.Number;
        }

        if (action.ValueBool is not null)
        {
            return SettingValueKind.Boolean;
        }

        return SettingValueKind.Text;
    }

    /// <summary>
    /// The display string for a set-setting action's current value — the native port of the web value derivation:
    /// the numeric value (or 0), the lower-case boolean literal (or false) or the text value (or empty).
    /// </summary>
    /// <param name="action">The set-setting action to read.</param>
    public static string SettingValueString(AutomationActionStepInput action)
    {
        ArgumentNullException.ThrowIfNull(action);
        return SettingValueKindOf(action) switch
        {
            SettingValueKind.Number => (action.ValueNum ?? 0).ToString(CultureInfo.InvariantCulture),
            SettingValueKind.Boolean => (action.ValueBool ?? false) ? "true" : "false",
            _ => action.ValueText ?? string.Empty,
        };
    }

    /// <summary>
    /// Re-key a set-setting action's value — the native port of the web <c>actionWithSettingValue</c>. The result
    /// keeps the existing <see cref="SettingKey"/> and sets exactly one value field for <paramref name="kind"/>
    /// (parsing the number leniently like JS <c>parseFloat</c>, treating <c>"true"</c> as the only true boolean),
    /// clearing the other two so the action never carries a stale value of a different shape.
    /// </summary>
    /// <param name="action">The set-setting action being edited.</param>
    /// <param name="kind">The chosen value shape.</param>
    /// <param name="value">The raw value text from the input control.</param>
    public static AutomationActionStepInput WithSettingValue(AutomationActionStepInput action, SettingValueKind kind, string? value)
    {
        ArgumentNullException.ThrowIfNull(action);
        return kind switch
        {
            SettingValueKind.Number => new AutomationActionStepInput(AutomationActionKind.SetSetting)
            {
                SettingKey = action.SettingKey,
                ValueNum = JsParseFloatOrZero(value),
            },
            SettingValueKind.Boolean => new AutomationActionStepInput(AutomationActionKind.SetSetting)
            {
                SettingKey = action.SettingKey,
                ValueBool = string.Equals(value, "true", StringComparison.Ordinal),
            },
            _ => new AutomationActionStepInput(AutomationActionKind.SetSetting)
            {
                SettingKey = action.SettingKey,
                ValueText = value ?? string.Empty,
            },
        };
    }

    /// <summary>
    /// Parse the longest valid leading floating-point number from <paramref name="value"/>, returning 0 when none
    /// is present — the native analogue of the web <c>Number.parseFloat(value) || 0</c>.
    /// </summary>
    /// <param name="value">The raw text to parse.</param>
    public static double JsParseFloatOrZero(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return 0;
        }

        ReadOnlySpan<char> span = value.AsSpan().Trim();
        int end = 0;
        if (end < span.Length && (span[end] == '+' || span[end] == '-'))
        {
            end++;
        }

        bool seenDigit = false;
        bool seenDot = false;
        bool seenExponent = false;
        while (end < span.Length)
        {
            char c = span[end];
            if (char.IsAsciiDigit(c))
            {
                seenDigit = true;
                end++;
            }
            else if (c == '.' && !seenDot && !seenExponent)
            {
                seenDot = true;
                end++;
            }
            else if ((c == 'e' || c == 'E') && seenDigit && !seenExponent)
            {
                int look = end + 1;
                if (look < span.Length && (span[look] == '+' || span[look] == '-'))
                {
                    look++;
                }

                if (look < span.Length && char.IsAsciiDigit(span[look]))
                {
                    seenExponent = true;
                    end = look + 1;
                }
                else
                {
                    break;
                }
            }
            else
            {
                break;
            }
        }

        if (!seenDigit)
        {
            return 0;
        }

        return double.TryParse(span[..end], NumberStyles.Float, CultureInfo.InvariantCulture, out double parsed)
            ? parsed
            : 0;
    }

    /// <summary>
    /// Parse the leading base-10 integer from <paramref name="value"/>, returning 0 when none is present — the
    /// native analogue of the web <c>Number.parseInt(value, 10) || 0</c>.
    /// </summary>
    /// <param name="value">The raw text to parse.</param>
    public static long JsParseIntOrZero(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return 0;
        }

        ReadOnlySpan<char> span = value.AsSpan().Trim();
        int end = 0;
        if (end < span.Length && (span[end] == '+' || span[end] == '-'))
        {
            end++;
        }

        int digitsStart = end;
        while (end < span.Length && char.IsAsciiDigit(span[end]))
        {
            end++;
        }

        if (end == digitsStart)
        {
            return 0;
        }

        return long.TryParse(span[..end], NumberStyles.Integer, CultureInfo.InvariantCulture, out long parsed)
            ? parsed
            : 0;
    }
}

/// <summary>
/// The settled outcome of validating the command-parameters editor text — the native port of the web
/// <c>ActionFields</c> command-params <c>onChange</c> branch. <see cref="UpdateParams"/> tells the holder whether
/// to commit a new <see cref="CommandParamsJson"/> onto the action (true for an empty buffer that clears the
/// params, or a buffer that parses to a JSON object), while a non-object or unparseable buffer leaves the action
/// untouched and surfaces a localized <see cref="Error"/>.
/// </summary>
public sealed record CommandParamsParseResult
{
    private CommandParamsParseResult(bool updateParams, string? commandParamsJson, string? error)
    {
        UpdateParams = updateParams;
        CommandParamsJson = commandParamsJson;
        Error = error;
    }

    /// <summary>Whether the action's command parameters should be replaced with <see cref="CommandParamsJson"/>.</summary>
    public bool UpdateParams { get; }

    /// <summary>The new compact JSON object string to commit, or <see langword="null"/> to clear the parameters.</summary>
    public string? CommandParamsJson { get; }

    /// <summary>The localized validation error to surface, or <see langword="null"/> when the buffer is valid.</summary>
    public string? Error { get; }

    /// <summary>An empty buffer: clear the parameters and any error.</summary>
    public static CommandParamsParseResult Cleared() => new(true, null, null);

    /// <summary>A valid JSON object buffer: commit <paramref name="commandParamsJson"/> and clear the error.</summary>
    public static CommandParamsParseResult Updated(string commandParamsJson) => new(true, commandParamsJson, null);

    /// <summary>An invalid buffer: keep the action and surface <paramref name="error"/>.</summary>
    public static CommandParamsParseResult Invalid(string error) => new(false, null, error);
}

/// <summary>One automation-type option in the kind selector (web <c>ACTION_TYPES</c> entry).</summary>
/// <param name="Value">The action kind the option selects.</param>
/// <param name="LabelKey">The i18n key for the option label.</param>
/// <param name="Fallback">The English fallback for the option label.</param>
public sealed record ActionTypeOption(AutomationActionKind Value, string LabelKey, string Fallback);

/// <summary>One vehicle-command option within a <see cref="CommandGroup"/> (web command entry).</summary>
/// <param name="Value">The command name committed to the action.</param>
/// <param name="LabelKey">The i18n key for the command label.</param>
/// <param name="Fallback">The English fallback for the command label.</param>
public sealed record CommandOption(string Value, string LabelKey, string Fallback);

/// <summary>One labelled group of vehicle-command options (web <c>COMMAND_GROUPS</c> entry).</summary>
/// <param name="LabelKey">The i18n key for the group label.</param>
/// <param name="Fallback">The English fallback for the group label.</param>
/// <param name="Commands">The commands in the group.</param>
public sealed record CommandGroup(string LabelKey, string Fallback, IReadOnlyList<CommandOption> Commands);

/// <summary>One rendered selector option (value + localized label + optional disabled flag).</summary>
/// <param name="Value">The option value (the action field the option commits).</param>
/// <param name="Label">The localized, render-ready option label.</param>
/// <param name="Disabled">Whether the option is shown but not selectable.</param>
public sealed record OptionItem(string Value, string Label, bool Disabled = false);

/// <summary>
/// Static action / command catalog — the native port of the web <c>ACTION_TYPES</c> and <c>COMMAND_GROUPS</c>
/// tables (web/src/features/automations/pages/ActionBuilder.tsx). Carries only i18n keys and English fallbacks so
/// the catalog is data, resolved to localized labels at projection time.
/// </summary>
public static class ActionCatalog
{
    /// <summary>The four action-type options, in web order.</summary>
    public static IReadOnlyList<ActionTypeOption> ActionTypes { get; } = new[]
    {
        new ActionTypeOption(AutomationActionKind.Command, "automations.actions.command", "Vehicle Command"),
        new ActionTypeOption(AutomationActionKind.Notify, "automations.actions.notify", "Send Notification"),
        new ActionTypeOption(AutomationActionKind.SetSetting, "automations.actions.setSetting", "Set Setting"),
        new ActionTypeOption(AutomationActionKind.CallAutomation, "automations.actions.callAutomation", "Call Automation"),
    };

    /// <summary>The grouped vehicle-command catalog, in web order.</summary>
    public static IReadOnlyList<CommandGroup> CommandGroups { get; } = new[]
    {
        new CommandGroup("automations.commandGroups.security", "Security & Access", new[]
        {
            new CommandOption("lock", "automations.commands.lock", "Lock Doors"),
            new CommandOption("unlock", "automations.commands.unlock", "Unlock Doors"),
            new CommandOption("sentry_on", "automations.commands.sentryOn", "Sentry Mode On"),
            new CommandOption("sentry_off", "automations.commands.sentryOff", "Sentry Mode Off"),
            new CommandOption("valet_on", "automations.commands.valetOn", "Valet Mode On"),
            new CommandOption("valet_off", "automations.commands.valetOff", "Valet Mode Off"),
        }),
        new CommandGroup("automations.commandGroups.climate", "Climate", new[]
        {
            new CommandOption("climate_on", "automations.commands.climateOn", "Climate On"),
            new CommandOption("climate_off", "automations.commands.climateOff", "Climate Off"),
            new CommandOption("set_temps", "automations.commands.setTemps", "Set Temperature"),
            new CommandOption("seat_heater", "automations.commands.seatHeater", "Seat Heater"),
            new CommandOption("seat_cooler", "automations.commands.seatCooler", "Seat Cooler"),
            new CommandOption("steering_wheel_heat", "automations.commands.steeringWheelHeat", "Steering Wheel Heater"),
            new CommandOption("dog_mode", "automations.commands.dogMode", "Dog Mode"),
            new CommandOption("camp_mode", "automations.commands.campMode", "Camp Mode"),
        }),
        new CommandGroup("automations.commandGroups.charging", "Charging", new[]
        {
            new CommandOption("charge_start", "automations.commands.chargeStart", "Start Charging"),
            new CommandOption("charge_stop", "automations.commands.chargeStop", "Stop Charging"),
            new CommandOption("set_charge_limit", "automations.commands.setChargeLimit", "Set Charge Limit"),
            new CommandOption("set_charging_amps", "automations.commands.setChargingAmps", "Set Charging Amps"),
            new CommandOption("open_charge_port", "automations.commands.openChargePort", "Open Charge Port"),
            new CommandOption("close_charge_port", "automations.commands.closeChargePort", "Close Charge Port"),
        }),
        new CommandGroup("automations.commandGroups.doors", "Doors & Trunk", new[]
        {
            new CommandOption("frunk_open", "automations.commands.frunkOpen", "Open Frunk"),
            new CommandOption("trunk_open", "automations.commands.trunkOpen", "Open Trunk"),
        }),
        new CommandGroup("automations.commandGroups.alerts", "Alerts", new[]
        {
            new CommandOption("honk", "automations.commands.honk", "Honk Horn"),
            new CommandOption("flash", "automations.commands.flash", "Flash Lights"),
        }),
        new CommandGroup("automations.commandGroups.navigation", "Navigation", new[]
        {
            new CommandOption("navigation_request", "automations.commands.navigationRequest", "Navigate to Address"),
            new CommandOption("navigation_gps_request", "automations.commands.navigationGpsRequest", "Navigate to GPS"),
            new CommandOption("trigger_homelink", "automations.commands.triggerHomelink", "Trigger HomeLink"),
        }),
        new CommandGroup("automations.commandGroups.driveSoftware", "Drive & Software", new[]
        {
            new CommandOption("remote_start_drive", "automations.commands.remoteStartDrive", "Remote Start"),
            new CommandOption("wake_up", "automations.commands.wakeUp", "Wake Up"),
        }),
    };
}

/// <summary>
/// The transient, per-row editor buffer for the command-parameters textarea — the native analogue of the web
/// <c>ActionFields</c> local <c>paramsText</c> / <c>paramsError</c> state. Held outside the canonical action so an
/// in-progress, not-yet-valid edit is shown verbatim (with its error) without mutating the committed action,
/// exactly as the web component keeps the raw textarea text separate from the parsed <c>command_params</c>.
/// </summary>
/// <param name="CommandParamsText">The raw textarea text.</param>
/// <param name="CommandParamsError">The current localized validation error, or <see langword="null"/>.</param>
public sealed record ActionRowEditState(string CommandParamsText, string? CommandParamsError)
{
    /// <summary>The resting editor state (empty buffer, no error).</summary>
    public static ActionRowEditState Empty { get; } = new(string.Empty, null);
}

/// <summary>The kind-specific field display for one action row — the base of the four field shapes below.</summary>
/// <param name="Kind">The action kind these fields render.</param>
public abstract record ActionFieldsDisplay(AutomationActionKind Kind);

/// <summary>The command row fields (web <c>action_command</c> branch): the command selector and params editor.</summary>
/// <param name="CommandLabel">The localized command-selector label.</param>
/// <param name="CommandOptions">The grouped command options (incl. the leading "Select command…" entry).</param>
/// <param name="CommandValue">The selected command name.</param>
/// <param name="ParamsLabel">The localized params editor label.</param>
/// <param name="ParamsText">The current params editor buffer text.</param>
/// <param name="ParamsHint">The localized params editor hint.</param>
/// <param name="ParamsError">The current localized params validation error, or <see langword="null"/>.</param>
public sealed record CommandFieldsDisplay(
    string CommandLabel,
    IReadOnlyList<OptionItem> CommandOptions,
    string CommandValue,
    string ParamsLabel,
    string ParamsText,
    string ParamsHint,
    string? ParamsError) : ActionFieldsDisplay(AutomationActionKind.Command);

/// <summary>The notify row fields (web <c>action_notify</c> branch): the channel selector and message editor.</summary>
/// <param name="ChannelLabel">The localized channel-selector label.</param>
/// <param name="ChannelOptions">The channel options (or the single "No channels configured" fallback).</param>
/// <param name="ChannelValue">The selected channel id, as a string.</param>
/// <param name="MessageLabel">The localized message editor label.</param>
/// <param name="MessageValue">The current message template.</param>
/// <param name="MessageHint">The localized message editor hint.</param>
public sealed record NotifyFieldsDisplay(
    string ChannelLabel,
    IReadOnlyList<OptionItem> ChannelOptions,
    string ChannelValue,
    string MessageLabel,
    string MessageValue,
    string MessageHint) : ActionFieldsDisplay(AutomationActionKind.Notify);

/// <summary>The set-setting row fields (web <c>action_set_setting</c> branch): key, value type and value editor.</summary>
/// <param name="SettingKeyLabel">The localized setting-key label.</param>
/// <param name="SettingKeyValue">The current setting key.</param>
/// <param name="SettingKeyHint">The localized setting-key hint.</param>
/// <param name="ValueTypeLabel">The localized value-type selector label.</param>
/// <param name="ValueTypeOptions">The text / number / boolean value-type options.</param>
/// <param name="ValueTypeValue">The selected value-type wire token.</param>
/// <param name="ValueLabel">The localized value editor label.</param>
/// <param name="ValueIsBoolean">Whether the value editor is the boolean selector.</param>
/// <param name="ValueIsNumber">Whether the value editor is the numeric input.</param>
/// <param name="ValueBooleanOptions">The true / false options for the boolean selector.</param>
/// <param name="ValueValue">The current value, as a string.</param>
/// <param name="ValueHint">The localized value hint (text / number variants).</param>
public sealed record SetSettingFieldsDisplay(
    string SettingKeyLabel,
    string SettingKeyValue,
    string SettingKeyHint,
    string ValueTypeLabel,
    IReadOnlyList<OptionItem> ValueTypeOptions,
    string ValueTypeValue,
    string ValueLabel,
    bool ValueIsBoolean,
    bool ValueIsNumber,
    IReadOnlyList<OptionItem> ValueBooleanOptions,
    string ValueValue,
    string ValueHint) : ActionFieldsDisplay(AutomationActionKind.SetSetting);

/// <summary>The call-automation row fields (web <c>action_call_automation</c> branch): the target id input.</summary>
/// <param name="TargetLabel">The localized target-automation-id label.</param>
/// <param name="TargetValue">The current target automation id, as a string (empty when unset).</param>
public sealed record CallAutomationFieldsDisplay(
    string TargetLabel,
    string TargetValue) : ActionFieldsDisplay(AutomationActionKind.CallAutomation);

/// <summary>The fully projected display for one action row (the web per-action <c>GlassPanel</c>).</summary>
/// <param name="Number">The 1-based row position.</param>
/// <param name="NumberLabel">The localized row-number label (e.g. <c>1.</c>).</param>
/// <param name="ActionTypeLabel">The localized action-type selector label.</param>
/// <param name="ShowActionTypeLabel">Whether to show the action-type label (only the first row, web parity).</param>
/// <param name="ActionTypeOptions">The four action-type options.</param>
/// <param name="SelectedKindValue">The selected action-kind wire token.</param>
/// <param name="Fields">The kind-specific field display.</param>
/// <param name="CanMoveUp">Whether the move-up affordance is enabled.</param>
/// <param name="CanMoveDown">Whether the move-down affordance is enabled.</param>
/// <param name="MoveUpLabel">The localized move-up accessible name.</param>
/// <param name="MoveDownLabel">The localized move-down accessible name.</param>
/// <param name="RemoveLabel">The localized remove accessible name.</param>
public sealed record ActionRowDisplay(
    int Number,
    string NumberLabel,
    string ActionTypeLabel,
    bool ShowActionTypeLabel,
    IReadOnlyList<OptionItem> ActionTypeOptions,
    string SelectedKindValue,
    ActionFieldsDisplay Fields,
    bool CanMoveUp,
    bool CanMoveDown,
    string MoveUpLabel,
    string MoveDownLabel,
    string RemoveLabel);

/// <summary>
/// The fully projected, render-ready view of the whole builder — the native analogue of the web
/// <c>ActionBuilder</c> render output. Carries the per-row displays, the empty-state copy shown when there are no
/// actions, the localized "Add Action" label and the surface's accessible region name. Pure data (no WinUI types)
/// so the projection is unit-tested headlessly.
/// </summary>
/// <param name="Rows">The projected action rows, in order.</param>
/// <param name="IsEmpty">Whether there are no actions (the friendly empty state is shown).</param>
/// <param name="EmptyMessage">The localized empty-state message.</param>
/// <param name="AddActionLabel">The localized "Add Action" button label.</param>
/// <param name="RegionName">The surface's accessible (Narrator) region name.</param>
public sealed record ActionBuilderDisplay(
    IReadOnlyList<ActionRowDisplay> Rows,
    bool IsEmpty,
    string EmptyMessage,
    string AddActionLabel,
    string RegionName);

/// <summary>
/// Pure projection from the action drafts, their editor buffers and the available channels to the render-ready
/// <see cref="ActionBuilderDisplay"/> — the native port of the web <c>ActionBuilder</c> render
/// (web/src/features/automations/pages/ActionBuilder.tsx). Every owned string resolves through the i18n facade
/// using the web's natural keys with the web's English fallbacks; no SI conversion applies (the surface carries no
/// measurements). UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class ActionBuilderProjection
{
    /// <summary>Segoe Fluent "Add" glyph for the add-action button (web Lucide <c>Plus</c>).</summary>
    public const string AddGlyph = "\uE710";

    /// <summary>Segoe Fluent "ChevronUp" glyph for the move-up button (web Lucide <c>ChevronUp</c>).</summary>
    public const string MoveUpGlyph = "\uE70E";

    /// <summary>Segoe Fluent "ChevronDown" glyph for the move-down button (web Lucide <c>ChevronDown</c>).</summary>
    public const string MoveDownGlyph = "\uE70D";

    /// <summary>Segoe Fluent "Delete" glyph for the remove button (web Lucide <c>Trash2</c>).</summary>
    public const string RemoveGlyph = "\uE74D";

    private const string ActionTypeKey = "automations.builder.actionType";
    private const string ActionTypeFallback = "Action Type";
    private const string MoveUpKey = "automations.builder.moveUp";
    private const string MoveUpFallback = "Move up";
    private const string MoveDownKey = "automations.builder.moveDown";
    private const string MoveDownFallback = "Move down";
    private const string RemoveKey = "automations.builder.removeAction";
    private const string RemoveFallback = "Remove action";
    private const string AddActionKey = "automations.builder.addAction";
    private const string AddActionFallback = "Add Action";
    private const string SelectCommandKey = "automations.builder.selectCommand";
    private const string SelectCommandFallback = "Select command...";
    private const string CommandKey = "automations.builder.command";
    private const string CommandFallback = "Command";
    private const string ParamsKey = "automations.builder.commandParams";
    private const string ParamsFallback = "Params (JSON, optional)";
    private const string ParamsObjectErrorKey = "automations.builder.commandParamsObjectError";
    private const string ParamsObjectErrorFallback = "Params must be a JSON object.";
    private const string InvalidJsonKey = "automations.builder.invalidJson";
    private const string InvalidJsonFallback = "Invalid JSON";
    private const string ParamsHintKey = "automations.builder.commandParamsPlaceholder"; // parity:allow web i18n key name, not a stub marker
    private const string ParamsHintFallback = "{\"temp\": 21}";
    private const string ChannelKey = "automations.builder.channel";
    private const string ChannelFallback = "Channel";
    private const string NoChannelsKey = "automations.builder.noChannels";
    private const string NoChannelsFallback = "No channels configured";
    private const string MessageKey = "automations.builder.notifyMessage";
    private const string MessageFallback = "Message";
    private const string MessageHintKey = "automations.builder.notifyPlaceholder"; // parity:allow web i18n key name, not a stub marker
    private const string MessageHintFallback = "Car is warming up!";
    private const string SettingKeyKey = "automations.builder.settingKey";
    private const string SettingKeyFallback = "Setting Key";
    private const string SettingKeyHintKey = "automations.builder.settingKeyPlaceholder"; // parity:allow web i18n key name, not a stub marker
    private const string SettingKeyHintFallback = "charge_limit";
    private const string ValueTypeKey = "automations.builder.valueType";
    private const string ValueTypeFallback = "Value Type";
    private const string ValueTextOptionKey = "automations.builder.valueText";
    private const string ValueTextOptionFallback = "Text";
    private const string ValueNumberOptionKey = "automations.builder.valueNumber";
    private const string ValueNumberOptionFallback = "Number";
    private const string ValueBooleanOptionKey = "automations.builder.valueBoolean";
    private const string ValueBooleanOptionFallback = "Boolean";
    private const string ValueKey = "automations.builder.value";
    private const string ValueFallback = "Value";
    private const string TrueKey = "common.true";
    private const string TrueFallback = "True";
    private const string FalseKey = "common.false";
    private const string FalseFallback = "False";
    private const string ValueNumberHintKey = "automations.builder.valueNumberPlaceholder"; // parity:allow web i18n key name, not a stub marker
    private const string ValueNumberHintFallback = "80";
    private const string ValueTextHintKey = "automations.builder.valueTextPlaceholder"; // parity:allow web i18n key name, not a stub marker
    private const string ValueTextHintFallback = "enabled";
    private const string TargetKey = "automations.builder.targetAutomationId";
    private const string TargetFallback = "Target Automation ID";
    private const string EmptyKey = "automations.builder.empty";
    private const string EmptyFallback = "No actions yet. Add one to get started.";
    private const string RegionKey = "automations.builder.region";
    private const string RegionFallback = "Action Builder";

    /// <summary>
    /// Validate a command-parameters editor buffer — the native port of the web <c>ActionFields</c> params
    /// <c>onChange</c>: a blank buffer clears the parameters, a JSON object commits its compact form, and a
    /// non-object or unparseable buffer surfaces a localized error without mutating the action.
    /// </summary>
    /// <param name="text">The raw editor buffer text.</param>
    /// <param name="localizer">The i18n facade resolving the error messages.</param>
    public static CommandParamsParseResult ParseCommandParams(string? text, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string value = text ?? string.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return CommandParamsParseResult.Cleared();
        }

        JsonNode? node;
        try
        {
            node = JsonNode.Parse(value);
        }
        catch (JsonException)
        {
            return CommandParamsParseResult.Invalid(localizer.GetString(InvalidJsonKey, InvalidJsonFallback));
        }

        if (node is not JsonObject obj)
        {
            return CommandParamsParseResult.Invalid(localizer.GetString(ParamsObjectErrorKey, ParamsObjectErrorFallback));
        }

        return CommandParamsParseResult.Updated(obj.ToJsonString());
    }

    /// <summary>
    /// Pretty-print a compact command-parameters JSON object string for the editor buffer — the native analogue of
    /// the web <c>JSON.stringify(command_params, null, 2)</c>. Returns an empty string when there are no parameters
    /// or the stored value is not parseable.
    /// </summary>
    /// <param name="commandParamsJson">The compact JSON object string, or <see langword="null"/>.</param>
    public static string FormatCommandParams(string? commandParamsJson)
    {
        if (string.IsNullOrWhiteSpace(commandParamsJson))
        {
            return string.Empty;
        }

        try
        {
            JsonNode? node = JsonNode.Parse(commandParamsJson);
            return node is null
                ? string.Empty
                : node.ToJsonString(new JsonSerializerOptions { WriteIndented = true, IndentSize = 2 });
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// Project the builder state into its render-ready display, resolving every string through
    /// <paramref name="localizer"/>.
    /// </summary>
    /// <param name="actions">The action drafts, in order.</param>
    /// <param name="editStates">The per-row editor buffers, aligned 1:1 with <paramref name="actions"/>.</param>
    /// <param name="channels">The available notification channels.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public static ActionBuilderDisplay Project(
        IReadOnlyList<AutomationActionStepInput> actions,
        IReadOnlyList<ActionRowEditState> editStates,
        IReadOnlyList<AutomationChannel> channels,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(editStates);
        ArgumentNullException.ThrowIfNull(channels);
        ArgumentNullException.ThrowIfNull(localizer);

        List<OptionItem> actionTypeOptions = BuildActionTypeOptions(localizer);
        List<OptionItem> channelOptions = BuildChannelOptions(channels);
        List<OptionItem> commandOptions = BuildCommandOptions(localizer);
        OptionItem[] valueTypeOptions = BuildValueTypeOptions(localizer);
        OptionItem[] booleanOptions = BuildBooleanOptions(localizer);

        string actionTypeLabel = localizer.GetString(ActionTypeKey, ActionTypeFallback);
        string moveUpLabel = localizer.GetString(MoveUpKey, MoveUpFallback);
        string moveDownLabel = localizer.GetString(MoveDownKey, MoveDownFallback);
        string removeLabel = localizer.GetString(RemoveKey, RemoveFallback);

        var rows = new List<ActionRowDisplay>(actions.Count);
        for (int i = 0; i < actions.Count; i++)
        {
            AutomationActionStepInput action = actions[i];
            ActionRowEditState edit = i < editStates.Count ? editStates[i] : ActionRowEditState.Empty;
            ActionFieldsDisplay fields = BuildFields(action, edit, commandOptions, channelOptions, valueTypeOptions, booleanOptions, localizer);

            rows.Add(new ActionRowDisplay(
                Number: i + 1,
                NumberLabel: (i + 1).ToString(CultureInfo.InvariantCulture) + ".",
                ActionTypeLabel: actionTypeLabel,
                ShowActionTypeLabel: i == 0,
                ActionTypeOptions: actionTypeOptions,
                SelectedKindValue: AutomationActionKinds.ToWire(action.Kind),
                Fields: fields,
                CanMoveUp: i > 0,
                CanMoveDown: i < actions.Count - 1,
                MoveUpLabel: moveUpLabel,
                MoveDownLabel: moveDownLabel,
                RemoveLabel: removeLabel));
        }

        return new ActionBuilderDisplay(
            Rows: rows,
            IsEmpty: actions.Count == 0,
            EmptyMessage: localizer.GetString(EmptyKey, EmptyFallback),
            AddActionLabel: localizer.GetString(AddActionKey, AddActionFallback),
            RegionName: localizer.GetString(RegionKey, RegionFallback));
    }

    private static ActionFieldsDisplay BuildFields(
        AutomationActionStepInput action,
        ActionRowEditState edit,
        IReadOnlyList<OptionItem> commandOptions,
        List<OptionItem> channelOptions,
        OptionItem[] valueTypeOptions,
        OptionItem[] booleanOptions,
        ILocalizer localizer)
    {
        switch (action.Kind)
        {
            case AutomationActionKind.Command:
                return new CommandFieldsDisplay(
                    CommandLabel: localizer.GetString(CommandKey, CommandFallback),
                    CommandOptions: commandOptions,
                    CommandValue: action.CommandName,
                    ParamsLabel: localizer.GetString(ParamsKey, ParamsFallback),
                    ParamsText: edit.CommandParamsText,
                    ParamsHint: localizer.GetString(ParamsHintKey, ParamsHintFallback),
                    ParamsError: edit.CommandParamsError);

            case AutomationActionKind.Notify:
                IReadOnlyList<OptionItem> options = channelOptions.Count > 0
                    ? channelOptions
                    : new[] { new OptionItem("0", localizer.GetString(NoChannelsKey, NoChannelsFallback)) };
                return new NotifyFieldsDisplay(
                    ChannelLabel: localizer.GetString(ChannelKey, ChannelFallback),
                    ChannelOptions: options,
                    ChannelValue: action.ChannelId.ToString(CultureInfo.InvariantCulture),
                    MessageLabel: localizer.GetString(MessageKey, MessageFallback),
                    MessageValue: action.Template,
                    MessageHint: localizer.GetString(MessageHintKey, MessageHintFallback));

            case AutomationActionKind.SetSetting:
                SettingValueKind valueKind = AutomationActionStepInput.SettingValueKindOf(action);
                return new SetSettingFieldsDisplay(
                    SettingKeyLabel: localizer.GetString(SettingKeyKey, SettingKeyFallback),
                    SettingKeyValue: action.SettingKey,
                    SettingKeyHint: localizer.GetString(SettingKeyHintKey, SettingKeyHintFallback),
                    ValueTypeLabel: localizer.GetString(ValueTypeKey, ValueTypeFallback),
                    ValueTypeOptions: valueTypeOptions,
                    ValueTypeValue: SettingValueKinds.ToWire(valueKind),
                    ValueLabel: localizer.GetString(ValueKey, ValueFallback),
                    ValueIsBoolean: valueKind == SettingValueKind.Boolean,
                    ValueIsNumber: valueKind == SettingValueKind.Number,
                    ValueBooleanOptions: booleanOptions,
                    ValueValue: AutomationActionStepInput.SettingValueString(action),
                    ValueHint: valueKind == SettingValueKind.Number
                        ? localizer.GetString(ValueNumberHintKey, ValueNumberHintFallback)
                        : localizer.GetString(ValueTextHintKey, ValueTextHintFallback));

            case AutomationActionKind.CallAutomation:
                return new CallAutomationFieldsDisplay(
                    TargetLabel: localizer.GetString(TargetKey, TargetFallback),
                    TargetValue: action.TargetAutomationId == 0
                        ? string.Empty
                        : action.TargetAutomationId.ToString(CultureInfo.InvariantCulture));

            default:
                return new CommandFieldsDisplay(
                    CommandLabel: localizer.GetString(CommandKey, CommandFallback),
                    CommandOptions: commandOptions,
                    CommandValue: action.CommandName,
                    ParamsLabel: localizer.GetString(ParamsKey, ParamsFallback),
                    ParamsText: edit.CommandParamsText,
                    ParamsHint: localizer.GetString(ParamsHintKey, ParamsHintFallback),
                    ParamsError: edit.CommandParamsError);
        }
    }

    private static List<OptionItem> BuildActionTypeOptions(ILocalizer localizer) =>
        ActionCatalog.ActionTypes
            .Select(option => new OptionItem(
                AutomationActionKinds.ToWire(option.Value),
                localizer.GetString(option.LabelKey, option.Fallback)))
            .ToList();

    private static List<OptionItem> BuildChannelOptions(IReadOnlyList<AutomationChannel> channels) =>
        channels
            .Select(channel => new OptionItem(
                channel.Id.ToString(CultureInfo.InvariantCulture),
                channel.Name + " (" + channel.Kind + ")",
                !channel.Enabled))
            .ToList();

    private static List<OptionItem> BuildCommandOptions(ILocalizer localizer)
    {
        var options = new List<OptionItem>
        {
            new(string.Empty, localizer.GetString(SelectCommandKey, SelectCommandFallback)),
        };

        foreach (CommandGroup group in ActionCatalog.CommandGroups)
        {
            string groupLabel = localizer.GetString(group.LabelKey, group.Fallback);
            foreach (CommandOption command in group.Commands)
            {
                options.Add(new OptionItem(
                    command.Value,
                    groupLabel + " - " + localizer.GetString(command.LabelKey, command.Fallback)));
            }
        }

        return options;
    }

    private static OptionItem[] BuildValueTypeOptions(ILocalizer localizer) => new[]
    {
        new OptionItem(SettingValueKinds.TextWire, localizer.GetString(ValueTextOptionKey, ValueTextOptionFallback)),
        new OptionItem(SettingValueKinds.NumberWire, localizer.GetString(ValueNumberOptionKey, ValueNumberOptionFallback)),
        new OptionItem(SettingValueKinds.BooleanWire, localizer.GetString(ValueBooleanOptionKey, ValueBooleanOptionFallback)),
    };

    private static OptionItem[] BuildBooleanOptions(ILocalizer localizer) => new[]
    {
        new OptionItem("true", localizer.GetString(TrueKey, TrueFallback)),
        new OptionItem("false", localizer.GetString(FalseKey, FalseFallback)),
    };
}

/// <summary>
/// Canonical metadata for the ActionBuilder surface — the native anchor for the web component at
/// web/src/features/automations/pages/ActionBuilder.tsx. The diagnostics <see cref="Slug"/> is the stable surface
/// name emitted with the <c>view.opened</c> event (P1/S11 diagnostics contract).
/// </summary>
public static class ActionBuilderRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ActionBuilder";
}

/// <summary>
/// PII-safe diagnostics for the ActionBuilder surface (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never an action's command, channel, message template, setting
/// key or value — so a diagnostics line can never leak automation content. Thread-safe.
/// </summary>
public sealed class ActionBuilderDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public ActionBuilderDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ActionBuilder</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ActionBuilderRegistration.Slug}");
    }
}

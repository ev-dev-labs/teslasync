using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>The mutually-exclusive surface state for the <see cref="ActionBuilderViewModel"/>.</summary>
public enum ActionBuilderState
{
    /// <summary>No actions yet — the friendly empty state plus the "Add Action" button are shown.</summary>
    Empty,

    /// <summary>One or more action rows are present.</summary>
    Populated,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ActionBuilder"/> view — the native port of the web
/// <c>ActionBuilder</c> hook composition (web/src/features/automations/pages/ActionBuilder.tsx). It owns the
/// ordered action drafts (the web controlled <c>actions</c> prop) and their per-row command-parameters editor
/// buffers (the web <c>ActionFields</c> local <c>paramsText</c> / <c>paramsError</c> state), exposes the add /
/// remove / reorder / kind-change and per-field edit operations the view invokes, and re-projects through
/// <see cref="ActionBuilderProjection"/> after every change so the view is a thin renderer. Every mutation that
/// changes an action raises <see cref="ActionsChanged"/> — the native analogue of the web <c>onChange</c>
/// callback — while an in-progress, not-yet-valid command-params edit updates only the editor buffer and its
/// error (no <see cref="ActionsChanged"/>), exactly as the web keeps the raw textarea text separate from the
/// committed <c>command_params</c>. The only async-free seam is the i18n facade (the web single
/// <c>useTranslation</c> hook); there is no network load, so the surface has no loading / stale / offline state.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ActionBuilderViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly List<AutomationActionStepInput> _actions;
    private readonly List<ActionRowEditState> _editStates;
    private readonly IReadOnlyList<AutomationChannel> _channels;
    private readonly long _defaultChannelId;

    private ActionBuilderDisplay _display;

    /// <summary>Creates the holder over the i18n facade, the available channels and optional initial actions.</summary>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="channels">The available notification channels (web <c>channels</c> prop); defaults to none.</param>
    /// <param name="initialActions">The initial action drafts (web initial <c>actions</c> prop); defaults to none.</param>
    public ActionBuilderViewModel(
        ILocalizer localizer,
        IReadOnlyList<AutomationChannel>? channels = null,
        IReadOnlyList<AutomationActionStepInput>? initialActions = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _channels = channels is null ? Array.Empty<AutomationChannel>() : channels.ToArray();
        _defaultChannelId = DefaultChannelIdFor(_channels);

        _actions = initialActions is null
            ? new List<AutomationActionStepInput>()
            : initialActions.ToList();
        _editStates = _actions
            .Select(action => action.Kind == AutomationActionKind.Command
                ? new ActionRowEditState(ActionBuilderProjection.FormatCommandParams(action.CommandParamsJson), null)
                : ActionRowEditState.Empty)
            .ToList();

        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised whenever the committed action list changes (the native analogue of the web <c>onChange</c>).</summary>
    public event EventHandler? ActionsChanged;

    /// <summary>The projected, render-ready display for the current builder state.</summary>
    public ActionBuilderDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(IsEmpty));
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ActionBuilderState State => _actions.Count == 0 ? ActionBuilderState.Empty : ActionBuilderState.Populated;

    /// <summary>True when there are no actions (the friendly empty state is shown).</summary>
    public bool IsEmpty => _actions.Count == 0;

    /// <summary>The committed action drafts, in order (a read-only view over the live list).</summary>
    public IReadOnlyList<AutomationActionStepInput> Actions => _actions.AsReadOnly();

    /// <summary>The available notification channels.</summary>
    public IReadOnlyList<AutomationChannel> Channels => _channels;

    /// <summary>The default channel id seeded into a new notify action (web <c>defaultChannelId</c>).</summary>
    public long DefaultChannelId => _defaultChannelId;

    /// <summary>Append a new default command action (web <c>addAction</c>).</summary>
    public void AddAction()
    {
        _actions.Add(AutomationActionStepInput.CreateDefault(AutomationActionKind.Command, _defaultChannelId));
        _editStates.Add(ActionRowEditState.Empty);
        Mutated();
    }

    /// <summary>Remove the action at <paramref name="index"/> (web <c>removeAction</c>); a no-op when out of range.</summary>
    /// <param name="index">The zero-based row index to remove.</param>
    public void RemoveAction(int index)
    {
        if (!InRange(index))
        {
            return;
        }

        _actions.RemoveAt(index);
        _editStates.RemoveAt(index);
        Mutated();
    }

    /// <summary>
    /// Move the action at <paramref name="index"/> by <paramref name="direction"/> (-1 up, +1 down) — the native
    /// port of the web <c>moveAction</c>. A no-op when the move would leave the list bounds.
    /// </summary>
    /// <param name="index">The zero-based row index to move.</param>
    /// <param name="direction">-1 to move up, +1 to move down.</param>
    public void MoveAction(int index, int direction)
    {
        if (!InRange(index))
        {
            return;
        }

        int target = index + direction;
        if (target < 0 || target >= _actions.Count)
        {
            return;
        }

        (_actions[index], _actions[target]) = (_actions[target], _actions[index]);
        (_editStates[index], _editStates[target]) = (_editStates[target], _editStates[index]);
        Mutated();
    }

    /// <summary>
    /// Replace the action at <paramref name="index"/> with a fresh default of <paramref name="kind"/> — the native
    /// port of the web action-type selector <c>replaceAction(index, createDefaultAction(kind, defaultChannelId))</c>.
    /// Resets the row's command-parameters editor buffer.
    /// </summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="kind">The new action kind.</param>
    public void ChangeKind(int index, AutomationActionKind kind)
    {
        if (!InRange(index))
        {
            return;
        }

        _actions[index] = AutomationActionStepInput.CreateDefault(kind, _defaultChannelId);
        _editStates[index] = ActionRowEditState.Empty;
        Mutated();
    }

    /// <summary>Set a command action's command name (web command selector <c>onChange</c>).</summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="commandName">The selected command name.</param>
    public void SetCommandName(int index, string? commandName)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.Command)
        {
            return;
        }

        _actions[index] = _actions[index] with { CommandName = commandName ?? string.Empty };
        Mutated();
    }

    /// <summary>
    /// Apply a command-parameters editor edit — the native port of the web params <c>onChange</c>. The editor
    /// buffer always reflects the typed text; a blank buffer clears the parameters and a JSON object commits them
    /// (raising <see cref="ActionsChanged"/>), while a non-object or unparseable buffer leaves the committed action
    /// untouched and surfaces a localized error.
    /// </summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="text">The raw editor buffer text.</param>
    public void SetCommandParamsText(int index, string? text)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.Command)
        {
            return;
        }

        string buffer = text ?? string.Empty;
        CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams(buffer, _localizer);
        _editStates[index] = new ActionRowEditState(buffer, result.Error);

        bool actionChanged = false;
        if (result.UpdateParams)
        {
            AutomationActionStepInput next = _actions[index] with { CommandParamsJson = result.CommandParamsJson };
            if (!string.Equals(next.CommandParamsJson, _actions[index].CommandParamsJson, StringComparison.Ordinal))
            {
                _actions[index] = next;
                actionChanged = true;
            }
        }

        Reproject();
        if (actionChanged)
        {
            RaiseActionsChanged();
        }
    }

    /// <summary>Set a notify action's channel from a raw option value (web channel selector <c>onChange</c>).</summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="channelValue">The selected channel option value.</param>
    public void SetChannelId(int index, string? channelValue)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.Notify)
        {
            return;
        }

        _actions[index] = _actions[index] with { ChannelId = AutomationActionStepInput.JsParseIntOrZero(channelValue) };
        Mutated();
    }

    /// <summary>Set a notify action's message template (web message editor <c>onChange</c>).</summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="template">The message template text.</param>
    public void SetTemplate(int index, string? template)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.Notify)
        {
            return;
        }

        _actions[index] = _actions[index] with { Template = template ?? string.Empty };
        Mutated();
    }

    /// <summary>Set a set-setting action's key (web setting-key input <c>onChange</c>).</summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="settingKey">The setting key text.</param>
    public void SetSettingKey(int index, string? settingKey)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.SetSetting)
        {
            return;
        }

        _actions[index] = _actions[index] with { SettingKey = settingKey ?? string.Empty };
        Mutated();
    }

    /// <summary>
    /// Re-key a set-setting action's value type (web value-type selector <c>onChange</c>) — carries the current
    /// value across to the new shape via <see cref="AutomationActionStepInput.WithSettingValue"/>.
    /// </summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="valueKind">The chosen value type.</param>
    public void SetValueKind(int index, SettingValueKind valueKind)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.SetSetting)
        {
            return;
        }

        AutomationActionStepInput action = _actions[index];
        string current = AutomationActionStepInput.SettingValueString(action);
        _actions[index] = AutomationActionStepInput.WithSettingValue(action, valueKind, current);
        Mutated();
    }

    /// <summary>Set a set-setting action's value (web value input / boolean selector <c>onChange</c>).</summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="value">The raw value text.</param>
    public void SetValue(int index, string? value)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.SetSetting)
        {
            return;
        }

        AutomationActionStepInput action = _actions[index];
        SettingValueKind kind = AutomationActionStepInput.SettingValueKindOf(action);
        _actions[index] = AutomationActionStepInput.WithSettingValue(action, kind, value);
        Mutated();
    }

    /// <summary>Set a call-automation action's target id from raw text (web target-id input <c>onChange</c>).</summary>
    /// <param name="index">The zero-based row index.</param>
    /// <param name="targetValue">The raw target automation id text.</param>
    public void SetTargetAutomationId(int index, string? targetValue)
    {
        if (!InRange(index) || _actions[index].Kind != AutomationActionKind.CallAutomation)
        {
            return;
        }

        _actions[index] = _actions[index] with
        {
            TargetAutomationId = AutomationActionStepInput.JsParseIntOrZero(targetValue),
        };
        Mutated();
    }

    /// <summary>
    /// Re-resolve every label from the localizer and re-project — the native analogue of react-i18next
    /// re-rendering after the active language changes. Also re-localizes any command-parameters validation error.
    /// </summary>
    public void Reload()
    {
        for (int i = 0; i < _actions.Count; i++)
        {
            if (_actions[i].Kind == AutomationActionKind.Command && _editStates[i].CommandParamsError is not null)
            {
                CommandParamsParseResult result = ActionBuilderProjection.ParseCommandParams(_editStates[i].CommandParamsText, _localizer);
                _editStates[i] = _editStates[i] with { CommandParamsError = result.Error };
            }
        }

        Reproject();
    }

    private static long DefaultChannelIdFor(IReadOnlyList<AutomationChannel> channels)
    {
        foreach (AutomationChannel channel in channels)
        {
            if (channel.Enabled)
            {
                return channel.Id;
            }
        }

        return channels.Count > 0 ? channels[0].Id : 0;
    }

    private bool InRange(int index) => index >= 0 && index < _actions.Count;

    private ActionBuilderDisplay Project() =>
        ActionBuilderProjection.Project(_actions, _editStates, _channels, _localizer);

    private void Reproject() => Display = Project();

    private void Mutated()
    {
        Reproject();
        RaiseActionsChanged();
    }

    private void RaiseActionsChanged()
    {
        Raise(nameof(Actions));
        ActionsChanged?.Invoke(this, EventArgs.Empty);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

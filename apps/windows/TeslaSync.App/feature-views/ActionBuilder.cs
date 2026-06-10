using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 ActionBuilder surface — a parity port of
/// web/src/features/automations/pages/ActionBuilder.tsx. It reproduces the web component's composition: an ordered
/// list of action cards (each a tokenized <see cref="TsGlassPanel"/> carrying a position number, the action-type
/// selector, the kind-specific fields and the move-up / move-down / remove affordances) above an "Add Action"
/// button. The four kind branches mirror the web <c>ActionFields</c>: a command selector with an optional JSON
/// parameters editor (validated on every edit), a notification channel selector with a message editor (falling
/// back to a single "No channels configured" option), a setting key / value-type / value editor (the value being
/// a boolean selector or a text/number input), and a target-automation-id input. There is no loading / stale /
/// offline branch because the web source has none — the builder is a synchronous controlled form whose only seam
/// is i18n; when there are no actions the friendly empty state is shown above the still-present Add button. All
/// state and projection flow through the shared <see cref="ActionBuilderViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade and every interactive control carries a Narrator label.
/// </summary>
public sealed partial class ActionBuilder : ContentControl, IDisposable
{
    private const double RootSpacing = 12;
    private const double FieldSpacing = 12;

    private readonly ILocalizer _localizer;
    private readonly ActionBuilderViewModel _viewModel;
    private readonly ActionBuilderDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = RootSpacing };
    private readonly StackPanel _rowsHost = new() { Spacing = RootSpacing };
    private readonly TextBlock _emptyState = new() { TextWrapping = TextWrapping.Wrap };
    private readonly TsButton _addButton = new();
    private readonly List<ActionRow> _rows = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over the i18n facade, the available channels, optional diagnostics and seed actions.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="channels">The available notification channels (web <c>channels</c> prop).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    /// <param name="initialActions">Optional initial action drafts (web initial <c>actions</c> prop).</param>
    public ActionBuilder(
        ILocalizer localizer,
        IReadOnlyList<AutomationChannel>? channels = null,
        ActionBuilderDiagnostics? diagnostics = null,
        IReadOnlyList<AutomationActionStepInput>? initialActions = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new ActionBuilderDiagnostics();
        _viewModel = new ActionBuilderViewModel(localizer, channels, initialActions);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _addButton.Click += OnAddClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>ActionBuilder</c>).</summary>
    public static string Slug => ActionBuilderRegistration.Slug;

    /// <summary>The backing state holder (exposes the committed actions and the <c>ActionsChanged</c> event).</summary>
    public ActionBuilderViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory mirroring the sibling surfaces' <c>Create</c> entry point.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="channels">The available notification channels.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public static ActionBuilder Create(
        ILocalizer localizer,
        IReadOnlyList<AutomationChannel>? channels = null,
        ActionBuilderDiagnostics? diagnostics = null) => new(localizer, channels, diagnostics);

    /// <summary>Detach from the view-model and the add button (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _addButton.Click -= OnAddClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    private static TextBlock CreateFieldLabel()
    {
        var label = new TextBlock { TextWrapping = TextWrapping.Wrap };
        if (TypographyTokens.Sans is { } sans)
        {
            label.FontFamily = sans;
        }

        label.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
        label.FontWeight = FontWeights.Medium;
        label.Foreground = DisplayTokens.TextSecondary;
        return label;
    }

    private static StackPanel CreateFieldStack(TextBlock label, FrameworkElement control)
    {
        var stack = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Bottom };
        stack.Children.Add(label);
        stack.Children.Add(control);
        return stack;
    }

    private static void SetTextIfChanged(TextBox box, string value)
    {
        if (!string.Equals(box.Text, value, StringComparison.Ordinal))
        {
            box.Text = value;
        }
    }

    private void BuildChrome()
    {
        _emptyState.FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14);
        _emptyState.Foreground = DisplayTokens.TextMuted;

        _addButton.Variant = ButtonVariant.Subtle;
        _addButton.Size = ControlSize.Small;
        _addButton.IconGlyph = ActionBuilderProjection.AddGlyph;
        _addButton.HorizontalAlignment = HorizontalAlignment.Left;

        _root.Children.Add(_rowsHost);
        _root.Children.Add(_emptyState);
        _root.Children.Add(_addButton);
        Content = _root;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnAddClicked(object sender, RoutedEventArgs e) => _viewModel.AddAction();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        ActionBuilderDisplay display = _viewModel.Display;
        AutomationProperties.SetName(this, display.RegionName);

        while (_rows.Count > display.Rows.Count)
        {
            ActionRow last = _rows[_rows.Count - 1];
            _rowsHost.Children.Remove(last.Root);
            _rows.RemoveAt(_rows.Count - 1);
        }

        while (_rows.Count < display.Rows.Count)
        {
            var row = new ActionRow(this, display.Rows[_rows.Count].ActionTypeOptions);
            _rows.Add(row);
            _rowsHost.Children.Add(row.Root);
        }

        for (int i = 0; i < display.Rows.Count; i++)
        {
            _rows[i].Bind(display.Rows[i]);
        }

        _emptyState.Text = display.EmptyMessage;
        _emptyState.Visibility = display.IsEmpty ? Visibility.Visible : Visibility.Collapsed;
        _rowsHost.Visibility = display.IsEmpty ? Visibility.Collapsed : Visibility.Visible;

        _addButton.Text = display.AddActionLabel;
        AutomationProperties.SetName(_addButton, display.AddActionLabel);
    }

    /// <summary>
    /// One action card's controls — the native analogue of a single web <c>GlassPanel</c> action row. Owns the
    /// persistent chrome (position number, action-type selector, move/remove buttons) and rebuilds its
    /// kind-specific field area only when the field shape changes, so an in-place edit never disturbs input focus.
    /// </summary>
    private sealed class ActionRow
    {
        private const double KindWidth = 192;
        private const double CommandWidth = 256;
        private const double EditorWidth = 280;
        private const double ChannelWidth = 192;
        private const double SettingKeyWidth = 176;
        private const double ValueTypeWidth = 144;
        private const double BooleanWidth = 112;
        private const double ValueWidth = 176;
        private const double TargetWidth = 192;
        private const double EditorMinHeight = 56;

        private readonly ActionBuilder _owner;
        private readonly TsGlassPanel _panel = new();
        private readonly TextBlock _number = new();
        private readonly TextBlock _kindLabel = CreateFieldLabel();
        private readonly TsSelect _kindSelect;
        private readonly StackPanel _kindSpecificHost = new() { Orientation = Orientation.Horizontal, Spacing = FieldSpacing };
        private readonly TsButton _up = new();
        private readonly TsButton _down = new();
        private readonly TsButton _remove = new();

        private bool _suppress;
        private string _shape = string.Empty;

        private TextBlock? _commandLabel;
        private TsSelect? _commandSelect;
        private TextBlock? _paramsLabel;
        private TsTextarea? _paramsArea;
        private TextBlock? _paramsError;
        private TextBlock? _channelLabel;
        private TsSelect? _channelSelect;
        private TextBlock? _messageLabel;
        private TsTextarea? _messageArea;
        private TextBlock? _settingKeyLabel;
        private TsInput? _settingKeyInput;
        private TextBlock? _valueTypeLabel;
        private TsSelect? _valueTypeSelect;
        private TextBlock? _valueLabel;
        private TsSelect? _booleanSelect;
        private TsInput? _valueInput;
        private TextBlock? _targetLabel;
        private TsInput? _targetInput;

        public ActionRow(ActionBuilder owner, IReadOnlyList<OptionItem> actionTypeOptions)
        {
            _owner = owner;

            _number.FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12);
            _number.Foreground = DisplayTokens.TextMuted;
            _number.TextAlignment = TextAlignment.Right;
            _number.Width = 24;
            _number.Margin = new Thickness(0, 28, 0, 0);
            if (TypographyTokens.Mono is { } mono)
            {
                _number.FontFamily = mono;
            }

            AutomationProperties.SetAccessibilityView(_number, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw);

            _kindSelect = BuildSelect(actionTypeOptions);
            _kindSelect.Width = KindWidth;
            _kindSelect.SelectionChanged += OnKindChanged;

            ConfigureIconButton(_up, ActionBuilderProjection.MoveUpGlyph);
            ConfigureIconButton(_down, ActionBuilderProjection.MoveDownGlyph);
            ConfigureIconButton(_remove, ActionBuilderProjection.RemoveGlyph);
            _remove.Foreground = DisplayTokens.Brush("TsColorDangerBrush");
            _up.Click += OnMoveUp;
            _down.Click += OnMoveDown;
            _remove.Click += OnRemove;

            var fieldsRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = FieldSpacing };
            fieldsRow.Children.Add(CreateFieldStack(_kindLabel, _kindSelect));
            fieldsRow.Children.Add(_kindSpecificHost);

            var buttons = new StackPanel { Spacing = 4, Margin = new Thickness(0, 24, 0, 0) };
            buttons.Children.Add(_up);
            buttons.Children.Add(_down);
            buttons.Children.Add(_remove);

            var grid = new Grid { ColumnSpacing = 8 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            Grid.SetColumn(_number, 0);
            Grid.SetColumn(fieldsRow, 1);
            Grid.SetColumn(buttons, 2);
            grid.Children.Add(_number);
            grid.Children.Add(fieldsRow);
            grid.Children.Add(buttons);

            _panel.Padding = new Thickness(16);
            _panel.Content = grid;
        }

        public int Index { get; private set; }

        public FrameworkElement Root => _panel;

        public void Bind(ActionRowDisplay display)
        {
            _suppress = true;

            Index = display.Number - 1;
            _number.Text = display.NumberLabel;
            _kindLabel.Text = display.ActionTypeLabel;
            _kindLabel.Visibility = display.ShowActionTypeLabel ? Visibility.Visible : Visibility.Collapsed;
            AutomationProperties.SetName(_kindSelect, display.ActionTypeLabel);
            SelectValue(_kindSelect, display.SelectedKindValue);

            _up.IsEnabled = display.CanMoveUp;
            _down.IsEnabled = display.CanMoveDown;
            AutomationProperties.SetName(_up, display.MoveUpLabel);
            AutomationProperties.SetName(_down, display.MoveDownLabel);
            AutomationProperties.SetName(_remove, display.RemoveLabel);

            string shape = ShapeOf(display.Fields);
            if (!string.Equals(shape, _shape, StringComparison.Ordinal))
            {
                _shape = shape;
                RebuildFields(display.Fields);
            }

            UpdateFields(display.Fields);
            _suppress = false;
        }

        private static string ShapeOf(ActionFieldsDisplay fields) => fields switch
        {
            CommandFieldsDisplay => "command",
            NotifyFieldsDisplay => "notify",
            SetSettingFieldsDisplay setting => setting.ValueIsBoolean ? "set:bool" : "set:input",
            CallAutomationFieldsDisplay => "call",
            _ => "command",
        };

        private static TsSelect BuildSelect(IReadOnlyList<OptionItem> options)
        {
            var select = new TsSelect();
            foreach (OptionItem option in options)
            {
                select.Items.Add(new ComboBoxItem
                {
                    Content = option.Label,
                    Tag = option.Value,
                    IsEnabled = !option.Disabled,
                });
            }

            return select;
        }

        private static void SelectValue(TsSelect select, string value)
        {
            foreach (object item in select.Items)
            {
                if (item is ComboBoxItem candidate && string.Equals(candidate.Tag as string, value, StringComparison.Ordinal))
                {
                    select.SelectedItem = candidate;
                    return;
                }
            }

            select.SelectedItem = null;
        }

        private static string SelectedValue(TsSelect select) =>
            (select.SelectedItem as ComboBoxItem)?.Tag as string ?? string.Empty;

        private static void ConfigureIconButton(TsButton button, string glyph)
        {
            button.Variant = ButtonVariant.Subtle;
            button.Size = ControlSize.Small;
            button.IconGlyph = glyph;
            button.MinWidth = 32;
        }

        private void RebuildFields(ActionFieldsDisplay fields)
        {
            _kindSpecificHost.Children.Clear();
            _commandLabel = null;
            _commandSelect = null;
            _paramsLabel = null;
            _paramsArea = null;
            _paramsError = null;
            _channelLabel = null;
            _channelSelect = null;
            _messageLabel = null;
            _messageArea = null;
            _settingKeyLabel = null;
            _settingKeyInput = null;
            _valueTypeLabel = null;
            _valueTypeSelect = null;
            _valueLabel = null;
            _booleanSelect = null;
            _valueInput = null;
            _targetLabel = null;
            _targetInput = null;

            switch (fields)
            {
                case CommandFieldsDisplay command:
                    BuildCommandFields(command);
                    break;
                case NotifyFieldsDisplay notify:
                    BuildNotifyFields(notify);
                    break;
                case SetSettingFieldsDisplay setting:
                    BuildSetSettingFields(setting);
                    break;
                case CallAutomationFieldsDisplay call:
                    BuildCallAutomationFields(call);
                    break;
                default:
                    break;
            }
        }

        private void BuildCommandFields(CommandFieldsDisplay command)
        {
            _commandLabel = CreateFieldLabel();
            _commandSelect = BuildSelect(command.CommandOptions);
            _commandSelect.Width = CommandWidth;
            _commandSelect.SelectionChanged += OnCommandChanged;
            _kindSpecificHost.Children.Add(CreateFieldStack(_commandLabel, _commandSelect));

            _paramsLabel = CreateFieldLabel();
            _paramsArea = new TsTextarea { MinWidth = EditorWidth, MinHeight = EditorMinHeight };
            _paramsArea.TextChanged += OnParamsChanged;
            _paramsError = new TextBlock
            {
                TextWrapping = TextWrapping.Wrap,
                FontSize = TypographyTokens.Size("TsTypeBodySmFontSize", 12),
                Foreground = DisplayTokens.Brush("TsColorDangerBrush"),
                Margin = new Thickness(0, 4, 0, 0),
                Visibility = Visibility.Collapsed,
            };

            var paramsStack = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Bottom };
            paramsStack.Children.Add(_paramsLabel);
            paramsStack.Children.Add(_paramsArea);
            paramsStack.Children.Add(_paramsError);
            _kindSpecificHost.Children.Add(paramsStack);
        }

        private void BuildNotifyFields(NotifyFieldsDisplay notify)
        {
            _channelLabel = CreateFieldLabel();
            _channelSelect = BuildSelect(notify.ChannelOptions);
            _channelSelect.Width = ChannelWidth;
            _channelSelect.SelectionChanged += OnChannelChanged;
            _kindSpecificHost.Children.Add(CreateFieldStack(_channelLabel, _channelSelect));

            _messageLabel = CreateFieldLabel();
            _messageArea = new TsTextarea { MinWidth = EditorWidth, MinHeight = EditorMinHeight };
            _messageArea.TextChanged += OnMessageChanged;
            _kindSpecificHost.Children.Add(CreateFieldStack(_messageLabel, _messageArea));
        }

        private void BuildSetSettingFields(SetSettingFieldsDisplay setting)
        {
            _settingKeyLabel = CreateFieldLabel();
            _settingKeyInput = new TsInput { Width = SettingKeyWidth };
            _settingKeyInput.TextChanged += OnSettingKeyChanged;
            _kindSpecificHost.Children.Add(CreateFieldStack(_settingKeyLabel, _settingKeyInput));

            _valueTypeLabel = CreateFieldLabel();
            _valueTypeSelect = BuildSelect(setting.ValueTypeOptions);
            _valueTypeSelect.Width = ValueTypeWidth;
            _valueTypeSelect.SelectionChanged += OnValueTypeChanged;
            _kindSpecificHost.Children.Add(CreateFieldStack(_valueTypeLabel, _valueTypeSelect));

            _valueLabel = CreateFieldLabel();
            if (setting.ValueIsBoolean)
            {
                _booleanSelect = BuildSelect(setting.ValueBooleanOptions);
                _booleanSelect.Width = BooleanWidth;
                _booleanSelect.SelectionChanged += OnValueChanged;
                _kindSpecificHost.Children.Add(CreateFieldStack(_valueLabel, _booleanSelect));
            }
            else
            {
                _valueInput = new TsInput { Width = ValueWidth };
                _valueInput.TextChanged += OnValueInputChanged;
                _kindSpecificHost.Children.Add(CreateFieldStack(_valueLabel, _valueInput));
            }
        }

        private void BuildCallAutomationFields(CallAutomationFieldsDisplay call)
        {
            _targetLabel = CreateFieldLabel();
            _targetInput = new TsInput { Width = TargetWidth };
            _targetInput.TextChanged += OnTargetChanged;
            _kindSpecificHost.Children.Add(CreateFieldStack(_targetLabel, _targetInput));
        }

        private void UpdateFields(ActionFieldsDisplay fields)
        {
            switch (fields)
            {
                case CommandFieldsDisplay command
                    when _commandLabel is not null && _commandSelect is not null
                        && _paramsLabel is not null && _paramsArea is not null && _paramsError is not null:
                    _commandLabel.Text = command.CommandLabel;
                    AutomationProperties.SetName(_commandSelect, command.CommandLabel);
                    SelectValue(_commandSelect, command.CommandValue);
                    _paramsLabel.Text = command.ParamsLabel;
                    AutomationProperties.SetName(_paramsArea, command.ParamsLabel);
                    _paramsArea.Hint = command.ParamsHint;
                    SetTextIfChanged(_paramsArea, command.ParamsText);
                    _paramsError.Text = command.ParamsError ?? string.Empty;
                    _paramsError.Visibility = command.ParamsError is null ? Visibility.Collapsed : Visibility.Visible;
                    if (command.ParamsError is not null)
                    {
                        AutomationProperties.SetName(_paramsError, command.ParamsError);
                    }

                    break;

                case NotifyFieldsDisplay notify
                    when _channelLabel is not null && _channelSelect is not null
                        && _messageLabel is not null && _messageArea is not null:
                    _channelLabel.Text = notify.ChannelLabel;
                    AutomationProperties.SetName(_channelSelect, notify.ChannelLabel);
                    SelectValue(_channelSelect, notify.ChannelValue);
                    _messageLabel.Text = notify.MessageLabel;
                    AutomationProperties.SetName(_messageArea, notify.MessageLabel);
                    _messageArea.Hint = notify.MessageHint;
                    SetTextIfChanged(_messageArea, notify.MessageValue);
                    break;

                case SetSettingFieldsDisplay setting
                    when _settingKeyLabel is not null && _settingKeyInput is not null
                        && _valueTypeLabel is not null && _valueTypeSelect is not null && _valueLabel is not null:
                    _settingKeyLabel.Text = setting.SettingKeyLabel;
                    AutomationProperties.SetName(_settingKeyInput, setting.SettingKeyLabel);
                    _settingKeyInput.Hint = setting.SettingKeyHint;
                    SetTextIfChanged(_settingKeyInput, setting.SettingKeyValue);
                    _valueTypeLabel.Text = setting.ValueTypeLabel;
                    AutomationProperties.SetName(_valueTypeSelect, setting.ValueTypeLabel);
                    SelectValue(_valueTypeSelect, setting.ValueTypeValue);
                    _valueLabel.Text = setting.ValueLabel;
                    if (setting.ValueIsBoolean && _booleanSelect is not null)
                    {
                        AutomationProperties.SetName(_booleanSelect, setting.ValueLabel);
                        SelectValue(_booleanSelect, setting.ValueValue);
                    }
                    else if (_valueInput is not null)
                    {
                        AutomationProperties.SetName(_valueInput, setting.ValueLabel);
                        _valueInput.Hint = setting.ValueHint;
                        SetTextIfChanged(_valueInput, setting.ValueValue);
                    }

                    break;

                case CallAutomationFieldsDisplay call
                    when _targetLabel is not null && _targetInput is not null:
                    _targetLabel.Text = call.TargetLabel;
                    AutomationProperties.SetName(_targetInput, call.TargetLabel);
                    SetTextIfChanged(_targetInput, call.TargetValue);
                    break;

                default:
                    break;
            }
        }

        private void OnKindChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppress)
            {
                return;
            }

            if (AutomationActionKinds.TryFromWire(SelectedValue(_kindSelect), out AutomationActionKind kind))
            {
                _owner.ViewModel.ChangeKind(Index, kind);
            }
        }

        private void OnCommandChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppress || _commandSelect is null)
            {
                return;
            }

            _owner.ViewModel.SetCommandName(Index, SelectedValue(_commandSelect));
        }

        private void OnParamsChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppress || _paramsArea is null)
            {
                return;
            }

            _owner.ViewModel.SetCommandParamsText(Index, _paramsArea.Text);
        }

        private void OnChannelChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppress || _channelSelect is null)
            {
                return;
            }

            _owner.ViewModel.SetChannelId(Index, SelectedValue(_channelSelect));
        }

        private void OnMessageChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppress || _messageArea is null)
            {
                return;
            }

            _owner.ViewModel.SetTemplate(Index, _messageArea.Text);
        }

        private void OnSettingKeyChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppress || _settingKeyInput is null)
            {
                return;
            }

            _owner.ViewModel.SetSettingKey(Index, _settingKeyInput.Text);
        }

        private void OnValueTypeChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppress || _valueTypeSelect is null)
            {
                return;
            }

            _owner.ViewModel.SetValueKind(Index, SettingValueKinds.FromWire(SelectedValue(_valueTypeSelect)));
        }

        private void OnValueChanged(object sender, SelectionChangedEventArgs e)
        {
            if (_suppress || _booleanSelect is null)
            {
                return;
            }

            _owner.ViewModel.SetValue(Index, SelectedValue(_booleanSelect));
        }

        private void OnValueInputChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppress || _valueInput is null)
            {
                return;
            }

            _owner.ViewModel.SetValue(Index, _valueInput.Text);
        }

        private void OnTargetChanged(object sender, TextChangedEventArgs e)
        {
            if (_suppress || _targetInput is null)
            {
                return;
            }

            _owner.ViewModel.SetTargetAutomationId(Index, _targetInput.Text);
        }

        private void OnMoveUp(object sender, RoutedEventArgs e) => _owner.ViewModel.MoveAction(Index, -1);

        private void OnMoveDown(object sender, RoutedEventArgs e) => _owner.ViewModel.MoveAction(Index, 1);

        private void OnRemove(object sender, RoutedEventArgs e) => _owner.ViewModel.RemoveAction(Index);
    }
}

using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The native WinUI 3 <c>AutomationBuilderPage</c> — a parity port of the web page
/// <c>web/src/features/automations/pages/AutomationBuilderPage.tsx</c> (route name <c>AutomationBuilder</c>;
/// <c>automations/new</c> and <c>automations/:id/edit</c>). It binds an <see cref="AutomationBuilderPageViewModel"/>
/// and renders every web region with Fluent components + design tokens: the back affordance, the edit-conflict and
/// draft-recovery banners, the General section (name / description / vehicle / enabled), the When section (a
/// trigger-type select above the trigger-configurator panel — GlassPanel1 — or the empty-trigger panel —
/// GlassPanel2), the Only-If section (the condition builder), the Then section (the action builder), the
/// conflict-warnings region, the save-error banner, the action row (save/create + test-run + cancel), and the
/// preset-hint panel (GlassPanel3). The four web data states — loading shimmer, load-error retry, not-found empty and
/// the success form — are visible regions driven by the projected <see cref="AutomationBuilderDisplay"/>. The view is a
/// thin renderer: all branch selection, validation, i18n and the seven data sources flow through the view-model.
/// </summary>
public sealed partial class AutomationBuilderPage : UserControl, IDisposable
{
    private const string SaveGlyph = "\uE74E";
    private const string TestRunGlyph = "\uE768";
    private const string CancelGlyph = "\uE711";

    private readonly AutomationBuilderPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _hydrated;
    private bool _suppress;
    private int _vehicleOptionCount = -1;
    private string _renderedTriggerWire = "\u0000";

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();

    private readonly StackPanel _loadingSkeleton = new() { Spacing = 16 };
    private readonly TsQueryError _errorState = new();
    private readonly TsEmptyState _notFound = new() { IconGlyph = AutomationBuilderRegistration.WarningGlyph };

    private readonly StackPanel _formRoot = new() { Spacing = 16, MaxWidth = 880, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly TsButton _backButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = AutomationBuilderRegistration.BackGlyph, HorizontalAlignment = HorizontalAlignment.Left };
    private readonly EditConflictBanner _conflictBanner;
    private readonly TsDraftRecoveryBanner _draftBanner = new() { IsOpen = false };

    private readonly TsInput _nameInput = new();
    private readonly TsTextarea _descriptionInput = new() { MinHeight = 64 };
    private readonly TsSelect _vehicleSelect = new();
    private readonly TsToggle _enabledToggle = new();
    private readonly List<string> _vehicleValues = new();

    private readonly TsSelect _triggerSelect = new();
    private readonly List<string> _triggerValues = new();
    private readonly TsGlassPanel _triggerPanel = new() { Padding = new Thickness(16) };
    private readonly TsEmptyState _emptyTrigger = new() { IconGlyph = AutomationBuilderRegistration.EmptyGlyph };
    private TriggerConfigurator? _triggerConfigurator;

    private readonly TsFormSection _generalSection = new();
    private readonly TsFormSection _whenSection = new();
    private readonly TsFormSection _onlyIfSection = new();
    private ConditionBuilder? _conditionBuilder;

    private readonly TsFormSection _thenSection = new();
    private ActionBuilder? _actionBuilder;

    private readonly TsAlertBanner _saveError = new() { Variant = CalloutVariant.Danger, IsOpen = false, Dismissible = false };
    private readonly TsButton _primaryButton = new() { Variant = ButtonVariant.Primary, IconGlyph = SaveGlyph };
    private readonly TsButton _testRunButton = new() { Variant = ButtonVariant.Secondary, IconGlyph = TestRunGlyph, Visibility = Visibility.Collapsed };
    private readonly TsButton _cancelButton = new() { Variant = ButtonVariant.Subtle, IconGlyph = CancelGlyph };
    private readonly Text _testRunStarted = new() { Visibility = Visibility.Collapsed };

    private readonly TsGlassPanel _presetHintPanel = new() { Padding = new Thickness(16) };
    private readonly Text _presetHintText = new() { HorizontalAlignment = HorizontalAlignment.Center };

    /// <summary>Creates the create-mode page over the no-backend feed and the shell localizer (the shell entry point).</summary>
    public AutomationBuilderPage()
        : this(EmptyAutomationBuilderFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed, localizer and route discrimination (DI / tests).</summary>
    /// <param name="feed">The automation-builder data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="automationId">The edit-mode automation id, or <see langword="null"/>.</param>
    /// <param name="presetId">The preset id to install, or <see langword="null"/>.</param>
    public AutomationBuilderPage(
        IAutomationBuilderFeed feed,
        ILocalizer localizer,
        long? automationId = null,
        string? presetId = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new AutomationBuilderPageViewModel(feed, localizer, automationId, presetId);
        _conflictBanner = new EditConflictBanner(
            localizer,
            new StaticEditLeaseSource(),
            _viewModel.Display.EditConflictResourceLabel);

        BuildLoadingSkeleton();
        Content = BuildLayout();

        _backButton.Click += OnBackClicked;
        _cancelButton.Click += OnBackClicked;
        _primaryButton.Click += OnSaveClicked;
        _testRunButton.Click += OnTestRunClicked;
        _errorState.ActionInvoked += OnRetryInvoked;
        _nameInput.TextChanged += OnNameChanged;
        _descriptionInput.TextChanged += OnDescriptionChanged;
        _vehicleSelect.SelectionChanged += OnVehicleChanged;
        _enabledToggle.Toggled += OnEnabledToggled;
        _triggerSelect.SelectionChanged += OnTriggerKindChanged;
        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>AutomationBuilderPage</c>).</summary>
    public static string Slug => AutomationBuilderRegistration.Slug;

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(_loadingSkeleton);
        stack.Children.Add(_errorState);
        stack.Children.Add(_notFound);
        stack.Children.Add(_formRoot);

        BuildForm();

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private StackPanel BuildHeader()
    {
        var header = new StackPanel { Spacing = 4 };
        header.Children.Add(_title);
        header.Children.Add(_subtitle);
        return header;
    }

    private void BuildLoadingSkeleton()
    {
        _loadingSkeleton.Children.Add(new TsPageHeaderSkeleton());
        _loadingSkeleton.Children.Add(new TsTableSkeleton());
    }

    private void BuildForm()
    {
        _formRoot.Children.Add(_backButton);
        _formRoot.Children.Add(_conflictBanner);
        _formRoot.Children.Add(_draftBanner);
        _formRoot.Children.Add(BuildGeneralSection());
        _formRoot.Children.Add(BuildWhenSection());
        _formRoot.Children.Add(_onlyIfSection);
        _formRoot.Children.Add(_thenSection);
        _formRoot.Children.Add(_saveError);
        _formRoot.Children.Add(BuildActionRow());
        _formRoot.Children.Add(BuildPresetHint());
    }

    private TsFormSection BuildGeneralSection()
    {
        var fields = new StackPanel { Spacing = 12 };
        fields.Children.Add(_nameInput);
        fields.Children.Add(_descriptionInput);
        fields.Children.Add(_vehicleSelect);
        fields.Children.Add(_enabledToggle);
        _generalSection.SectionContent = fields;
        return _generalSection;
    }

    private TsFormSection BuildWhenSection()
    {
        _emptyTrigger.HorizontalAlignment = HorizontalAlignment.Stretch;
        _triggerPanel.Content = _emptyTrigger;

        var fields = new StackPanel { Spacing = 12 };
        fields.Children.Add(_triggerSelect);
        fields.Children.Add(_triggerPanel);

        _whenSection.SectionContent = fields;
        return _whenSection;
    }

    private StackPanel BuildActionRow()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        row.Children.Add(_primaryButton);
        row.Children.Add(_testRunButton);
        row.Children.Add(_cancelButton);
        row.Children.Add(_testRunStarted);
        return row;
    }

    private TsGlassPanel BuildPresetHint()
    {
        _presetHintPanel.Content = _presetHintText;
        return _presetHintPanel;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe from and dispose the view-model + hosted sub-builders (CA1001).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _backButton.Click -= OnBackClicked;
        _cancelButton.Click -= OnBackClicked;
        _primaryButton.Click -= OnSaveClicked;
        _testRunButton.Click -= OnTestRunClicked;
        _errorState.ActionInvoked -= OnRetryInvoked;
        _nameInput.TextChanged -= OnNameChanged;
        _descriptionInput.TextChanged -= OnDescriptionChanged;
        _vehicleSelect.SelectionChanged -= OnVehicleChanged;
        _enabledToggle.Toggled -= OnEnabledToggled;
        _triggerSelect.SelectionChanged -= OnTriggerKindChanged;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _triggerConfigurator?.Dispose();
        _conditionBuilder?.Dispose();
        _actionBuilder?.Dispose();
        _conflictBanner.Dispose();
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (_dispatcher.HasThreadAccess)
        {
            Render(_viewModel.Display);
        }
        else
        {
            _dispatcher.TryEnqueue(() => Render(_viewModel.Display));
        }
    }

    private void Render(AutomationBuilderDisplay display)
    {
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        _loadingSkeleton.Visibility = Show(display.ShowLoading);
        _errorState.Visibility = Show(display.ShowError);
        _errorState.Title = display.Title;
        _errorState.Message = display.LoadErrorDetail;
        _errorState.ActionText = display.BackLabel;

        _notFound.Visibility = Show(display.ShowEmpty);
        _notFound.Message = display.NotFoundMessage;
        AutomationProperties.SetName(_notFound, display.NotFoundMessage);

        _formRoot.Visibility = Show(display.ShowForm);
        if (!display.ShowForm)
        {
            return;
        }

        if (!_hydrated)
        {
            Hydrate(display);
            _hydrated = true;
        }

        RenderHeaderChrome(display);
        RenderGeneral(display);
        RenderTriggerPanel(display);
        RenderActions(display);
    }

    private void Hydrate(AutomationBuilderDisplay display)
    {
        _suppress = true;
        try
        {
            _nameInput.Text = display.NameValue;
            _nameInput.Hint = display.NameHint;
            _descriptionInput.Text = display.DescriptionValue;
            _descriptionInput.Hint = display.DescriptionHint;
            _enabledToggle.IsOn = display.EnabledValue;

            RefreshVehicleOptions(display);
            RefreshTriggerOptions(display);
        }
        finally
        {
            _suppress = false;
        }

        BuildConditionBuilder();
        BuildActionBuilder();
    }

    private void RenderHeaderChrome(AutomationBuilderDisplay display)
    {
        _backButton.Text = display.BackLabel;
        AutomationProperties.SetName(_conflictBanner, display.EditConflictResourceLabel);
        _draftBanner.Title = display.DraftNoun;
        _draftBanner.Message = display.UnsavedMessage;
        ToolTipService.SetToolTip(_cancelButton, display.UnsavedMessage);
        AutomationProperties.SetHelpText(_cancelButton, display.UnsavedMessage);

        _generalSection.Title = display.GeneralTitle;
        _whenSection.Title = display.WhenTitle;
        _whenSection.Description = display.WhenDescription;
        _onlyIfSection.Title = display.OnlyIfTitle;
        _onlyIfSection.Description = display.OnlyIfDescription;
        _thenSection.Title = display.ThenTitle;
        _thenSection.Description = display.ThenDescription;
    }

    private void RenderGeneral(AutomationBuilderDisplay display)
    {
        _nameInput.Header = display.NameLabel;
        _descriptionInput.Header = display.DescriptionLabel;
        _vehicleSelect.Header = display.VehicleLabel;
        _enabledToggle.Header = display.EnabledLabel;
        _triggerSelect.Header = display.TriggerTypeLabel;
        _triggerSelect.Hint = display.TriggerPrompt;
        AutomationProperties.SetName(_nameInput, display.NameLabel);
        AutomationProperties.SetName(_descriptionInput, display.DescriptionLabel);
        AutomationProperties.SetName(_vehicleSelect, display.VehicleLabel);
        AutomationProperties.SetName(_triggerSelect, display.TriggerTypeLabel);
        _emptyTrigger.Message = display.EmptyTriggerMessage;

        if (_vehicleOptionCount != display.VehicleOptions.Count)
        {
            RefreshVehicleOptions(display);
        }
    }

    private void RefreshVehicleOptions(AutomationBuilderDisplay display)
    {
        _suppress = true;
        try
        {
            var labels = new List<string>(display.VehicleOptions.Count);
            _vehicleValues.Clear();
            foreach (var option in display.VehicleOptions)
            {
                labels.Add(option.Label);
                _vehicleValues.Add(option.Value);
            }

            _vehicleSelect.ItemsSource = labels;
            _vehicleOptionCount = display.VehicleOptions.Count;
            _vehicleSelect.SelectedIndex = IndexOf(_vehicleValues, display.SelectedVehicleValue);
        }
        finally
        {
            _suppress = false;
        }
    }

    private void RefreshTriggerOptions(AutomationBuilderDisplay display)
    {
        var labels = new List<string>(display.TriggerOptions.Count);
        _triggerValues.Clear();
        foreach (var option in display.TriggerOptions)
        {
            labels.Add(option.Label);
            _triggerValues.Add(option.Wire);
        }

        _triggerSelect.ItemsSource = labels;
        _triggerSelect.SelectedIndex = IndexOf(_triggerValues, display.SelectedTriggerWire);
    }

    private void RenderTriggerPanel(AutomationBuilderDisplay display)
    {
        if (_renderedTriggerWire == display.SelectedTriggerWire)
        {
            return;
        }

        _renderedTriggerWire = display.SelectedTriggerWire;

        _suppress = true;
        try
        {
            _triggerSelect.SelectedIndex = IndexOf(_triggerValues, display.SelectedTriggerWire);
        }
        finally
        {
            _suppress = false;
        }

        _triggerConfigurator?.Dispose();
        _triggerConfigurator = null;

        if (display.HasTrigger && _viewModel.Form.Trigger is { } trigger)
        {
            _triggerConfigurator = new TriggerConfigurator(
                EmptyTriggerGeofenceSource.Instance,
                _localizer,
                initialTrigger: trigger);
            _triggerConfigurator.TriggerChanged += OnTriggerChanged;
            _triggerPanel.Content = _triggerConfigurator;
        }
        else
        {
            _triggerPanel.Content = _emptyTrigger;
        }
    }

    private void BuildConditionBuilder()
    {
        if (_conditionBuilder is not null)
        {
            return;
        }

        _conditionBuilder = new ConditionBuilder(
            EmptyConditionBuilderSource.Instance,
            _localizer,
            _viewModel.Form.Conditions);
        _conditionBuilder.ConditionsChanged += OnConditionsChanged;
        _onlyIfSection.SectionContent = _conditionBuilder;
    }

    private void BuildActionBuilder()
    {
        if (_actionBuilder is not null)
        {
            return;
        }

        _actionBuilder = new ActionBuilder(
            _localizer,
            _viewModel.Channels,
            initialActions: _viewModel.Form.Actions);
        _actionBuilder.ViewModel.ActionsChanged += OnActionsChanged;
        _thenSection.SectionContent = _actionBuilder;
    }

    private void RenderActions(AutomationBuilderDisplay display)
    {
        _primaryButton.Text = display.PrimaryActionLabel;
        _primaryButton.IsLoading = display.IsSaving;
        _cancelButton.Text = display.CancelLabel;

        _testRunButton.Text = display.TestRunLabel;
        _testRunButton.Visibility = Show(display.ShowTestRun);

        _testRunStarted.Value = display.TestRunStartedMessage;
        _testRunStarted.Visibility = Show(display.ShowTestRunStarted);

        _saveError.Title = display.SaveErrorTitle;
        _saveError.Message = display.SaveErrorDetail;
        _saveError.IsOpen = display.ShowSaveError;
        _saveError.Visibility = Show(display.ShowSaveError);

        _presetHintText.Value = display.PresetHint;
        _presetHintPanel.Visibility = Show(display.ShowPresetHint);
    }

    private void OnNameChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppress)
        {
            _viewModel.SetName(_nameInput.Text);
        }
    }

    private void OnDescriptionChanged(object sender, TextChangedEventArgs e)
    {
        if (!_suppress)
        {
            _viewModel.SetDescription(_descriptionInput.Text);
        }
    }

    private void OnVehicleChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        int index = _vehicleSelect.SelectedIndex;
        string value = index >= 0 && index < _vehicleValues.Count ? _vehicleValues[index] : string.Empty;
        _viewModel.SetVehicle(string.IsNullOrEmpty(value) ? null : long.Parse(value, System.Globalization.CultureInfo.InvariantCulture));
    }

    private void OnEnabledToggled(object? sender, EventArgs e)
    {
        if (!_suppress)
        {
            _viewModel.SetEnabled(_enabledToggle.IsOn);
        }
    }

    private void OnTriggerKindChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_suppress)
        {
            return;
        }

        int index = _triggerSelect.SelectedIndex;
        string wire = index >= 0 && index < _triggerValues.Count ? _triggerValues[index] : string.Empty;
        _viewModel.SetTriggerKind(wire);
    }

    private void OnTriggerChanged(object? sender, AutomationTrigger trigger) => _viewModel.SetTrigger(trigger);

    private void OnConditionsChanged(object? sender, IReadOnlyList<AutomationCondition> conditions) =>
        _viewModel.SetConditions(conditions);

    private void OnActionsChanged(object? sender, EventArgs e)
    {
        if (_actionBuilder is not null)
        {
            _viewModel.SetActions(_actionBuilder.ViewModel.Actions);
        }
    }

    private void OnSaveClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.SaveAsync());

    private void OnTestRunClicked(object sender, RoutedEventArgs e) => InvokeAsync(() => _viewModel.TestRunAsync());

    private void OnRetryInvoked(object? sender, EventArgs e) => InvokeAsync(() => _viewModel.RefreshAsync());

    private void OnBackClicked(object sender, RoutedEventArgs e)
    {
        // Navigation back to the automations list is owned by the shell; the guard message is surfaced on the
        // cancel affordance (ToolTip + AutomationProperties) per the web unsaved-changes contract.
    }

    private static int IndexOf(List<string> values, string value)
    {
        for (var i = 0; i < values.Count; i++)
        {
            if (string.Equals(values[i], value, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return -1;
    }

    private static async void InvokeAsync(Func<Task> action) => await action().ConfigureAwait(true);

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new AutomationBuilderPageAutomationPeer(this);

    private sealed class AutomationBuilderPageAutomationPeer(AutomationBuilderPage owner) : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;
    }
}

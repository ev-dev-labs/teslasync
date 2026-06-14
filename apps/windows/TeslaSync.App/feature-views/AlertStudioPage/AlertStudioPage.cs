using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.Forms;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Notifications;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The native WinUI 3 <c>AlertStudioPage</c> — a parity port of the web page
/// <c>web/src/features/notifications/pages/AlertStudioPage.tsx</c> (route <c>/notifications/studio</c>). It binds
/// to an <see cref="AlertStudioPageViewModel"/> and renders every web region with Fluent components + design
/// tokens: the page title + subtitle + the Templates / New Rule actions, the collapsible template gallery, the
/// left rules column (search, the four data states, the bulk enable/disable toolbar and the rule rows), the right
/// rule editor (identity, vehicles, kind switch, signal/operator or computed-metric, severity + allowed-operators,
/// the typed-value editor, cooldown + alert behavior + escalation, the message template + the test-delivery target
/// channels), and the snooze sheet. The view is a thin renderer: all branch selection, formatting and i18n happen
/// in the headless <see cref="AlertStudioDisplay"/> projection. State changes are marshalled onto the UI thread.
/// </summary>
public sealed partial class AlertStudioPage : UserControl, IDisposable
{
    private const string TemplatesGlyph = "\uE945";  // Sparkle
    private const string AddGlyph = "\uE710";        // Add
    private const string SaveGlyph = "\uE74E";       // Save
    private const string DeleteGlyph = "\uE74D";     // Delete
    private const string TestGlyph = "\uEA8F";       // Bell
    private const string SnoozeGlyph = "\uE708";     // Quiet hours (moon)
    private const string EnableGlyph = "\uEA8F";     // Bell
    private const string DisableGlyph = "\uE7ED";    // Bell off
    private const string EditGlyph = "\uE70F";       // Edit

    private readonly AlertStudioPageViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly DispatcherQueue _dispatcher = DispatcherQueue.GetForCurrentThread();
    private bool _disposed;
    private bool _suppress;
    private string _ruleRowsSignature = "\u0000";
    private string _templateSignature = "\u0000";
    private string _channelSignature = "\u0000";
    private string _vehicleSignature = "\u0000";

    private readonly PageTitle _title = new();
    private readonly Subhead _subtitle = new();
    private readonly TsButton _templatesButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small, IconGlyph = TemplatesGlyph };
    private readonly TsButton _newRuleButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = AddGlyph };

    private readonly TsGlassPanel _templatesPanel = new() { Padding = new Thickness(20) };
    private readonly Text _templatesHeader = new();
    private readonly TsSearchInput _templateSearch = new();
    private readonly StackPanel _templateCategoryBar = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly StackPanel _templateCardsHost = new() { Spacing = 8 };
    private readonly TsEmptyState _templatesEmpty = new() { IconGlyph = TemplatesGlyph };

    private readonly TsGlassPanel _rulesPanel = new() { Padding = new Thickness(16) };
    private readonly PanelTitle _rulesTitle = new();
    private readonly Caption _rulesCount = new();
    private readonly TsSearchInput _ruleSearch = new();
    private readonly StackPanel _rulesLoading = new() { Spacing = 8 };
    private readonly TsEmptyState _rulesEmpty = new() { IconGlyph = TestGlyph };
    private readonly TsEmptyState _rulesNoMatches = new() { IconGlyph = "\uE721" };
    private readonly BulkActionsToolbar _bulkBar;
    private readonly StackPanel _ruleRowsHost = new() { Spacing = 8 };

    private readonly TsGlassPanel _editorPanel = new() { Padding = new Thickness(16) };
    private readonly Text _editorTitle = new();
    private readonly TsAlertBanner _formError = new() { Variant = CalloutVariant.Danger, Visibility = Visibility.Collapsed };
    private readonly TsInput _nameInput = new();
    private readonly TsSelect _statusSelect = new();
    private readonly TsToggle _allVehiclesToggle = new();
    private readonly StackPanel _vehicleChecksHost = new() { Spacing = 4 };
    private readonly TsButton _kindSignalButton = new() { Size = ControlSize.Small };
    private readonly TsButton _kindMetricButton = new() { Size = ControlSize.Small };
    private readonly Caption _kindHint = new();
    private readonly StackPanel _signalRow = new() { Spacing = 12, Orientation = Orientation.Horizontal };
    private readonly TsSelect _signalSelect = new() { MinWidth = 220 };
    private readonly TsSelect _operatorSelect = new() { MinWidth = 140 };
    private readonly Caption _signalTypeHint = new();
    private readonly TsGlassPanel _metricNote = new() { Padding = new Thickness(12), Glow = GlassGlow.None };
    private readonly Text _metricNoteText = new();
    private readonly TsSelect _severitySelect = new();
    private readonly TsGlassPanel _allowedOpsPanel = new() { Padding = new Thickness(12), Glow = GlassGlow.None };
    private readonly StackPanel _allowedOpsColumn = new() { Spacing = 4 };
    private readonly Caption _allowedOpsLabel = new();
    private readonly Text _allowedOpsText = new();
    private readonly StackPanel _typedValueHost = new() { Spacing = 4 };
    private readonly Caption _typedValueLabel = new();
    private readonly TsInput _cooldownInput = new();
    private readonly TsSelect _behaviorSelect = new();
    private readonly TsAlertBanner _recommendBanner = new() { Variant = CalloutVariant.Info, Visibility = Visibility.Collapsed };
    private readonly Caption _triggerHint = new();
    private readonly ErrorText _forceChooseError = new() { Visibility = Visibility.Collapsed };
    private readonly StackPanel _maxFiresHost = new() { Spacing = 4 };
    private readonly TsInput _maxFiresInput = new();
    private readonly Caption _maxFiresHint = new();
    private readonly StackPanel _escalationHost = new() { Spacing = 8 };
    private readonly TsToggle _escalationToggle = new();
    private readonly StackPanel _escalationFields = new() { Spacing = 8 };
    private readonly TsInput _escalationAfterInput = new();
    private readonly TsSelect _escalationSeveritySelect = new();
    private readonly Caption _escalationHint = new();

    private readonly Caption _channelsLabel = new();
    private readonly TsGlassPanel _channelsPanel = new() { Padding = new Thickness(12), Glow = GlassGlow.None };
    private readonly StackPanel _channelsLoading = new() { Spacing = 8 };
    private readonly TsErrorDisplay _channelsError = new();
    private readonly StackPanel _channelsListHost = new() { Spacing = 8 };
    private readonly StackPanel _channelChips = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly Text _channelsListLabel = new();
    private readonly TsEmptyState _channelsEmpty = new() { IconGlyph = DisableGlyph };

    private readonly TsButton _saveButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = SaveGlyph };
    private readonly TsButton _deleteButton = new() { Variant = ButtonVariant.Destructive, Size = ControlSize.Small, IconGlyph = DeleteGlyph };
    private readonly TsButton _testButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = TestGlyph };
    private readonly TsButton _resetButton = new() { Variant = ButtonVariant.Subtle, Size = ControlSize.Small };

    private readonly TsModal _snoozeModal = new();
    private readonly StackPanel _snoozeBody = new() { Spacing = 8 };
    private bool _snoozeShown;

    /// <summary>Creates the page over the inert shell feed and the shell resource localizer.</summary>
    public AlertStudioPage()
        : this(EmptyAlertStudioFeed.Instance, ShellLocalizer.Instance)
    {
    }

    /// <summary>Creates the page over an explicit feed and localizer (used by tests / data-wired hosts).</summary>
    /// <param name="feed">The studio data port (the eleven web hooks).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the page's <c>view.opened</c> event.</param>
    public AlertStudioPage(IAlertStudioFeed feed, ILocalizer localizer, AlertStudioDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _viewModel = new AlertStudioPageViewModel(feed, localizer, diagnostics);

        var s = _viewModel.Display.Strings;
        _bulkBar = new BulkActionsToolbar(
            BuildBulkActions(s),
            localizer,
            new BulkItemNoun(s.BulkNounRuleOne, s.BulkNounRuleOther));

        Content = BuildLayout();
        WireEvents();

        _viewModel.PropertyChanged += OnViewModelChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render(_viewModel.Display);
    }

    /// <summary>The diagnostics surface slug (<c>AlertStudioPage</c>).</summary>
    public static string Slug => AlertStudioRegistration.Slug;

    /// <summary>The state holder driving this surface (exposed for host wiring and tests).</summary>
    public AlertStudioPageViewModel ViewModel => _viewModel;

    private BulkAction[] BuildBulkActions(AlertStudioStrings s) => new[]
    {
        new BulkAction("enable", s.BulkEnable, _ => _viewModel.BulkEnableAsync(_viewModel.SelectedIds), BulkActionVariant.Default, iconGlyph: EnableGlyph),
        new BulkAction("disable", s.BulkDisable, _ => _viewModel.BulkDisableAsync(_viewModel.SelectedIds), BulkActionVariant.Default, iconGlyph: DisableGlyph),
    };

    private ScrollViewer BuildLayout()
    {
        var stack = new StackPanel { Spacing = 16, Padding = new Thickness(24) };
        stack.Children.Add(BuildHeader());
        stack.Children.Add(BuildTemplatesPanel());
        stack.Children.Add(BuildColumns());

        return new ScrollViewer
        {
            Content = stack,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
    }

    private Grid BuildHeader()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var titles = new StackPanel { Spacing = 2 };
        titles.Children.Add(_title);
        titles.Children.Add(_subtitle);
        Grid.SetColumn(titles, 0);
        grid.Children.Add(titles);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Bottom };
        actions.Children.Add(_templatesButton);
        actions.Children.Add(_newRuleButton);
        Grid.SetColumn(actions, 1);
        grid.Children.Add(actions);
        return grid;
    }

    private TsGlassPanel BuildTemplatesPanel()
    {
        var header = new Grid { ColumnSpacing = 12, Margin = new Thickness(0, 0, 0, 12) };
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(260) });
        Grid.SetColumn(_templatesHeader, 0);
        _templatesHeader.VerticalAlignment = VerticalAlignment.Center;
        header.Children.Add(_templatesHeader);
        Grid.SetColumn(_templateSearch, 1);
        header.Children.Add(_templateSearch);

        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(header);
        body.Children.Add(_templateCategoryBar);
        body.Children.Add(new ScrollViewer
        {
            Content = _templateCardsHost,
            MaxHeight = 360,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        });
        body.Children.Add(_templatesEmpty);

        _templatesPanel.Content = body;
        return _templatesPanel;
    }

    private Grid BuildColumns()
    {
        var grid = new Grid { ColumnSpacing = 16 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(4, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(8, GridUnitType.Star) });

        var left = BuildRulesPanel();
        Grid.SetColumn(left, 0);
        grid.Children.Add(left);

        var right = BuildEditorPanel();
        Grid.SetColumn(right, 1);
        grid.Children.Add(right);
        return grid;
    }

    private TsGlassPanel BuildRulesPanel()
    {
        var titleRow = new Grid { Margin = new Thickness(0, 0, 0, 8) };
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_rulesTitle, 0);
        titleRow.Children.Add(_rulesTitle);
        _rulesCount.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_rulesCount, 1);
        titleRow.Children.Add(_rulesCount);

        for (int i = 0; i < 3; i++)
        {
            _rulesLoading.Children.Add(new TsSkeleton { BlockHeight = 56, HorizontalAlignment = HorizontalAlignment.Stretch });
        }

        var body = new StackPanel { Spacing = 8 };
        body.Children.Add(titleRow);
        body.Children.Add(_ruleSearch);
        body.Children.Add(_rulesLoading);
        body.Children.Add(_rulesEmpty);
        body.Children.Add(_rulesNoMatches);
        body.Children.Add(_bulkBar);
        body.Children.Add(new ScrollViewer
        {
            Content = _ruleRowsHost,
            MaxHeight = 600,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        });

        _rulesPanel.Content = body;
        return _rulesPanel;
    }

    private TsGlassPanel BuildEditorPanel()
    {
        var body = new StackPanel { Spacing = 12 };

        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new FontIcon { Glyph = EditGlyph, FontSize = 14, Foreground = DisplayTokens.TextMuted, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(_editorTitle);
        body.Children.Add(titleRow);
        body.Children.Add(_formError);

        body.Children.Add(TwoColumn(
            Field(_nameInput, () => _viewModel.Display.Strings.NameLabel),
            Field(_statusSelect, () => _viewModel.Display.Strings.EnabledLabel)));

        body.Children.Add(BuildVehiclesAndKind());

        body.Children.Add(_signalRow);
        body.Children.Add(_metricNote);
        body.Children.Add(_signalTypeHint);

        body.Children.Add(TwoColumn(
            Field(_severitySelect, () => _viewModel.Display.Strings.SeverityLabel),
            BuildAllowedOperators()));

        body.Children.Add(_typedValueHost);

        body.Children.Add(TwoColumn(
            Field(_cooldownInput, () => _viewModel.Display.Strings.CooldownLabel),
            BuildBehaviorColumn()));

        PopulateMaxFiresAndEscalation();
        body.Children.Add(_maxFiresHost);
        body.Children.Add(_escalationHost);
        body.Children.Add(BuildChannels());
        body.Children.Add(BuildActions());

        _editorPanel.Content = body;
        return _editorPanel;
    }

    private StackPanel BuildVehiclesAndKind()
    {
        var vehicles = new StackPanel { Spacing = 4 };
        vehicles.Children.Add(LabelFor(() => _viewModel.Display.Strings.VehiclesLabel));
        vehicles.Children.Add(_allVehiclesToggle);
        vehicles.Children.Add(_vehicleChecksHost);

        var kind = new StackPanel { Spacing = 4 };
        kind.Children.Add(LabelFor(() => _viewModel.Display.Strings.KindLabel));
        var kindButtons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 0 };
        kindButtons.Children.Add(_kindSignalButton);
        kindButtons.Children.Add(_kindMetricButton);
        kind.Children.Add(kindButtons);
        kind.Children.Add(_kindHint);

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        Grid.SetColumn(vehicles, 0);
        grid.Children.Add(vehicles);
        Grid.SetColumn(kind, 1);
        grid.Children.Add(kind);

        _signalRow.Children.Add(Field(_signalSelect, () => _viewModel.Display.Strings.SignalNameLabel));
        _signalRow.Children.Add(Field(_operatorSelect, () => _viewModel.Display.Strings.OperatorLabel));
        _metricNote.Content = _metricNoteText;

        return new StackPanel { Children = { grid } };
    }

    private StackPanel BuildAllowedOperators()
    {
        _allowedOpsColumn.Children.Add(_allowedOpsLabel);
        _allowedOpsPanel.Content = _allowedOpsText;
        _allowedOpsColumn.Children.Add(_allowedOpsPanel);
        return _allowedOpsColumn;
    }

    private StackPanel BuildBehaviorColumn()
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(LabelFor(() => _viewModel.Display.Strings.AlertBehaviorLabel));
        column.Children.Add(_recommendBanner);
        column.Children.Add(_behaviorSelect);
        column.Children.Add(_forceChooseError);
        column.Children.Add(_triggerHint);
        return column;
    }

    private void PopulateMaxFiresAndEscalation()
    {
        _maxFiresHost.Children.Add(LabelFor(() => _viewModel.Display.Strings.MaxFiresLabel));
        _maxFiresHost.Children.Add(_maxFiresInput);
        _maxFiresHost.Children.Add(_maxFiresHint);

        _escalationFields.Children.Add(Field(_escalationAfterInput, () => _viewModel.Display.Strings.EscalationAfterLabel));
        _escalationFields.Children.Add(Field(_escalationSeveritySelect, () => _viewModel.Display.Strings.EscalationSeverityLabel));
        _escalationFields.Children.Add(_escalationHint);
        _escalationHost.Children.Add(_escalationToggle);
        _escalationHost.Children.Add(_escalationFields);
    }

    private StackPanel BuildChannels()
    {
        for (int i = 0; i < 3; i++)
        {
            _channelsLoading.Children.Add(new TsSkeleton { BlockHeight = 28, HorizontalAlignment = HorizontalAlignment.Stretch });
        }

        _channelsListHost.Children.Add(_channelsListLabel);
        _channelsListHost.Children.Add(_channelChips);

        var inner = new StackPanel { Spacing = 8 };
        inner.Children.Add(_channelsLoading);
        inner.Children.Add(_channelsError);
        inner.Children.Add(_channelsListHost);
        inner.Children.Add(_channelsEmpty);
        _channelsPanel.Content = inner;

        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(_channelsLabel);
        column.Children.Add(_channelsPanel);
        return column;
    }

    private StackPanel BuildActions()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        row.Children.Add(_saveButton);
        row.Children.Add(_deleteButton);
        row.Children.Add(_testButton);
        _resetButton.HorizontalAlignment = HorizontalAlignment.Right;
        row.Children.Add(_resetButton);
        return row;
    }

    private void WireEvents()
    {
        _templatesButton.Click += (_, _) => _viewModel.ToggleTemplates();
        _newRuleButton.Click += (_, _) => _viewModel.NewRule();
        _templateSearch.QueryChanged += (_, q) => Guarded(() => _viewModel.SetTemplateSearch(q));
        _ruleSearch.QueryChanged += (_, q) => Guarded(() => _viewModel.SetRuleSearch(q));

        _bulkBar.SelectionCleared += (_, _) => _viewModel.ClearBulkSelection();

        _nameInput.TextChanged += (_, _) => Guarded(() => _viewModel.UpdateEditor(e => e with { Name = _nameInput.Text }));
        _statusSelect.SelectionChanged += (_, _) => OnSelectChanged(_statusSelect, v => _viewModel.UpdateEditor(e => e with { Enabled = v == "true" }));
        _allVehiclesToggle.Toggled += (_, _) => Guarded(() => _viewModel.UpdateEditor(e => e with { AllVehicles = _allVehiclesToggle.IsOn }));

        _kindSignalButton.Click += (_, _) => _viewModel.UpdateEditor(e => e with { Kind = AlertRuleKindOption.Signal });
        _kindMetricButton.Click += (_, _) => _viewModel.UpdateEditor(e => e with { Kind = AlertRuleKindOption.ComputedMetric });

        _signalSelect.SelectionChanged += (_, _) => OnSelectChanged(_signalSelect, v => _viewModel.HandleSignalChange(v));
        _operatorSelect.SelectionChanged += (_, _) => OnSelectChanged(_operatorSelect, v => _viewModel.HandleOperatorChange(v));
        _severitySelect.SelectionChanged += (_, _) => OnSelectChanged(_severitySelect, v => _viewModel.UpdateEditor(e => e with { Severity = v }));

        _cooldownInput.TextChanged += (_, _) => Guarded(() => _viewModel.UpdateEditor(e => e with { CooldownMin = ParseInt(_cooldownInput.Text, e.CooldownMin) }));
        _behaviorSelect.SelectionChanged += (_, _) => OnSelectChanged(_behaviorSelect, OnBehaviorChanged);
        _maxFiresInput.TextChanged += (_, _) => Guarded(() => _viewModel.UpdateEditor(e => e with { MaxFires = _maxFiresInput.Text }));
        _escalationToggle.Toggled += (_, _) => Guarded(() => _viewModel.UpdateEditor(e => e with
        {
            EscalationEnabled = _escalationToggle.IsOn,
            EscalationAfter = _escalationToggle.IsOn ? e.EscalationAfter : string.Empty,
            EscalationSeverity = _escalationToggle.IsOn ? e.EscalationSeverity : string.Empty,
        }));
        _escalationAfterInput.TextChanged += (_, _) => Guarded(() => _viewModel.UpdateEditor(e => e with { EscalationAfter = _escalationAfterInput.Text }));
        _escalationSeveritySelect.SelectionChanged += (_, _) => OnSelectChanged(_escalationSeveritySelect, v => _viewModel.UpdateEditor(e => e with { EscalationSeverity = v }));

        _saveButton.Click += (_, _) => _ = _viewModel.SaveAsync();
        _deleteButton.Click += (_, _) => { if (_viewModel.Display.Editor.Id is { } id) { _ = _viewModel.DeleteAsync(id); } };
        _testButton.Click += (_, _) => _ = _viewModel.TestAsync();
        _resetButton.Click += (_, _) => _viewModel.NewRule();

        _rulesEmpty.ActionInvoked += (_, _) => _viewModel.NewRule();
        _snoozeModal.Closed += (_, _) => _viewModel.CloseSnooze();
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _viewModel.NotifyOpened();
        await _viewModel.LoadAsync().ConfigureAwait(true);
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Unsubscribe and dispose the view-model + hosted surfaces (CA1001; mirrors the sibling pages).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelChanged;
        _bulkBar.Dispose();
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

    private void Render(AlertStudioDisplay display)
    {
        _suppress = true;

        var s = display.Strings;
        _title.Value = display.Title;
        _subtitle.Value = display.Subtitle;
        AutomationProperties.SetName(this, display.Title);

        SetButton(_templatesButton, s.ActionsTemplates);
        SetButton(_newRuleButton, s.ActionsNewRule);

        RenderTemplates(display);
        RenderRules(display);
        RenderEditor(display);
        RenderChannels(display);
        RenderSnooze(display);

        _suppress = false;
    }

    private void RenderTemplates(AlertStudioDisplay display)
    {
        _templatesPanel.Visibility = Show(display.ShowTemplates);
        _templatesHeader.Value = display.TemplatesHeaderText;
        _templateSearch.PromptText = display.Strings.TemplatesSearchPrompt;

        RebuildTemplateCategories(display);
        RebuildTemplateCards(display);

        _templatesEmpty.Visibility = Show(display.TemplatesEmpty);
        _templatesEmpty.Title = display.Strings.TemplatesNoMatchesTitle;
        _templatesEmpty.Message = display.Strings.TemplatesNoMatches;
    }

    private void RebuildTemplateCategories(AlertStudioDisplay display)
    {
        _templateCategoryBar.Children.Clear();
        _templateCategoryBar.Children.Add(BuildCategoryChip(null, display.TemplatesAllChipLabel, display.ActiveTemplateCategory is null));
        foreach (var chip in display.TemplateCategoryChips)
        {
            _templateCategoryBar.Children.Add(BuildCategoryChip(chip.Value, chip.Label, string.Equals(chip.Value, display.ActiveTemplateCategory, StringComparison.Ordinal)));
        }
    }

    private TsButton BuildCategoryChip(string? value, string label, bool active)
    {
        var button = new TsButton
        {
            Text = label,
            Variant = active ? ButtonVariant.Primary : ButtonVariant.Subtle,
            Size = ControlSize.Small,
        };
        AutomationProperties.SetName(button, label);
        button.Click += (_, _) => _viewModel.SetTemplateCategory(value);
        return button;
    }

    private void RebuildTemplateCards(AlertStudioDisplay display)
    {
        string signature = string.Join("|", display.TemplateCards.Select(c => c.Index)) + ":" + display.ActiveTemplateCategory;
        if (signature == _templateSignature)
        {
            return;
        }

        _templateSignature = signature;
        _templateCardsHost.Children.Clear();
        foreach (var card in display.TemplateCards)
        {
            _templateCardsHost.Children.Add(BuildTemplateCard(card, display.Strings.TemplatesUse));
        }
    }

    private TsGlassPanel BuildTemplateCard(AlertStudioTemplateCard card, string useLabel)
    {
        int index = card.Index;
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new TsStatusDot { Severity = card.Severity, VerticalAlignment = VerticalAlignment.Center });
        titleRow.Children.Add(new Text { Value = card.Name, VerticalAlignment = VerticalAlignment.Center });

        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        footer.Children.Add(new TsSeverityBadge { Severity = card.Severity, Label = card.SeverityLabel, ShowIcon = false });
        footer.Children.Add(new Caption { Value = useLabel, VerticalAlignment = VerticalAlignment.Center });

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(titleRow);
        column.Children.Add(new Caption { Value = card.Message });
        column.Children.Add(footer);

        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = column, Glow = GlassGlow.None };
        AutomationProperties.SetName(panel, card.AutomationName);
        var tap = new TappedEventHandler((_, _) => _viewModel.CloneTemplate(index));
        panel.Tapped += tap;
        return panel;
    }

    private void RenderRules(AlertStudioDisplay display)
    {
        var s = display.Strings;
        _rulesTitle.Value = s.RulesTitle;
        _rulesCount.Value = display.RulesCountText;
        _ruleSearch.PromptText = s.RulesSearchPrompt;
        _ruleSearch.Visibility = Show(display.ShowRuleSearch);

        _rulesLoading.Visibility = Show(display.RulesLoading);

        _rulesEmpty.Visibility = Show(display.RulesEmpty);
        _rulesEmpty.Title = s.RulesEmptyTitle;
        _rulesEmpty.Message = s.RulesEmptyDescription;

        _rulesNoMatches.Visibility = Show(display.ShowRulesNoMatches);
        _rulesNoMatches.Title = s.RulesNoMatchesTitle;
        _rulesNoMatches.Message = s.RulesNoMatches;

        RebuildRuleRows(display);
        _bulkBar.SetSelection(display.BulkSelectedIds.Select(BulkSelectionId.Number).ToList(), display.FilteredRuleCount);
    }

    private void RebuildRuleRows(AlertStudioDisplay display)
    {
        string signature = string.Join("|", display.RuleRows.Select(r =>
            string.Create(CultureInfo.InvariantCulture, $"{r.Id}:{r.Name}:{r.Severity}:{r.Enabled}:{r.IsSelected}:{r.IsActive}:{r.Snoozed}:{r.ShowOnceBadge}")));
        if (signature == _ruleRowsSignature)
        {
            return;
        }

        _ruleRowsSignature = signature;
        _ruleRowsHost.Children.Clear();
        foreach (var row in display.RuleRows)
        {
            _ruleRowsHost.Children.Add(BuildRuleRow(row, display.Strings));
        }
    }

    private TsGlassPanel BuildRuleRow(AlertStudioRuleRow row, AlertStudioStrings s)
    {
        long id = row.Id;
        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var check = new TsCheckbox { IsChecked = row.IsSelected, MinWidth = 0, VerticalAlignment = VerticalAlignment.Top };
        AutomationProperties.SetName(check, row.SelectRowLabel);
        check.Click += (_, _) => { if (!_suppress) { _viewModel.ToggleBulkSelect(id, check.IsChecked == true); } };
        Grid.SetColumn(check, 0);
        grid.Children.Add(check);

        var info = new StackPanel { Spacing = 4 };
        var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        nameRow.Children.Add(new TsStatusDot { Severity = row.Severity, VerticalAlignment = VerticalAlignment.Center });
        nameRow.Children.Add(new Text { Value = row.Name, VerticalAlignment = VerticalAlignment.Center });
        if (row.ShowOnceBadge)
        {
            nameRow.Children.Add(new TsBadge { Status = StatusKind.Info, Content = s.RulesOnceMode });
        }

        if (row.Snoozed)
        {
            nameRow.Children.Add(new TsBadge { Status = StatusKind.Warning, Content = row.SnoozeBadgeText });
        }

        info.Children.Add(nameRow);
        info.Children.Add(new Caption { Value = row.SignalOpText });
        var infoButton = new Button
        {
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent),
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Content = info,
        };
        AutomationProperties.SetName(infoButton, row.Name);
        infoButton.Click += (_, _) => _viewModel.SelectRule(id);
        Grid.SetColumn(infoButton, 1);
        grid.Children.Add(infoButton);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Top };
        var snoozeButton = new TsButton { Variant = ButtonVariant.Icon, IconGlyph = SnoozeGlyph };
        AutomationProperties.SetName(snoozeButton, row.SnoozeLabel);
        ToolTipService.SetToolTip(snoozeButton, row.SnoozeLabel);
        snoozeButton.Click += (_, _) => _viewModel.OpenSnooze(id);
        actions.Children.Add(snoozeButton);

        bool enabled = row.Enabled;
        var toggleButton = new TsButton { Variant = ButtonVariant.Icon, IconGlyph = enabled ? EnableGlyph : DisableGlyph };
        AutomationProperties.SetName(toggleButton, row.ToggleLabel);
        ToolTipService.SetToolTip(toggleButton, row.ToggleLabel);
        toggleButton.Click += (_, _) => _ = _viewModel.ToggleAsync(id, !enabled);
        actions.Children.Add(toggleButton);

        var deleteButton = new TsButton { Variant = ButtonVariant.Icon, IconGlyph = DeleteGlyph };
        AutomationProperties.SetName(deleteButton, s.RulesDeleteRule);
        ToolTipService.SetToolTip(deleteButton, s.RulesDeleteRule);
        deleteButton.Click += (_, _) => _ = _viewModel.DeleteAsync(id);
        actions.Children.Add(deleteButton);

        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        var panel = new TsGlassPanel { Padding = new Thickness(12), Content = grid, Glow = row.IsActive ? GlassGlow.Cyan : GlassGlow.None };
        AutomationProperties.SetName(panel, row.AutomationName);
        return panel;
    }

    private void RenderEditor(AlertStudioDisplay display)
    {
        var s = display.Strings;
        var e = display.Editor;

        _editorTitle.Value = display.EditorTitle;
        _formError.Visibility = Show(display.HasFormError);
        _formError.Title = s.FormsValidationFailed;
        _formError.Message = display.FormErrorText;

        _nameInput.Hint = s.NamePrompt;
        _nameInput.Text = e.Name;

        SetOptions(_statusSelect, display.EnabledOptions, e.Enabled ? "true" : "false");

        _allVehiclesToggle.Header = s.VehiclesLabel;
        _allVehiclesToggle.IsOn = e.AllVehicles;
        RebuildVehicleChecks(display);
        _vehicleChecksHost.Visibility = Show(!e.AllVehicles);

        SetButton(_kindSignalButton, s.KindSignal);
        SetButton(_kindMetricButton, s.KindComputedMetric);
        _kindSignalButton.Variant = e.Kind == AlertRuleKindOption.Signal ? ButtonVariant.Primary : ButtonVariant.Subtle;
        _kindMetricButton.Variant = e.Kind == AlertRuleKindOption.ComputedMetric ? ButtonVariant.Primary : ButtonVariant.Subtle;
        _kindHint.Value = e.Kind == AlertRuleKindOption.ComputedMetric ? s.KindComputedMetricHint : s.KindSignalHint;

        _signalRow.Visibility = Show(display.ShowSignalFields);
        SetOptions(_signalSelect, display.SignalOptions, e.SignalName);
        SetOptions(_operatorSelect, display.OperatorOptions, e.Op);
        _signalTypeHint.Visibility = Show(display.ShowSignalTypeHint && display.ShowSignalFields);
        _signalTypeHint.Value = display.SignalTypeHintText;

        _metricNote.Visibility = Show(display.ShowComputedMetric);
        _metricNoteText.Value = s.KindComputedMetricHint;

        SetOptions(_severitySelect, display.SeverityOptions, e.Severity);

        _allowedOpsColumn.Visibility = Show(display.ShowAllowedOperators);
        _allowedOpsLabel.Value = s.AllowedOperatorsLabel;
        _allowedOpsText.Value = display.AllowedOperatorsText;

        RenderTypedValue(display);

        _cooldownInput.Hint = s.CooldownLabel;
        _cooldownInput.Text = e.CooldownMin.ToString(CultureInfo.CurrentCulture);

        SetOptions(_behaviorSelect, display.BehaviorOptions, e.TriggerMode switch
        {
            TriggerModeOption.Once => "once",
            TriggerModeOption.Repeat => "repeat",
            _ => string.Empty,
        });
        _recommendBanner.Visibility = Show(display.ShowRecommendBanner);
        _recommendBanner.Title = display.RecommendBannerText;
        _recommendBanner.Message = display.RecommendBannerAltText;
        _forceChooseError.Visibility = Show(display.TriggerModeBlocked);
        _forceChooseError.Value = s.AlertBehaviorForceChoose;
        _triggerHint.Visibility = Show(display.ShowTriggerHint);
        _triggerHint.Value = display.TriggerHintText;

        _maxFiresHost.Visibility = Show(display.ShowMaxFires);
        _maxFiresInput.Hint = s.MaxFiresPrompt;
        _maxFiresInput.Text = e.MaxFires;
        _maxFiresHint.Value = s.MaxFiresHint;

        _escalationHost.Visibility = Show(display.ShowEscalation);
        _escalationToggle.Header = s.EscalationCheckboxLabel;
        _escalationToggle.IsOn = e.EscalationEnabled;
        _escalationFields.Visibility = Show(display.ShowEscalationFields);
        _escalationAfterInput.Hint = s.EscalationAfterPrompt;
        _escalationAfterInput.Text = e.EscalationAfter;
        SetOptions(_escalationSeveritySelect, display.EscalationSeverityOptions, e.EscalationSeverity);
        _escalationHint.Value = s.EscalationHint;

        _saveButton.Text = display.SaveLabel;
        _saveButton.IsEnabled = display.CanSave;
        _saveButton.IsLoading = display.SavePending;
        _deleteButton.Text = s.ActionsDelete;
        _deleteButton.Visibility = Show(display.ShowDeleteButton);
        _testButton.Text = s.ActionsTest;
        _testButton.IsEnabled = display.TestEnabled;
        _resetButton.Text = s.ActionsReset;
    }

    private void RebuildVehicleChecks(AlertStudioDisplay display)
    {
        string signature = string.Join("|", display.VehicleOptions.Select(v => v.Value + ":" + display.Editor.VehicleIds.Contains(long.Parse(v.Value, CultureInfo.InvariantCulture))));
        if (signature == _vehicleSignature)
        {
            return;
        }

        _vehicleSignature = signature;
        _vehicleChecksHost.Children.Clear();
        foreach (var option in display.VehicleOptions)
        {
            long vid = long.Parse(option.Value, CultureInfo.InvariantCulture);
            var check = new TsCheckbox { Content = option.Label, IsChecked = display.Editor.VehicleIds.Contains(vid) };
            check.Click += (_, _) =>
            {
                if (_suppress)
                {
                    return;
                }

                bool on = check.IsChecked == true;
                _viewModel.UpdateEditor(ed =>
                {
                    var ids = ed.VehicleIds.ToList();
                    if (on && !ids.Contains(vid))
                    {
                        ids.Add(vid);
                    }
                    else if (!on)
                    {
                        ids.Remove(vid);
                    }

                    return ed with { VehicleIds = ids };
                });
            };
            _vehicleChecksHost.Children.Add(check);
        }
    }

    private void RenderTypedValue(AlertStudioDisplay display)
    {
        _typedValueHost.Visibility = Show(display.ShowTypedValue);
        _typedValueHost.Children.Clear();
        if (!display.ShowTypedValue)
        {
            return;
        }

        var s = display.Strings;
        var e = display.Editor;
        _typedValueLabel.Value = s.TypedValueLabel;
        _typedValueHost.Children.Add(_typedValueLabel);

        if (e.SignalName.Trim().Length == 0)
        {
            _typedValueHost.Children.Add(new TsEmptyState { IconGlyph = "\uE7C3", Title = s.NoSignalTitle, Message = s.NoSignalDescription });
            return;
        }

        switch (display.ValueEditorKind)
        {
            case AlertValueKind.None:
                _typedValueHost.Children.Add(new TsGlassPanel
                {
                    Padding = new Thickness(12),
                    Glow = GlassGlow.None,
                    Content = new Caption { Value = s.AnyChangeDescription },
                });
                break;
            case AlertValueKind.Number:
                _typedValueHost.Children.Add(BuildNumberField(s.NumericValueLabel, e.ValueNum, t => _viewModel.UpdateEditor(ed => ed with { ValueNum = t })));
                break;
            case AlertValueKind.Text:
                _typedValueHost.Children.Add(BuildTextField(s.TextValueLabel, s.TextValuePrompt, e.ValueText, t => _viewModel.UpdateEditor(ed => ed with { ValueText = t })));
                break;
            case AlertValueKind.Bool:
                _typedValueHost.Children.Add(BuildBoolField(display));
                break;
            default:
                var grid = new Grid { ColumnSpacing = 12 };
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                var min = BuildNumberField(s.MinValueLabel, e.ValueMin, t => _viewModel.UpdateEditor(ed => ed with { ValueMin = t }));
                var max = BuildNumberField(s.MaxValueLabel, e.ValueMax, t => _viewModel.UpdateEditor(ed => ed with { ValueMax = t }));
                Grid.SetColumn(min, 0);
                Grid.SetColumn(max, 1);
                grid.Children.Add(min);
                grid.Children.Add(max);
                _typedValueHost.Children.Add(grid);
                break;
        }
    }

    private StackPanel BuildNumberField(string label, string value, Action<string> onChange)
    {
        var input = new TsInput { Text = value, InputScope = NumberScope() };
        AutomationProperties.SetName(input, label);
        input.TextChanged += (_, _) => Guarded(() => onChange(input.Text));
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Caption { Value = label });
        column.Children.Add(input);
        return column;
    }

    private StackPanel BuildTextField(string label, string hint, string value, Action<string> onChange)
    {
        var input = new TsInput { Text = value, Hint = hint };
        AutomationProperties.SetName(input, label);
        input.TextChanged += (_, _) => Guarded(() => onChange(input.Text));
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Caption { Value = label });
        column.Children.Add(input);
        return column;
    }

    private StackPanel BuildBoolField(AlertStudioDisplay display)
    {
        var select = new TsSelect();
        SetOptionsDirect(select, display.BoolOptions, display.Editor.ValueBool ? "true" : "false");
        AutomationProperties.SetName(select, display.Strings.BooleanValueLabel);
        select.SelectionChanged += (_, _) =>
        {
            if (!_suppress && select.SelectedValue is string v)
            {
                _viewModel.UpdateEditor(ed => ed with { ValueBool = v == "true" });
            }
        };
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new Caption { Value = display.Strings.BooleanValueLabel });
        column.Children.Add(select);
        return column;
    }

    private void RenderChannels(AlertStudioDisplay display)
    {
        var s = display.Strings;
        _channelsLabel.Value = s.ChannelsTestTargetLabel;
        _channelsLoading.Visibility = Show(display.ChannelsLoading);
        _channelsError.Visibility = Show(display.ChannelsHasError);
        _channelsError.Title = s.ChannelsBrowserToast;
        _channelsListHost.Visibility = Show(display.ChannelsHasList);
        _channelsListLabel.Value = s.ChannelsExternalChannels;
        _channelsEmpty.Visibility = Show(display.ChannelsEmpty);
        _channelsEmpty.Title = s.ChannelsEmptyTitle;
        _channelsEmpty.Message = s.ChannelsEmptyDescription;

        RebuildChannelChips(display);
    }

    private void RebuildChannelChips(AlertStudioDisplay display)
    {
        string signature = string.Join("|", display.ChannelChips.Select(c => string.Create(CultureInfo.InvariantCulture, $"{c.Id}:{c.Label}:{c.IsSelected}")));
        if (signature == _channelSignature)
        {
            return;
        }

        _channelSignature = signature;
        _channelChips.Children.Clear();
        foreach (var chip in display.ChannelChips)
        {
            long cid = chip.Id;
            var button = new TsButton
            {
                Text = chip.Label,
                Variant = chip.IsSelected ? ButtonVariant.Primary : ButtonVariant.Subtle,
                Size = ControlSize.Small,
            };
            AutomationProperties.SetName(button, chip.Label);
            button.Click += (_, _) => _viewModel.ToggleTestChannel(cid);
            _channelChips.Children.Add(button);
        }
    }

    private void RenderSnooze(AlertStudioDisplay display)
    {
        var s = display.Strings;
        _snoozeModal.Title = display.SnoozeTitleText;
        _snoozeModal.CloseButtonText = s.CommonCancel;

        _snoozeBody.Children.Clear();
        _snoozeBody.Children.Add(new Caption { Value = s.SnoozeDescription });
        if (display.SnoozeTargetActive)
        {
            _snoozeBody.Children.Add(new Text { Value = display.SnoozeCurrentlyText });
        }

        long target = display.SnoozeTargetId ?? 0;
        _snoozeBody.Children.Add(BuildSnoozeButton(s.Snooze1h, target, 60));
        _snoozeBody.Children.Add(BuildSnoozeButton(s.Snooze4h, target, 240));
        _snoozeBody.Children.Add(BuildSnoozeButton(s.Snooze24h, target, 1440));
        if (display.SnoozeTargetActive)
        {
            _snoozeBody.Children.Add(BuildSnoozeButton(s.SnoozeCancel, target, 0));
        }

        _snoozeModal.Content = _snoozeBody;

        if (display.SnoozeOpen && !_snoozeShown && XamlRoot is not null)
        {
            _snoozeShown = true;
            _snoozeModal.XamlRoot = XamlRoot;
            _ = _snoozeModal.ShowAsync();
        }
        else if (!display.SnoozeOpen && _snoozeShown)
        {
            _snoozeShown = false;
            _snoozeModal.Hide();
        }
    }

    private TsButton BuildSnoozeButton(string label, long id, int minutes)
    {
        var button = new TsButton { Text = label, Variant = ButtonVariant.Secondary, HorizontalAlignment = HorizontalAlignment.Stretch };
        AutomationProperties.SetName(button, label);
        button.Click += (_, _) => _ = _viewModel.SnoozeAsync(id, minutes);
        return button;
    }

    private void OnSelectChanged(TsSelect select, Action<string> apply)
    {
        if (_suppress)
        {
            return;
        }

        if (select.SelectedValue is string value)
        {
            apply(value);
        }
    }

    private void OnBehaviorChanged(string value)
    {
        if (value != "once" && value != "repeat")
        {
            return;
        }

        _viewModel.UpdateEditor(e => e with
        {
            TriggerMode = value == "once" ? TriggerModeOption.Once : TriggerModeOption.Repeat,
            EscalationEnabled = value == "repeat" && e.EscalationEnabled,
            EscalationAfter = value == "repeat" ? e.EscalationAfter : string.Empty,
            EscalationSeverity = value == "repeat" ? e.EscalationSeverity : string.Empty,
        });
    }

    private static void SetOptions(TsSelect select, IReadOnlyList<AlertStudioSelectOption> options, string selected)
    {
        SetOptionsDirect(select, options, selected);
    }

    private static void SetOptionsDirect(TsSelect select, IReadOnlyList<AlertStudioSelectOption> options, string selected)
    {
        select.DisplayMemberPath = nameof(AlertStudioSelectOption.Label);
        select.SelectedValuePath = nameof(AlertStudioSelectOption.Value);
        select.ItemsSource = options;
        select.SelectedValue = selected;
    }

    private static StackPanel Field(FrameworkElement control, Func<string> label)
    {
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(LabelFor(label));
        control.HorizontalAlignment = HorizontalAlignment.Stretch;
        column.Children.Add(control);
        return column;
    }

    private static Caption LabelFor(Func<string> label)
    {
        var caption = new Caption { Value = label() };
        return caption;
    }

    private static Grid TwoColumn(FrameworkElement left, FrameworkElement right)
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        Grid.SetColumn(left, 0);
        Grid.SetColumn(right, 1);
        grid.Children.Add(left);
        grid.Children.Add(right);
        return grid;
    }

    private void Guarded(Action action)
    {
        if (_suppress)
        {
            return;
        }

        action();
    }

    private static int ParseInt(string text, int fallback) =>
        int.TryParse((text ?? string.Empty).Trim(), NumberStyles.Integer, CultureInfo.CurrentCulture, out var n) ? n : fallback;

    private static InputScope NumberScope()
    {
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(InputScopeNameValue.Number));
        return scope;
    }

    private static void SetButton(TsButton button, string text)
    {
        button.Text = text;
        AutomationProperties.SetName(button, text);
    }

    private static Visibility Show(bool visible) => visible ? Visibility.Visible : Visibility.Collapsed;
}

using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 QuietHoursPanel surface — a parity port of
/// web/src/features/settings/components/QuietHoursPanel.tsx. It composes the web component's glass panel: the
/// header (moon icon, title, subtitle and the "Add window" button), the list of quiet-hours windows (each with an
/// Enabled/Disabled badge, the "start → end (tz)" summary, the next-change hint, the weekday chips, the bypass
/// severities and Edit / Delete actions), the friendly empty state, and the create/edit form (Enabled toggle,
/// Start / End time fields, IANA timezone selector, weekday toggles, bypass-severity toggles, a validation
/// message and Cancel / Create / Update). The list flows through the cache-then-network
/// <see cref="QuietHoursPanelViewModel"/>, so the surface renders every state the P2 contract requires — a
/// skeleton while loading, a retry surface on a hard failure, and a freshness chip (stale / offline) otherwise.
/// The view never performs HTTP; every string resolves through the i18n facade and every interactive element
/// carries a Narrator name. Save / delete outcomes surface as an inline callout (the web toast).
/// </summary>
public sealed partial class QuietHoursPanel : ContentControl, IDisposable
{
    private const string RefreshGlyph = "\uE72C"; // Segoe Fluent — Refresh
    private const string AddGlyph = "\uE710";     // Segoe Fluent — Add
    private const string EditGlyph = "\uE70F";    // Segoe Fluent — Edit
    private const string DeleteGlyph = "\uE74D";  // Segoe Fluent — Delete
    private const string CancelGlyph = "\uE711";  // Segoe Fluent — Cancel
    private const string SaveGlyph = "\uE73E";    // Segoe Fluent — CheckMark
    private const double PanelPadding = 24;       // web p-6

    private readonly QuietHoursPanelViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly QuietHoursDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly int[] _weekdayBits;
    private readonly string[] _severityValues;
    private readonly ToggleButton[] _weekdayToggles;
    private readonly ToggleButton[] _severityToggles;

    private readonly StackPanel _root = new() { Spacing = 16 };

    // Freshness header.
    private readonly StackPanel _header = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
    };

    private readonly TsBadge _freshnessChip = new();
    private readonly TextBlock _freshnessChipText = new() { FontSize = 12 };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _refreshButton = new()
    {
        Variant = ButtonVariant.Subtle,
        Size = ControlSize.Small,
        IconGlyph = RefreshGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _loading = new() { Spacing = 16 };
    private readonly TsQueryError _errorSurface = new();
    private readonly StackPanel _content = new() { Spacing = 16 };

    // Section header.
    private readonly PanelTitle _title = new();
    private readonly Caption _subtitle = new();
    private readonly TsButton _addButton = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        IconGlyph = AddGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    // Save / delete feedback (web toast).
    private readonly TsInlineCallout _feedbackCallout = new() { Dismissible = true, Visibility = Visibility.Collapsed };

    // List + empty state.
    private readonly TsEmptyState _emptyState = new() { IconGlyph = QuietHoursProjection.MoonGlyph, Visibility = Visibility.Collapsed };
    private readonly StackPanel _listPanel = new() { Spacing = 12 };

    // Create / edit form.
    private readonly Border _formPanel;
    private readonly PanelTitle _formTitle = new();
    private readonly TsToggle _enabledToggle = new();
    private readonly Caption _startLabel = new();
    private readonly TsInput _startInput = new() { Hint = "HH:MM" };
    private readonly Caption _endLabel = new();
    private readonly TsInput _endInput = new() { Hint = "HH:MM" };
    private readonly Caption _timezoneLabel = new();
    private readonly TsSelect _timezoneSelect = new();
    private readonly Caption _weekdaysLabel = new();
    private readonly StackPanel _weekdayRow = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly Caption _bypassLabel = new();
    private readonly StackPanel _severityRow = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly ErrorText _validationText = new() { Visibility = Visibility.Collapsed };
    private readonly TsButton _cancelButton = new() { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = CancelGlyph };
    private readonly TsButton _submitButton = new() { Variant = ButtonVariant.Primary, Size = ControlSize.Small, IconGlyph = SaveGlyph };

    private bool _started;
    private bool _renderQueued;
    private bool _updating;
    private bool _disposed;

    /// <summary>Creates the surface over the shared windows source, the i18n facade and optional diagnostics.</summary>
    /// <param name="source">The cache-then-network quiet-hours source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public QuietHoursPanel(IQuietHoursSource source, ILocalizer localizer, QuietHoursDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new QuietHoursDiagnostics();
        _viewModel = new QuietHoursPanelViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _weekdayBits = QuietHoursWeekdayCatalog.Ordered.Select(d => d.Bit).ToArray();
        _severityValues = QuietHoursSeverityCatalog.Ordered.Select(QuietHoursSeverityCatalog.WireValue).ToArray();
        _weekdayToggles = new ToggleButton[_weekdayBits.Length];
        _severityToggles = new ToggleButton[_severityValues.Length];
        _formPanel = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Padding = new Thickness(16),
            Visibility = Visibility.Collapsed,
        };

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>QuietHoursPanel</c>).</summary>
    public static string Slug => QuietHoursRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public QuietHoursPanelViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="QuietHoursSource"/> from the shared data
    /// layer (the host passes the contract client, cache engine and JSON options).
    /// </summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The cache-then-network engine.</param>
    /// <param name="options">The API client options (JSON settings).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector.</param>
    public static QuietHoursPanel Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        QuietHoursDiagnostics? diagnostics = null)
    {
        var source = new QuietHoursSource(api, engine, options);
        return new QuietHoursPanel(source, localizer, diagnostics);
    }

    private void BuildChrome()
    {
        _freshnessChip.Content = _freshnessChipText;
        _freshnessChip.VerticalAlignment = VerticalAlignment.Center;
        _refreshButton.Click += OnRefreshClick;
        _header.Children.Add(_freshnessChip);
        _header.Children.Add(_freshness);
        _header.Children.Add(_refreshButton);

        for (int i = 0; i < 2; i++)
        {
            _loading.Children.Add(BuildSkeletonPanel(i == 0 ? 150 : 200));
        }

        LiveRegion.Configure(_loading);
        _errorSurface.ActionInvoked += (_, _) => _ = _viewModel.RetryAsync();

        _content.Children.Add(BuildPanel());

        _root.Children.Add(_header);
        _root.Children.Add(_loading);
        _root.Children.Add(_errorSurface);
        _root.Children.Add(_content);

        Content = new ScrollViewer
        {
            Content = _root,
            VerticalScrollMode = ScrollMode.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollMode = ScrollMode.Disabled,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(4),
        };
    }

    private TsGlassPanel BuildPanel()
    {
        var content = new StackPanel { Spacing = 20 };
        content.Children.Add(BuildHeaderRow());
        content.Children.Add(_feedbackCallout);
        content.Children.Add(_emptyState);
        content.Children.Add(_listPanel);
        content.Children.Add(BuildForm());
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
    }

    private Grid BuildHeaderRow()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        heading.Children.Add(BuildIconBox(QuietHoursProjection.MoonGlyph));
        var text = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        text.Children.Add(_title);
        text.Children.Add(_subtitle);
        heading.Children.Add(text);

        _addButton.Click += (_, _) => _viewModel.StartCreate();

        Grid.SetColumn(heading, 0);
        Grid.SetColumn(_addButton, 1);
        grid.Children.Add(heading);
        grid.Children.Add(_addButton);
        return grid;
    }

    private Border BuildForm()
    {
        var content = new StackPanel { Spacing = 16 };

        var titleRow = new Grid();
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _enabledToggle.Toggled += (_, _) => OnGuarded(() => _viewModel.SetEnabled(_enabledToggle.IsOn));
        Grid.SetColumn(_formTitle, 0);
        Grid.SetColumn(_enabledToggle, 1);
        titleRow.Children.Add(_formTitle);
        titleRow.Children.Add(_enabledToggle);
        content.Children.Add(titleRow);

        var times = new Grid { ColumnSpacing = 12 };
        times.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        times.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _startInput.TextChanged += (_, _) => OnGuarded(() => _viewModel.SetStart(_startInput.Text));
        _endInput.TextChanged += (_, _) => OnGuarded(() => _viewModel.SetEnd(_endInput.Text));
        var startCol = new StackPanel { Spacing = 4 };
        startCol.Children.Add(_startLabel);
        startCol.Children.Add(_startInput);
        var endCol = new StackPanel { Spacing = 4 };
        endCol.Children.Add(_endLabel);
        endCol.Children.Add(_endInput);
        Grid.SetColumn(startCol, 0);
        Grid.SetColumn(endCol, 1);
        times.Children.Add(startCol);
        times.Children.Add(endCol);
        content.Children.Add(times);

        _timezoneSelect.SelectionChanged += (_, _) => OnGuarded(() =>
        {
            if (_timezoneSelect.SelectedItem is string zone)
            {
                _viewModel.SetTimezone(zone);
            }
        });
        var tzCol = new StackPanel { Spacing = 4 };
        tzCol.Children.Add(_timezoneLabel);
        tzCol.Children.Add(_timezoneSelect);
        content.Children.Add(tzCol);

        var weekdayCol = new StackPanel { Spacing = 8 };
        weekdayCol.Children.Add(_weekdaysLabel);
        for (int i = 0; i < _weekdayToggles.Length; i++)
        {
            int bit = _weekdayBits[i];
            var toggle = new ToggleButton { MinWidth = 44, Padding = new Thickness(0, 4, 0, 4), FontSize = 12 };
            toggle.Click += (_, _) => OnGuarded(() => _viewModel.ToggleWeekday(bit));
            _weekdayToggles[i] = toggle;
            _weekdayRow.Children.Add(toggle);
        }

        weekdayCol.Children.Add(_weekdayRow);
        content.Children.Add(weekdayCol);

        var severityCol = new StackPanel { Spacing = 8 };
        severityCol.Children.Add(_bypassLabel);
        for (int i = 0; i < _severityToggles.Length; i++)
        {
            string value = _severityValues[i];
            var toggle = new ToggleButton { MinWidth = 72, Padding = new Thickness(8, 4, 8, 4), FontSize = 12 };
            toggle.Click += (_, _) => OnGuarded(() => _viewModel.ToggleSeverity(value));
            _severityToggles[i] = toggle;
            _severityRow.Children.Add(toggle);
        }

        severityCol.Children.Add(_severityRow);
        content.Children.Add(severityCol);

        content.Children.Add(_validationText);

        var actions = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        _cancelButton.Click += (_, _) => _viewModel.Cancel();
        _submitButton.Click += (_, _) => _ = _viewModel.SubmitAsync();
        actions.Children.Add(_cancelButton);
        actions.Children.Add(_submitButton);
        content.Children.Add(actions);

        _formPanel.Child = content;
        return _formPanel;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnRefreshClick(object sender, RoutedEventArgs e) => _ = _viewModel.RetryAsync();

    private void OnGuarded(Action apply)
    {
        if (_updating)
        {
            return;
        }

        apply();
    }

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
        var display = _viewModel.Display;
        var state = _viewModel.State;

        AutomationProperties.SetName(this, display.AutomationName);

        bool loading = state == QuietHoursState.Loading;
        bool error = state == QuietHoursState.Error;
        bool hasContent = !loading && !error;

        _loading.Visibility = loading ? Visibility.Visible : Visibility.Collapsed;
        _errorSurface.Visibility = error ? Visibility.Visible : Visibility.Collapsed;
        _content.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;
        _header.Visibility = hasContent ? Visibility.Visible : Visibility.Collapsed;

        if (error)
        {
            RenderError();
            return;
        }

        if (loading)
        {
            return;
        }

        RenderHeader(state);
        RenderContent(display);
    }

    private void RenderError()
    {
        _errorSurface.Title = _localizer.GetString("quietHours.error.title", "Couldn't load quiet-hours windows");
        _errorSurface.Message = _viewModel.ErrorMessage
            ?? _localizer.GetString("quietHours.error.load", "Couldn't load quiet-hours windows");
        _errorSurface.ActionText = _localizer.GetString("common.retry", "Retry");
        _errorSurface.AttemptCount = _viewModel.Attempts;
    }

    private void RenderHeader(QuietHoursState state)
    {
        bool stale = state == QuietHoursState.Stale;
        bool offline = state == QuietHoursState.Offline;

        if (stale || offline)
        {
            string text = offline
                ? _localizer.GetString("settings.offlineChip", "Offline")
                : _localizer.GetString("settings.staleChip", "Stale");
            _freshnessChip.Status = offline ? StatusKind.Danger : StatusKind.Warning;
            _freshnessChipText.Text = text;
            AutomationProperties.SetName(_freshnessChip, text);
            _freshnessChip.Visibility = Visibility.Visible;
        }
        else
        {
            _freshnessChip.Visibility = Visibility.Collapsed;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = offline;
        AutomationProperties.SetName(
            _refreshButton,
            _localizer.GetString("quietHours.refresh", "Refresh quiet-hours windows"));
    }

    private void RenderContent(QuietHoursDisplay display)
    {
        _updating = true;
        try
        {
            _title.Value = display.Title;
            _subtitle.Value = display.Subtitle;
            _addButton.Text = display.AddWindowLabel;
            AutomationProperties.SetName(_addButton, display.AddWindowAutomationName);
            _addButton.Visibility = display.ShowAddButton ? Visibility.Visible : Visibility.Collapsed;

            RenderFeedback(_viewModel.Feedback);

            bool showEmpty = display.Rows.Count == 0 && display.Form is null;
            _emptyState.Visibility = showEmpty ? Visibility.Visible : Visibility.Collapsed;
            if (showEmpty)
            {
                _emptyState.Message = display.EmptyMessage;
            }

            RenderList(display.Rows);
            _listPanel.Visibility = display.Rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

            if (display.Form is { } form)
            {
                RenderForm(form);
                _formPanel.Visibility = Visibility.Visible;
            }
            else
            {
                _formPanel.Visibility = Visibility.Collapsed;
            }
        }
        finally
        {
            _updating = false;
        }
    }

    private void RenderFeedback(QuietHoursFeedback? feedback)
    {
        if (feedback is null)
        {
            _feedbackCallout.Visibility = Visibility.Collapsed;
            return;
        }

        _feedbackCallout.Variant = feedback.IsError ? CalloutVariant.Danger : CalloutVariant.Success;
        _feedbackCallout.Message = feedback.Message;
        _feedbackCallout.IsOpen = true;
        _feedbackCallout.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_feedbackCallout, feedback.Message);
    }

    private void RenderList(IReadOnlyList<QuietHoursRowDisplay> rows)
    {
        _listPanel.Children.Clear();
        foreach (var row in rows)
        {
            _listPanel.Children.Add(BuildRowCard(row));
        }
    }

    private Border BuildRowCard(QuietHoursRowDisplay row)
    {
        var body = new StackPanel { Spacing = 8 };

        var topRow = new Grid { ColumnSpacing = 12 };
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        topRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var summaryRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var badge = new TsBadge { Status = row.StatusKind, VerticalAlignment = VerticalAlignment.Center };
        badge.Content = new TextBlock { Text = row.StatusLabel, FontSize = 12 };
        summaryRow.Children.Add(badge);
        summaryRow.Children.Add(new TextBlock
        {
            Text = row.Summary,
            FontSize = 14,
            VerticalAlignment = VerticalAlignment.Center,
            Foreground = DisplayTokens.TextPrimary,
        });
        if (row.NextChangeLabel is { } next)
        {
            summaryRow.Children.Add(new TextBlock
            {
                Text = next,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = DisplayTokens.TextMuted,
            });
        }

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        long id = row.Window.Id;
        var edit = new TsButton { Variant = ButtonVariant.Secondary, Size = ControlSize.Small, IconGlyph = EditGlyph, Text = row.EditLabel };
        edit.Click += (_, _) => _viewModel.StartEdit(id);
        AutomationProperties.SetName(edit, row.EditAutomationName);
        var delete = new TsButton { Variant = ButtonVariant.Destructive, Size = ControlSize.Small, IconGlyph = DeleteGlyph, Text = row.DeleteLabel };
        delete.Click += (_, _) => _ = _viewModel.DeleteAsync(id);
        delete.IsEnabled = !_viewModel.IsDeleting;
        AutomationProperties.SetName(delete, row.DeleteAutomationName);
        actions.Children.Add(edit);
        actions.Children.Add(delete);

        Grid.SetColumn(summaryRow, 0);
        Grid.SetColumn(actions, 1);
        topRow.Children.Add(summaryRow);
        topRow.Children.Add(actions);
        body.Children.Add(topRow);

        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (var chip in row.Weekdays)
        {
            chips.Children.Add(BuildWeekdayChip(chip));
        }

        body.Children.Add(chips);

        if (row.BypassSeverities.Count > 0)
        {
            var bypass = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                VerticalAlignment = VerticalAlignment.Center,
            };
            bypass.Children.Add(new TextBlock
            {
                Text = row.BypassLabel,
                FontSize = 12,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = DisplayTokens.TextMuted,
            });
            foreach (var severity in row.BypassSeverities)
            {
                var severityBadge = new TsBadge { Status = StatusKind.Warning, VerticalAlignment = VerticalAlignment.Center };
                severityBadge.Content = new TextBlock { Text = severity, FontSize = 12 };
                bypass.Children.Add(severityBadge);
            }

            body.Children.Add(bypass);
        }

        var card = new Border
        {
            CornerRadius = new CornerRadius(8),
            BorderThickness = new Thickness(1),
            BorderBrush = DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Padding = new Thickness(16),
            Child = body,
        };
        AutomationProperties.SetName(card, row.AutomationName);
        return card;
    }

    private static Border BuildWeekdayChip(QuietHoursWeekdayChip chip)
    {
        return new Border
        {
            CornerRadius = new CornerRadius(6),
            BorderThickness = new Thickness(1),
            BorderBrush = chip.IsOn ? DisplayTokens.Accent : DisplayTokens.Border,
            Background = DisplayTokens.Surface,
            Padding = new Thickness(8, 2, 8, 2),
            Child = new TextBlock
            {
                Text = chip.Label,
                FontSize = 11,
                Foreground = chip.IsOn ? DisplayTokens.Accent : DisplayTokens.TextMuted,
            },
        };
    }

    private void RenderForm(QuietHoursFormDisplay form)
    {
        _formTitle.Value = form.Title;
        _enabledToggle.IsOn = form.Enabled;
        _enabledToggle.Header = form.EnabledToggleLabel;
        AutomationProperties.SetName(_enabledToggle, form.EnabledToggleLabel);

        _startLabel.Value = form.StartLabel;
        _startInput.Text = form.StartLocal;
        AutomationProperties.SetName(_startInput, form.StartLabel);
        _endLabel.Value = form.EndLabel;
        _endInput.Text = form.EndLocal;
        AutomationProperties.SetName(_endInput, form.EndLabel);

        _timezoneLabel.Value = form.TimezoneLabel;
        _timezoneSelect.ItemsSource = form.TimezoneOptions;
        _timezoneSelect.SelectedItem = form.Timezone;
        AutomationProperties.SetName(_timezoneSelect, form.TimezoneLabel);

        _weekdaysLabel.Value = form.WeekdaysLabel;
        for (int i = 0; i < _weekdayToggles.Length && i < form.WeekdayToggles.Count; i++)
        {
            var model = form.WeekdayToggles[i];
            var toggle = _weekdayToggles[i];
            toggle.Content = model.Label;
            toggle.IsChecked = model.IsOn;
            AutomationProperties.SetName(toggle, model.AutomationName);
        }

        _bypassLabel.Value = form.BypassLabel;
        for (int i = 0; i < _severityToggles.Length && i < form.SeverityToggles.Count; i++)
        {
            var model = form.SeverityToggles[i];
            var toggle = _severityToggles[i];
            toggle.Content = model.Label;
            toggle.IsChecked = model.IsOn;
            AutomationProperties.SetName(toggle, model.AutomationName);
        }

        bool hasError = form.ValidationError is { Length: > 0 };
        _validationText.Value = form.ValidationError ?? string.Empty;
        _validationText.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;
        _startInput.HasError = hasError;
        _endInput.HasError = hasError;

        _cancelButton.Text = form.CancelLabel;
        AutomationProperties.SetName(_cancelButton, form.CancelLabel);
        _submitButton.Text = form.SubmitLabel;
        _submitButton.IsLoading = _viewModel.IsSaving;
        AutomationProperties.SetName(_submitButton, form.SubmitLabel);
    }

    private static Border BuildIconBox(string glyph)
    {
        var icon = new FontIcon
        {
            Glyph = glyph,
            FontSize = 20,
            Foreground = DisplayTokens.Accent,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        return new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = new CornerRadius(10),
            Background = DisplayTokens.Surface,
            BorderBrush = DisplayTokens.Border,
            BorderThickness = new Thickness(1),
            Child = icon,
        };
    }

    private static TsGlassPanel BuildSkeletonPanel(double bodyHeight)
    {
        var content = new StackPanel { Spacing = 12 };
        content.Children.Add(new TsSkeleton { BlockHeight = 24, BlockWidth = 180 });
        content.Children.Add(new TsSkeleton { BlockHeight = bodyHeight });
        return new TsGlassPanel { Padding = new Thickness(PanelPadding), Content = content };
    }
}

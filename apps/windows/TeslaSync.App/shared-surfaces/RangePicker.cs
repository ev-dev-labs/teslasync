using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 date-range picker surface — a parity port of the web <c>RangePicker</c>
/// (web/src/components/forms/RangePicker.tsx). It renders a single compact trigger (a calendar
/// <see cref="FontIcon"/> + the active-preset label, or "Custom range", + the formatted range + a
/// <c>ChevronDown</c>) that opens a light-dismiss <see cref="Flyout"/> holding a preset list, a range
/// <see cref="CalendarView"/> and an optional comparison toggle + Cancel/Apply footer — reproducing the web
/// popover's data, composition, states and i18n. Clicking a preset commits immediately and closes (web
/// <c>handlePreset</c>); picking days on the calendar stages a range that only commits on Apply (web
/// <c>handleApply</c>), while Cancel / light-dismiss / Escape discard the staged range (web <c>handleCancel</c>
/// + click-outside/Esc — the native flyout supplies the dismiss the web source wires by hand). All state and
/// maths live in the UI-thread-free <see cref="RangePickerViewModel"/> + <see cref="RangePickerLogic"/>; the
/// view performs no logic and no I/O. The trigger carries the localized accessible name + tooltip (the web
/// <c>aria-label</c> / <c>title</c>), the calendar/chevron icons are hidden from Narrator as decoration, every
/// label resolves through the injected <see cref="ILocalizer"/>, and the <c>view.opened</c> diagnostic is
/// emitted exactly once on <see cref="FrameworkElement.Loaded"/>.
///
/// <para>
/// State coverage: the web source is presentational (its only data source is <c>useTranslation</c>; it performs
/// no fetch), so — like the peer presentational surfaces PlaybackSpeedMenu / ChartExportMenu — it has no
/// loading / error / stale / offline chrome to reproduce. The branches it actually has are reproduced in full:
/// the closed trigger (active-preset label vs the "Custom range" fallback), the open popover, the preset list
/// with active highlight, the calendar's staging (start-only vs completed range), the Apply-enabled (dirty) vs
/// disabled (pristine) footer, the comparison toggle vs the day-count summary, and the presets-only layout that
/// hides the calendar + footer.
/// </para>
/// </summary>
public sealed partial class RangePicker : ContentControl, IDisposable
{
    private const string CalendarGlyph = "\uE787"; // Segoe Fluent "Calendar" — the web Lucide Calendar icon.
    private const string ChevronGlyph = "\uE70D";  // Segoe Fluent "ChevronDown" — the web Lucide ChevronDown.
    private const double TriggerIconSize = 14;      // web h-3.5 w-3.5.
    private const double ChevronIconSize = 12;      // web h-3 w-3.
    private const double PresetColumnWidth = 180;   // web md:w-[180px].

    private readonly RangePickerViewModel _viewModel;
    private readonly RangePickerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _trigger;
    private readonly Flyout _flyout = new();
    private readonly TextBlock _triggerLabel;
    private readonly TextBlock _triggerSubLabel;
    private readonly StackPanel _presetPanel = new() { Spacing = 4, Width = PresetColumnWidth };
    private readonly Dictionary<string, ToggleButton> _presetButtons = new(StringComparer.Ordinal);

    private CalendarView? _calendar;
    private TextBlock? _dayCountText;
    private CheckBox? _compareCheck;
    private TsButton? _applyButton;

    private bool _opened;
    private bool _renderQueued;
    private bool _reconciling;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface bound to the inert change sink and the passthrough localizer with a
    /// 30-day default range — the native analogue of mounting the web component with no-op callbacks in an
    /// isolated host. Useful for galleries / design hosts; production callers use the seam constructor.
    /// </summary>
    public RangePicker()
        : this(NoOpRangePickerSink.Instance, PassthroughLocalizer.Instance, DefaultRange())
    {
    }

    /// <summary>Creates the surface over its change seam, localizer, controlled props and diagnostics.</summary>
    /// <param name="sink">The commit/compare seam (web <c>onChange</c> / <c>onCompareChange</c>); pass <see cref="NoOpRangePickerSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="value">The committed range (web <c>value</c>).</param>
    /// <param name="presetIds">The subset of preset ids to render (web <c>presetIds</c>); defaults to <see cref="DatePresets.DefaultIds"/>.</param>
    /// <param name="minDate">The floor for "All time" and selectable dates (web <c>minDate</c>).</param>
    /// <param name="maxDate">The inclusive upper bound for selectable dates (web <c>maxDate</c>); defaults to today.</param>
    /// <param name="enableCompare">Whether the comparison toggle shows (web <c>enableCompare</c>).</param>
    /// <param name="compare">The current comparison flag (web <c>compare</c>).</param>
    /// <param name="presetsOnly">Whether the calendar + footer are hidden (web <c>presetsOnly</c>).</param>
    /// <param name="size">The trigger size (web <c>size</c>); maps to the shared button size scale.</param>
    /// <param name="today">The anchor used to resolve/match relative presets (web <c>new Date()</c>).</param>
    /// <param name="culture">The culture the trigger range string formats with (web <c>i18n.language</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public RangePicker(
        IRangePickerSink sink,
        ILocalizer localizer,
        DateRange value,
        IReadOnlyList<string>? presetIds = null,
        DateOnly? minDate = null,
        DateOnly? maxDate = null,
        bool enableCompare = false,
        bool compare = false,
        bool presetsOnly = false,
        ControlSize size = ControlSize.Small,
        DateOnly? today = null,
        CultureInfo? culture = null,
        RangePickerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new RangePickerDiagnostics();
        _viewModel = new RangePickerViewModel(
            sink, localizer, value, presetIds, minDate, maxDate, enableCompare, compare, presetsOnly, today, culture);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        Brush? muted = TypographyTokens.Brush("TsColorTextMutedBrush");

        var calendarIcon = new FontIcon
        {
            Glyph = CalendarGlyph,
            FontSize = TriggerIconSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        var chevron = new FontIcon
        {
            Glyph = ChevronGlyph,
            FontSize = ChevronIconSize,
            VerticalAlignment = VerticalAlignment.Center,
        };
        if (muted is not null)
        {
            calendarIcon.Foreground = muted;
            chevron.Foreground = muted;
        }

        // The web icons are aria-hidden decoration; keep them out of the Narrator tree.
        AutomationProperties.SetAccessibilityView(calendarIcon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(chevron, AccessibilityView.Raw);

        _triggerLabel = new TextBlock
        {
            FontWeight = TypographyTokens.Weight(500), // web font-medium.
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        _triggerSubLabel = new TextBlock
        {
            VerticalAlignment = VerticalAlignment.Center,
            TextTrimming = TextTrimming.CharacterEllipsis,
        };
        if (muted is not null)
        {
            _triggerSubLabel.Foreground = muted;
        }

        var triggerContent = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6, // web gap-1.5.
            VerticalAlignment = VerticalAlignment.Center,
        };
        triggerContent.Children.Add(calendarIcon);
        triggerContent.Children.Add(_triggerLabel);
        triggerContent.Children.Add(_triggerSubLabel);
        triggerContent.Children.Add(chevron);

        _trigger = new TsButton
        {
            Variant = ButtonVariant.Outline,
            Size = size,
            Content = triggerContent,
            Flyout = _flyout,
        };

        AutomationProperties.SetName(_presetPanel, _viewModel.PresetListLabel);

        _flyout.Content = BuildPopover();
        _flyout.Opening += OnFlyoutOpening;
        _flyout.Closed += OnFlyoutClosed;

        IsTabStop = false;

        // Transparent structural wrapper: the web root is a fragment with no semantics, so the surface hides
        // itself from Narrator and lets the trigger button + its popover carry the accessible semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = _trigger;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>RangePicker</c>).</summary>
    public static string Slug => RangePickerRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public RangePickerViewModel ViewModel => _viewModel;

    /// <summary>The committed range (web <c>value</c>). A controlled host assigns this after a commit to echo the new range back.</summary>
    public DateRange Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The current comparison flag (web <c>compare</c>). A controlled host assigns this after the toggle fires.</summary>
    public bool Compare
    {
        get => _viewModel.Compare;
        set => _viewModel.Compare = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _flyout.Opening -= OnFlyoutOpening;
        _flyout.Closed -= OnFlyoutClosed;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        if (_calendar is not null)
        {
            _calendar.SelectedDatesChanged -= OnCalendarSelectionChanged;
        }

        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new RangePickerAutomationPeer(this);

    private static DateRange DefaultRange()
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Today);
        return new DateRange(today.AddDays(-29), today);
    }

    private static DateTimeOffset ToOffset(DateOnly date) =>
        new(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified));

    private StackPanel BuildPopover()
    {
        var root = new StackPanel { Orientation = Orientation.Horizontal };
        AutomationProperties.SetName(root, _viewModel.PopoverLabel);

        foreach (RangePickerPreset preset in _viewModel.Presets)
        {
            string id = preset.Id;
            var button = new ToggleButton
            {
                Content = preset.Label,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Left,
            };
            AutomationProperties.SetName(button, preset.Label);
            button.Click += (_, _) =>
            {
                _viewModel.SelectPreset(id);
                _flyout.Hide();
            };
            _presetButtons[id] = button;
            _presetPanel.Children.Add(button);
        }

        root.Children.Add(new ScrollViewer
        {
            Content = _presetPanel,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Padding = new Thickness(8),
        });

        if (_viewModel.ShowCalendar)
        {
            root.Children.Add(BuildCalendarColumn());
        }

        return root;
    }

    private StackPanel BuildCalendarColumn()
    {
        var column = new StackPanel { Spacing = 8, Padding = new Thickness(8) };

        _calendar = new CalendarView
        {
            SelectionMode = CalendarViewSelectionMode.Multiple,
            MaxDate = ToOffset(_viewModel.MaxDate ?? _viewModel.Today),
        };
        if (_viewModel.MinDate is { } min)
        {
            _calendar.MinDate = ToOffset(min);
        }

        _calendar.SelectedDatesChanged += OnCalendarSelectionChanged;
        column.Children.Add(_calendar);

        var footer = new Grid();
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        if (_viewModel.ShowCompare)
        {
            _compareCheck = new CheckBox
            {
                Content = _viewModel.CompareLabel,
                IsChecked = _viewModel.Compare,
                VerticalAlignment = VerticalAlignment.Center,
            };
            AutomationProperties.SetName(_compareCheck, _viewModel.CompareLabel);
            _compareCheck.Checked += (_, _) => _viewModel.SetCompare(true);
            _compareCheck.Unchecked += (_, _) => _viewModel.SetCompare(false);
            Grid.SetColumn(_compareCheck, 0);
            footer.Children.Add(_compareCheck);
        }
        else
        {
            Brush? muted = TypographyTokens.Brush("TsColorTextMutedBrush");
            _dayCountText = new TextBlock
            {
                Text = _viewModel.StagedDaysLabel,
                FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
                VerticalAlignment = VerticalAlignment.Center,
            };
            if (muted is not null)
            {
                _dayCountText.Foreground = muted;
            }

            Grid.SetColumn(_dayCountText, 0);
            footer.Children.Add(_dayCountText);
        }

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        var cancel = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            Text = _viewModel.CancelLabel,
        };
        cancel.Click += (_, _) =>
        {
            _viewModel.Cancel();
            _flyout.Hide();
        };
        _applyButton = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Size = ControlSize.Small,
            Text = _viewModel.ApplyLabel,
            IsEnabled = _viewModel.IsApplyEnabled,
        };
        _applyButton.Click += (_, _) =>
        {
            _viewModel.Apply();
            _flyout.Hide();
        };
        actions.Children.Add(cancel);
        actions.Children.Add(_applyButton);
        Grid.SetColumn(actions, 1);
        footer.Children.Add(actions);

        column.Children.Add(footer);
        return column;
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (!_opened)
        {
            _opened = true;

            // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
            _diagnostics.RecordViewOpened();
        }

        Render();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnFlyoutOpening(object? sender, object e)
    {
        _viewModel.Open();
        ReconcileCalendar();
        Render();
    }

    private void OnFlyoutClosed(object? sender, object e) => _viewModel.NotifyClosed();

    private void OnCalendarSelectionChanged(CalendarView sender, CalendarViewSelectedDatesChangedEventArgs args)
    {
        if (_reconciling)
        {
            return;
        }

        DateTimeOffset? tapped = null;
        if (args.AddedDates.Count > 0)
        {
            tapped = args.AddedDates[args.AddedDates.Count - 1];
        }
        else if (args.RemovedDates.Count > 0)
        {
            tapped = args.RemovedDates[args.RemovedDates.Count - 1];
        }

        if (tapped is not { } offset)
        {
            return;
        }

        _viewModel.StageDay(DateOnly.FromDateTime(offset.LocalDateTime.Date));
        ReconcileCalendar();
        Render();
    }

    private void ReconcileCalendar()
    {
        if (_calendar is null)
        {
            return;
        }

        _reconciling = true;
        try
        {
            _calendar.SelectedDates.Clear();
            if (_viewModel.StagedFrom is { } from)
            {
                DateOnly to = _viewModel.StagedTo ?? from;
                for (DateOnly day = from; day <= to; day = day.AddDays(1))
                {
                    _calendar.SelectedDates.Add(ToOffset(day));
                }
            }
        }
        finally
        {
            _reconciling = false;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e) => ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
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
        _triggerLabel.Text = _viewModel.TriggerLabel;
        _triggerSubLabel.Text = _viewModel.TriggerSubLabel;

        AutomationProperties.SetName(_trigger, _viewModel.TriggerAccessibleName);
        ToolTipService.SetToolTip(_trigger, _viewModel.TriggerTooltip);

        string? activeId = _viewModel.ActivePresetId;
        foreach (KeyValuePair<string, ToggleButton> entry in _presetButtons)
        {
            entry.Value.IsChecked = string.Equals(entry.Key, activeId, StringComparison.Ordinal);
        }

        if (_dayCountText is not null)
        {
            _dayCountText.Text = _viewModel.StagedDaysLabel;
        }

        if (_compareCheck is not null)
        {
            _compareCheck.IsChecked = _viewModel.Compare;
        }

        if (_applyButton is not null)
        {
            _applyButton.IsEnabled = _viewModel.IsApplyEnabled;
        }
    }

    private sealed class RangePickerAutomationPeer : FrameworkElementAutomationPeer
    {
        public RangePickerAutomationPeer(RangePicker owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((RangePicker)Owner).ViewModel.TriggerAccessibleName
                : name;
        }
    }
}

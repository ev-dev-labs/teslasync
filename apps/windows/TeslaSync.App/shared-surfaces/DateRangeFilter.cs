using System.Collections.Generic;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 date-range-filter surface — a parity port of the web <c>DateRangeFilter</c>
/// (web/src/components/forms/DateRangeFilter.tsx) with its embedded preset chip row
/// (web/src/components/forms/DatePresetChips.tsx). It renders a tokenized pill holding a leading calendar
/// glyph, a start <see cref="CalendarDatePicker"/>, a "→" separator and an end <see cref="CalendarDatePicker"/>
/// (web's two <c>&lt;input type="date"&gt;</c> fields), an optional primary Apply <see cref="TsButton"/> (web
/// <c>{onApply &amp;&amp; ...}</c>) and an optional quick-select row of <see cref="TsButton"/> chips — primary when
/// active, subtle otherwise (web <c>variant={active ? 'primary' : 'ghost'}</c>) — reproducing the web data,
/// composition, branches and i18n. All state flows through the shared <see cref="DateRangeFilterViewModel"/>;
/// the view never performs I/O. Every label resolves through the i18n facade, each date picker and chip carries
/// an accessible name, and the chip row is exposed as a named group. Choosing a preset routes through the
/// view-model, which either writes the range atomically (web <c>onRangeChange</c> → <c>useUrlBatch</c>) or fires
/// the two granular setters and then requests Apply.
///
/// <para>
/// State coverage: the web source is a presentational picker whose only data sources are <c>useTranslation</c>
/// and <c>useUrlBatch</c> (neither a data fetch), so it has no loading / error / stale / offline chrome to
/// reproduce. The branches it actually has are reproduced in full — preset row shown vs hidden, Apply shown vs
/// hidden, a chip active vs none, atomic vs granular selection and an empty / malformed window — and are
/// verified headlessly on <see cref="DateRangeFilterViewModel"/>.
/// </para>
/// </summary>
public sealed partial class DateRangeFilter : ContentControl, IDisposable
{
    private const string CalendarGlyph = "\uE787"; // Segoe Fluent "Calendar" (web Calendar icon).
    private const string SeparatorGlyph = "\u2192"; // "→" (web range separator).
    private const double PillPaddingX = 10;
    private const double PillPaddingY = 4;
    private const double PillCornerRadius = 8;

    private readonly DateRangeFilterViewModel _viewModel;
    private readonly DateRangeFilterDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly Border _pill = new()
    {
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(PillCornerRadius),
        Padding = new Thickness(PillPaddingX, PillPaddingY, PillPaddingX, PillPaddingY),
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _calendarIcon = new()
    {
        Glyph = CalendarGlyph,
        FontSize = 14,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly CalendarDatePicker _startPicker = new();
    private readonly CalendarDatePicker _endPicker = new();
    private readonly TextBlock _separator = new()
    {
        Text = SeparatorGlyph,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _apply = new()
    {
        Variant = ButtonVariant.Primary,
        Size = ControlSize.Small,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly StackPanel _chips = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 4,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private bool _suppress;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a headless-safe surface with the passthrough localizer, the default presets and no Apply / batch
    /// writer — the native analogue of mounting the web component in an isolated host. Production callers use the
    /// seam constructor.
    /// </summary>
    public DateRangeFilter()
        : this(PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its i18n facade and configuration.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    /// <param name="startDate">The initial inclusive start day, ISO <c>yyyy-MM-dd</c> (web <c>startDate</c>).</param>
    /// <param name="endDate">The initial inclusive end day, ISO <c>yyyy-MM-dd</c> (web <c>endDate</c>).</param>
    /// <param name="presetIds">The chip ids to surface (web <c>presetIds</c>); null defaults to the catalogue default set.</param>
    /// <param name="showPresets">Whether the preset chip row is shown (web <c>presets</c>, default true).</param>
    /// <param name="hasApply">Whether the Apply button is shown and Apply is requested after a preset selection (web <c>onApply</c>).</param>
    /// <param name="atomicRangeUpdate">Force the atomic single-write selection path (web <c>onRangeChange</c>); implied when a non-inert <paramref name="urlWriter"/> is supplied.</param>
    /// <param name="urlWriter">The atomic range-writer seam (web <c>useUrlBatch</c>); null defaults to the inert no-op.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="today">The "today" anchor relative presets resolve against (web <c>new Date()</c>); null defaults to the local wall-clock day.</param>
    public DateRangeFilter(
        ILocalizer localizer,
        string startDate = "",
        string endDate = "",
        IReadOnlyList<string>? presetIds = null,
        bool showPresets = true,
        bool hasApply = false,
        bool atomicRangeUpdate = false,
        IDateRangeUrlWriter? urlWriter = null,
        DateRangeFilterDiagnostics? diagnostics = null,
        DateOnly? today = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _diagnostics = diagnostics ?? new DateRangeFilterDiagnostics();
        _viewModel = new DateRangeFilterViewModel(
            localizer,
            startDate,
            endDate,
            presetIds,
            showPresets,
            hasApply,
            atomicRangeUpdate,
            urlWriter,
            today);

        IsTabStop = false;

        if (Brush("TsColorTextMutedBrush") is { } mutedBrush)
        {
            _calendarIcon.Foreground = mutedBrush;
            _separator.Foreground = mutedBrush;
        }

        if (Brush("TsColorSurfaceGlassBrush") is { } surfaceBrush)
        {
            _pill.Background = surfaceBrush;
        }

        if (Brush("TsColorBorderBrush") is { } borderBrush)
        {
            _pill.BorderBrush = borderBrush;
        }

        var pillRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };
        pillRow.Children.Add(_calendarIcon);
        pillRow.Children.Add(_startPicker);
        pillRow.Children.Add(_separator);
        pillRow.Children.Add(_endPicker);
        _pill.Child = pillRow;

        _root.Children.Add(_pill);
        _root.Children.Add(_apply);
        _root.Children.Add(_chips);
        Content = _root;

        _startPicker.DateChanged += OnStartDateChanged;
        _endPicker.DateChanged += OnEndDateChanged;
        _apply.Click += OnApplyClicked;
        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>DateRangeFilter</c>).</summary>
    public static string Slug => DateRangeFilterRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DateRangeFilterViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _startPicker.DateChanged -= OnStartDateChanged;
        _endPicker.DateChanged -= OnEndDateChanged;
        _apply.Click -= OnApplyClicked;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DateRangeFilterAutomationPeer(this);

    private static Brush? Brush(string key) =>
        Application.Current.Resources.TryGetValue(key, out object? value) && value is Brush brush ? brush : null;

    private static DateTimeOffset? IsoToOffset(string iso) =>
        IsoDate.TryParse(iso, out DateOnly date)
            ? new DateTimeOffset(date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified))
            : null;

    private static string OffsetToIso(DateTimeOffset? offset) =>
        offset is { } value ? IsoDate.ToIso(DateOnly.FromDateTime(value.DateTime)) : string.Empty;

    private void OnStartDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (_suppress)
        {
            return;
        }

        _viewModel.SetStartDate(OffsetToIso(sender.Date));
    }

    private void OnEndDateChanged(CalendarDatePicker sender, CalendarDatePickerDateChangedEventArgs args)
    {
        if (_suppress)
        {
            return;
        }

        _viewModel.SetEndDate(OffsetToIso(sender.Date));
    }

    private void OnApplyClicked(object sender, RoutedEventArgs e) => _viewModel.RequestApply();

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

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
        _suppress = true;
        try
        {
            _startPicker.Date = IsoToOffset(_viewModel.StartDate);
            _endPicker.Date = IsoToOffset(_viewModel.EndDate);
        }
        finally
        {
            _suppress = false;
        }

        // Accessible names for the date inputs (web aria-label on each <input>).
        AutomationProperties.SetName(_startPicker, _viewModel.StartLabel);
        AutomationProperties.SetName(_endPicker, _viewModel.EndLabel);

        // Apply button: shown only when an Apply handler is wired (web {onApply && ...}).
        _apply.Visibility = _viewModel.HasApply ? Visibility.Visible : Visibility.Collapsed;
        _apply.Text = _viewModel.ApplyLabel;
        AutomationProperties.SetName(_apply, _viewModel.ApplyLabel);

        // Preset chip row: shown only when presets are enabled (web {presets && ...}).
        _chips.Visibility = _viewModel.ShowPresets ? Visibility.Visible : Visibility.Collapsed;
        AutomationProperties.SetName(_chips, _viewModel.PresetGroupLabel);

        if (_viewModel.ShowPresets)
        {
            BuildChips();
        }
        else
        {
            _chips.Children.Clear();
        }
    }

    private void BuildChips()
    {
        _chips.Children.Clear();

        foreach (DatePresetChip chip in _viewModel.Chips)
        {
            var button = new TsButton
            {
                Variant = DateRangeFilterViewModel.ChipVariantFor(chip.IsActive),
                Size = ControlSize.Small,
                Text = chip.Label,
            };

            AutomationProperties.SetName(button, chip.Label);

            // web key / quick-select id — expose it as the automation id for UI-automation hooks.
            AutomationProperties.SetAutomationId(button, chip.Id);

            string id = chip.Id;
            button.Click += (_, _) => _viewModel.SelectPreset(id);

            _chips.Children.Add(button);
        }
    }

    private sealed class DateRangeFilterAutomationPeer : FrameworkElementAutomationPeer
    {
        public DateRangeFilterAutomationPeer(DateRangeFilter owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((DateRangeFilter)Owner).ViewModel.PresetGroupLabel
                : name;
        }
    }
}

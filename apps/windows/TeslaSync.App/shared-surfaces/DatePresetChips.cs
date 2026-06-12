using System.ComponentModel;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.Foundation;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>DatePresetChips</c> shared surface — a parity port of the web <c>DatePresetChips</c>
/// (web/src/components/forms/DatePresetChips.tsx). It is the quick-select chip row for date ranges: a wrapping
/// group of <see cref="TsButton"/> chips, one per preset id (filtered from the shared <c>DATE_PRESETS</c>
/// catalogue and defaulting to <c>DEFAULT_PRESET_IDS</c>), where the active preset reads as a filled primary
/// chip (the web <c>variant="primary"</c> + <c>aria-pressed</c>) and the rest as ghost/subtle chips
/// (web <c>variant="ghost"</c>). Picking a chip raises <see cref="PresetSelected"/> with the resolved
/// <see cref="DatePresetSelection"/> (id + inclusive ISO range), the native analogue of the web
/// <c>onSelect({ id, start, end })</c>. The web component is presentational — it consumes only
/// <c>useTranslation</c> and the static preset table — so the surface has just the two honest states the
/// catalogue can yield: the populated chip row (<see cref="DatePresetChipsState.Populated"/>) or, when the
/// supplied ids resolve to no presets, a friendly empty surface (<see cref="DatePresetChipsState.Empty"/>, never
/// a blank box). There is therefore no loading / error / stale / offline branch — the web source has none, and
/// inventing them would be drift. The chips are projected by the UI-thread-free
/// <see cref="DatePresetChipsViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade, the row carries a Narrator group name (the web <c>role="group"</c> + <c>aria-label</c>), every chip a
/// Narrator name plus a toggle pattern reporting the pressed state (the web <c>aria-pressed</c>), the layout
/// uses platform tokens (no ported web Tailwind), and the surface adds no custom motion so the reduced-motion /
/// "show animations" system preference is honoured by construction and chip text scales with the system
/// text-scaling setting.
/// </summary>
public sealed partial class DatePresetChips : ContentControl, IDisposable
{
    // Web row: "flex flex-wrap items-center gap-1" — a 4px gap on both axes (Tailwind gap-1 = 0.25rem).
    private const double Gap = 4;
    private const double PillRadiusFallback = 9999;

    private readonly DatePresetChipsViewModel _viewModel;
    private readonly DatePresetChipsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly Grid _host = new();

    private string _groupName = string.Empty;
    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates the surface over a default in-memory source (the designer / simple-host entry point): it renders
    /// the default preset chip set with no active highlight. Supply an explicit
    /// <see cref="IDatePresetChipsSource"/> via the other constructor to drive the rendered ids, the active id,
    /// the size and the group name from the composition root.
    /// </summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public DatePresetChips(ILocalizer localizer)
        : this(new DatePresetChipsSource(), localizer, diagnostics: null)
    {
    }

    /// <summary>Creates the surface over its data seam, localizer and optional diagnostics collector.</summary>
    /// <param name="source">The chip input state-holder seam (web props).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public DatePresetChips(
        IDatePresetChipsSource source,
        ILocalizer localizer,
        DatePresetChipsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new DatePresetChipsDiagnostics();
        _viewModel = new DatePresetChipsViewModel(source, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Left;
        VerticalContentAlignment = VerticalAlignment.Center;
        Content = _host;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _viewModel.Selected += OnViewModelSelected;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>
    /// Raised when a preset chip is picked, carrying the resolved <see cref="DatePresetSelection"/> — the native
    /// analogue of the web <c>onSelect</c> callback. The host applies the range to its date filter.
    /// </summary>
    public event EventHandler<DatePresetSelection>? PresetSelected;

    /// <summary>The canonical diagnostics slug this surface reports under (<c>DatePresetChips</c>).</summary>
    public static string Slug => DatePresetChipsRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public DatePresetChipsViewModel ViewModel => _viewModel;

    /// <summary>
    /// Re-resolve every label from the localizer and re-render — call after the active language changes so the
    /// chips and group name update without reconstructing the surface (web react-i18next parity).
    /// </summary>
    public void Reload() => _viewModel.Reload();

    /// <summary>Detach from the view-model and lifecycle events (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Selected -= OnViewModelSelected;
        _viewModel.Dispose();
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new DatePresetChipsAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is null or nameof(DatePresetChipsViewModel.Display))
        {
            ScheduleRender();
        }
    }

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;

        // A source change can be raised from a background settings/live callback; render on the UI thread.
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
        DatePresetChipsDisplay display = _viewModel.Display;
        _groupName = display.GroupName;
        AutomationProperties.SetName(this, display.GroupName);

        _host.Children.Clear();
        _host.Children.Add(display.IsEmpty ? BuildEmpty(display) : BuildChips(display));
    }

    private static TsEmptyState BuildEmpty(DatePresetChipsDisplay display) => new()
    {
        Message = display.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private ChipWrapPanel BuildChips(DatePresetChipsDisplay display)
    {
        var row = new ChipWrapPanel
        {
            HorizontalSpacing = Gap,
            VerticalSpacing = Gap,
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
        };

        foreach (DatePresetChipItem item in display.Items)
        {
            row.Children.Add(BuildChip(item, display.Size));
        }

        return row;
    }

    private PresetChipButton BuildChip(DatePresetChipItem item, DatePresetChipSize size)
    {
        var chip = new PresetChipButton
        {
            // web: variant={active ? 'primary' : 'ghost'} — the native subtle variant is the ghost analogue.
            Variant = item.IsActive ? ButtonVariant.Primary : ButtonVariant.Subtle,
            Size = size == DatePresetChipSize.Md ? ControlSize.Medium : ControlSize.Small,
            Text = item.Label,
            IsActive = item.IsActive,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", PillRadiusFallback),
        };

        AutomationProperties.SetName(chip, item.Label);
        ToolTipService.SetToolTip(chip, item.Label);

        string id = item.Id;
        chip.Click += (_, _) => OnChipActivated(id);
        return chip;
    }

    private void OnChipActivated(string id)
    {
        if (_viewModel.Select(id))
        {
            _diagnostics.RecordPresetSelected(id);
        }
    }

    private void OnViewModelSelected(object? sender, DatePresetSelection e) => RaisePresetSelected(e);

    private void RaisePresetSelected(DatePresetSelection selection) => PresetSelected?.Invoke(this, selection);

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child
    /// would overflow the available width — the native equivalent of the web row's <c>flex flex-wrap gap-1</c>.
    /// Base WinUI ships no wrap panel, so the surface carries its own (the same pattern the chat suggestion strip
    /// and the dashboard chip clusters use).
    /// </summary>
    private sealed partial class ChipWrapPanel : Panel
    {
        /// <summary>Horizontal gap between chips on a row.</summary>
        public double HorizontalSpacing { get; set; }

        /// <summary>Vertical gap between wrapped rows.</summary>
        public double VerticalSpacing { get; set; }

        protected override Size MeasureOverride(Size availableSize)
        {
            double maxWidth = double.IsNaN(availableSize.Width) || double.IsInfinity(availableSize.Width)
                ? double.PositiveInfinity
                : availableSize.Width;

            double rowWidth = 0;
            double rowHeight = 0;
            double totalHeight = 0;
            double widest = 0;

            foreach (UIElement child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                Size desired = child.DesiredSize;

                if (rowWidth > 0 && rowWidth + HorizontalSpacing + desired.Width > maxWidth)
                {
                    widest = Math.Max(widest, rowWidth);
                    totalHeight += rowHeight + VerticalSpacing;
                    rowWidth = desired.Width;
                    rowHeight = desired.Height;
                }
                else
                {
                    rowWidth += (rowWidth > 0 ? HorizontalSpacing : 0) + desired.Width;
                    rowHeight = Math.Max(rowHeight, desired.Height);
                }
            }

            widest = Math.Max(widest, rowWidth);
            totalHeight += rowHeight;

            double measuredWidth = double.IsInfinity(maxWidth) ? widest : maxWidth;
            return new Size(measuredWidth, totalHeight);
        }

        protected override Size ArrangeOverride(Size finalSize)
        {
            double x = 0;
            double y = 0;
            double rowHeight = 0;

            foreach (UIElement child in Children)
            {
                Size desired = child.DesiredSize;
                if (x > 0 && x + HorizontalSpacing + desired.Width > finalSize.Width)
                {
                    x = 0;
                    y += rowHeight + VerticalSpacing;
                    rowHeight = 0;
                }

                if (x > 0)
                {
                    x += HorizontalSpacing;
                }

                child.Arrange(new Rect(x, y, desired.Width, desired.Height));
                x += desired.Width;
                rowHeight = Math.Max(rowHeight, desired.Height);
            }

            return finalSize;
        }
    }

    /// <summary>
    /// A preset chip — a <see cref="TsButton"/> that additionally exposes the UIA Toggle pattern so a screen
    /// reader announces the active highlight as a pressed state, the faithful native mapping of the web chip's
    /// <c>aria-pressed</c> (web/src/components/forms/DatePresetChips.tsx L66). It stays a button (it is invoked,
    /// firing <c>Click</c>) and adds the toggle state on top, exactly as the web markup is a
    /// <c>&lt;button aria-pressed&gt;</c>.
    /// </summary>
    private sealed partial class PresetChipButton : TsButton
    {
        /// <summary>Whether this chip is the active preset (drives the toggle pattern's On/Off state).</summary>
        public bool IsActive { get; set; }

        /// <inheritdoc />
        protected override AutomationPeer OnCreateAutomationPeer() => new PresetChipAutomationPeer(this);

        private sealed partial class PresetChipAutomationPeer : ButtonAutomationPeer, IToggleProvider
        {
            public PresetChipAutomationPeer(PresetChipButton owner)
                : base(owner)
            {
            }

            private PresetChipButton Chip => (PresetChipButton)Owner;

            public ToggleState ToggleState => Chip.IsActive ? ToggleState.On : ToggleState.Off;

            protected override object? GetPatternCore(PatternInterface patternInterface) =>
                patternInterface == PatternInterface.Toggle ? this : base.GetPatternCore(patternInterface);

            // The web chip is a button: toggling it from assistive tech performs the same action as a click
            // (selecting the preset), so route Toggle through the inherited Invoke provider.
            public void Toggle()
            {
                if (GetPattern(PatternInterface.Invoke) is IInvokeProvider invoke)
                {
                    invoke.Invoke();
                }
            }
        }
    }

    /// <summary>
    /// Reports the chip row as a UIA group carrying the localized <c>aria-label</c> — the faithful mapping of the
    /// web container's <c>role="group"</c> so Narrator announces the group name and enumerates the chips within.
    /// </summary>
    private sealed partial class DatePresetChipsAutomationPeer : FrameworkElementAutomationPeer
    {
        public DatePresetChipsAutomationPeer(DatePresetChips owner)
            : base(owner)
        {
        }

        private DatePresetChips Surface => (DatePresetChips)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface._groupName : name;
        }
    }
}

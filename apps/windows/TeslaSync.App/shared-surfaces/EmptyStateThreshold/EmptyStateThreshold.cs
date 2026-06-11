using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 <c>EmptyStateThreshold</c> shared surface — a parity port of
/// web/src/components/feedback/EmptyStateThreshold.tsx. It is the non-error empty state for a section that only
/// becomes useful at scale (e.g. a cost heatmap that needs ≥ 30 charging sessions). Per the /charging redesign
/// spec it is never silently hidden: operators always see the section exists and what unlocks it. It renders a
/// healthy green check-circle (the section is fine, just waiting for more data), the gated section's title beside
/// a small info hint, an optional one-line description, a friendly "Need at least N {noun}. You have M so far."
/// count message (or a caller override), and an optional call-to-action.
///
/// <para>
/// State coverage: the web source is presentational and driven entirely by props — its only data source is
/// <c>useTranslation</c> (the i18n facade) and it performs no network/query fetch, so it has no loading / error /
/// stale / offline chrome to reproduce (exactly like the peer presentational surfaces <c>Delta</c> and
/// <c>SourceLayerBadge</c>). The branches it actually has are reproduced in full: the default count message vs a
/// caller override (web <c>message ?? defaultMessage</c>), the default item noun vs a supplied one
/// (web <c>itemNoun ?? t(defaultItem)</c>), the optional description (web <c>description &amp;&amp; …</c>) and the
/// optional action region (web <c>action &amp;&amp; …</c>).
/// </para>
///
/// <para>
/// All state flows through <see cref="EmptyStateThresholdViewModel"/> and the P1/S8
/// <see cref="IEmptyStateThresholdSource"/> seam; the view performs no I/O and reads no query itself. The outer
/// panel is a polite live region whose composed text (title + description + message) is announced on change
/// (web <c>role="status" aria-live="polite"</c>); the check and info glyphs are decorative for assistive tech
/// (web <c>aria-hidden</c>). It emits the <c>view.opened</c> diagnostic once when it is shown.
/// </para>
/// </summary>
public sealed partial class EmptyStateThreshold : ContentControl, IDisposable
{
    private const double PanelPadH = 16;   // web px-4
    private const double PanelPadV = 20;   // web py-5
    private const double IconGap = 12;     // web gap-3
    private const double TitleGap = 8;     // web gap-2
    private const double DescriptionTopMargin = 2;  // web mt-0.5
    private const double MessageTopMargin = 8;      // web mt-2
    private const double ActionTopMargin = 12;      // web mt-3
    private const double MessageLineHeight = 19;    // web leading-relaxed (≈1.625 × 12)

    private readonly EmptyStateThresholdViewModel _viewModel;
    private readonly EmptyStateThresholdDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly Border _panel = new()
    {
        BorderThickness = new Thickness(1),
        Padding = new Thickness(PanelPadH, PanelPadV, PanelPadH, PanelPadV),
        Background = DisplayTokens.Brush("TsColorSurfaceGlassBrush"),
        BorderBrush = DisplayTokens.Brush("TsColorBorderBrush"),
    };

    private readonly FontIcon _checkIcon = new()
    {
        Glyph = EmptyStateThresholdRegistration.CheckGlyph,
        FontSize = EmptyStateThresholdRegistration.CheckIconSize,
        Foreground = DisplayTokens.Brush("TsColorSuccessBrush"),
        VerticalAlignment = VerticalAlignment.Top,
    };

    private readonly TextBlock _title = new()
    {
        FontSize = TypographyTokens.Size("TsTypeBodyFontSize", 14),
        FontWeight = TypographyTokens.Weight(600),
        Foreground = DisplayTokens.TextPrimary,
        TextWrapping = TextWrapping.Wrap,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly FontIcon _infoIcon = new()
    {
        Glyph = EmptyStateThresholdRegistration.InfoGlyph,
        FontSize = EmptyStateThresholdRegistration.InfoIconSize,
        Foreground = DisplayTokens.TextMuted,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TextBlock _description = new()
    {
        FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        Foreground = DisplayTokens.TextSecondary,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, DescriptionTopMargin, 0, 0),
        Visibility = Visibility.Collapsed,
    };

    private readonly TextBlock _message = new()
    {
        FontSize = TypographyTokens.Size("TsTypeCaptionFontSize", 12),
        Foreground = DisplayTokens.TextMuted,
        TextWrapping = TextWrapping.Wrap,
        LineHeight = MessageLineHeight,
        Margin = new Thickness(0, MessageTopMargin, 0, 0),
    };

    private readonly ContentPresenter _actionHost = new()
    {
        Margin = new Thickness(0, ActionTopMargin, 0, 0),
        Visibility = Visibility.Collapsed,
    };

    private readonly StackPanel _column = new() { Orientation = Orientation.Vertical };

    private UIElement? _action;
    private bool _opened;
    private bool _disposed;

    /// <summary>
    /// Creates the surface with no inputs (the designer / parameterless host entry point): it renders the default
    /// count message for an empty, unlabeled section. Strings resolve through the passthrough facade; supply an
    /// explicit <see cref="ILocalizer"/> and a bound <see cref="IEmptyStateThresholdSource"/> via the other
    /// constructors to drive i18n and props from the composition root.
    /// </summary>
    public EmptyStateThreshold()
        : this(PassthroughLocalizer.Instance, new StaticEmptyStateThresholdSource(), diagnostics: null)
    {
    }

    /// <summary>Creates the surface over the i18n facade and a bound props seam (the production entry point).</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="source">The props state-holder seam (web component props).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EmptyStateThreshold(
        ILocalizer localizer,
        IEmptyStateThresholdSource source,
        EmptyStateThresholdDiagnostics? diagnostics = null)
        : this(new EmptyStateThresholdViewModel(localizer, source), diagnostics)
    {
    }

    /// <summary>Creates the surface over an explicit state holder (tests / headless hosts) and diagnostics.</summary>
    /// <param name="viewModel">The backing state holder.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EmptyStateThreshold(
        EmptyStateThresholdViewModel viewModel,
        EmptyStateThresholdDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(viewModel);

        _viewModel = viewModel;
        _diagnostics = diagnostics ?? new EmptyStateThresholdDiagnostics();
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalAlignment = HorizontalAlignment.Stretch;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _panel.CornerRadius = DisplayTokens.Radius("TsRadiusLg", 16);

        var titleRow = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = TitleGap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        titleRow.Children.Add(_title);
        titleRow.Children.Add(_infoIcon);

        _column.Children.Add(titleRow);
        _column.Children.Add(_description);
        _column.Children.Add(_message);
        _column.Children.Add(_actionHost);

        var grid = new Grid();
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _checkIcon.Margin = new Thickness(0, 0, IconGap, 0);
        Grid.SetColumn(_checkIcon, 0);
        Grid.SetColumn(_column, 1);
        grid.Children.Add(_checkIcon);
        grid.Children.Add(_column);

        _panel.Child = grid;
        Content = _panel;

        // web aria-hidden: the check + info glyphs are decorative; the status text carries the meaning.
        AutomationProperties.SetAccessibilityView(_checkIcon, AccessibilityView.Raw);
        AutomationProperties.SetAccessibilityView(_infoIcon, AccessibilityView.Raw);

        AutomationProperties.SetAutomationId(this, EmptyStateThresholdRegistration.RootAutomationId);

        // web role="status" aria-live="polite": announce composed text changes without moving focus.
        LiveRegion.Configure(_panel, assertive: false);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface slug (<c>EmptyStateThreshold</c>).</summary>
    public static string Slug => EmptyStateThresholdRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public EmptyStateThresholdViewModel ViewModel => _viewModel;

    /// <summary>The composed accessible status text the automation peer reports.</summary>
    internal string AccessibleName => _viewModel.AccessibleName;

    /// <summary>
    /// The optional call-to-action element rendered below the message (web <c>action</c>, e.g. an "Adjust filters"
    /// link). Setting a non-null element shows the action region; clearing it (null) collapses the region —
    /// mirroring the web <c>{action &amp;&amp; …}</c> guard.
    /// </summary>
    public UIElement? Action
    {
        get => _action;
        set
        {
            _action = value;
            _actionHost.Content = value;
            _actionHost.Visibility = value is null ? Visibility.Collapsed : Visibility.Visible;
        }
    }

    /// <inheritdoc />
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

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new EmptyStateThresholdAutomationPeer(this);

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mount: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        Marshal(Render);

    private void Render()
    {
        var display = _viewModel.Display;

        _title.Text = display.Title;

        _description.Text = display.Description;
        _description.Visibility = display.HasDescription ? Visibility.Visible : Visibility.Collapsed;

        _message.Text = display.Message;

        AutomationProperties.SetName(this, display.AccessibleName);
        LiveRegion.Announce(_panel);
    }

    private void Marshal(Action action)
    {
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(() => action());
        }
        else
        {
            action();
        }
    }

    private sealed class EmptyStateThresholdAutomationPeer : FrameworkElementAutomationPeer
    {
        public EmptyStateThresholdAutomationPeer(EmptyStateThreshold owner)
            : base(owner)
        {
        }

        private EmptyStateThreshold Surface => (EmptyStateThreshold)Owner;

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name) ? Surface.AccessibleName : name;
        }
    }
}

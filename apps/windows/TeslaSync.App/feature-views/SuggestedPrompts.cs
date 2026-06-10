using System.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Windows.Foundation;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Suggested Prompts surface — a parity port of
/// web/src/features/system/components/chatbot/SuggestedPrompts.tsx. It reproduces the web component's
/// empty-conversation chip strip: a centred, max-width wrap of compact pill chips — each a subtle
/// <see cref="TsButton"/> leading with a Sparkles glyph (the web Lucide <c>Sparkles</c> icon) and the localized
/// prompt text — that, when picked, raises <see cref="PromptPicked"/> with the prompt text so the host fills
/// (but does not auto-submit) its input, exactly as the web <c>onPick(text)</c> contract. The web component
/// consumes no asynchronous data — only <c>useTranslation</c> over the static <c>getChatSuggestions()</c> list
/// — so the surface has just the two honest states the catalog can yield: the populated chip strip
/// (<see cref="SuggestedPromptState.Ready"/>), or a friendly empty surface when no suggestions are available
/// (<see cref="SuggestedPromptState.Empty"/>, never a blank box). There is therefore no
/// loading / error / stale / offline branch — the web source has none, and inventing them would be drift. The
/// chips are projected by the UI-thread-free <see cref="SuggestedPromptsViewModel"/>; the view never performs
/// HTTP. Every string resolves through the i18n facade, the strip carries a Narrator landmark and every chip a
/// Narrator name, the layout uses platform tokens (no ported web Tailwind), and the surface adds no custom
/// motion so the reduced-motion / "show animations" system preference is honoured by construction and chip
/// text scales with the system text-scaling setting.
/// </summary>
public sealed partial class SuggestedPrompts : ContentControl, IDisposable
{
    // Web ul: "gap-2" (8px) between chips, "max-w-2xl" (42rem = 672px), "mx-auto" (centred).
    private const double Gap = 8;
    private const double MaxStripWidth = 672;

    private readonly SuggestedPromptsViewModel _viewModel;
    private readonly SuggestedPromptsDiagnostics _diagnostics;
    private readonly Grid _host = new();

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the surface over the localizer, an optional catalog and optional diagnostics.</summary>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="catalog">The suggestion catalog; <see langword="null"/> uses the four canonical suggestions.</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public SuggestedPrompts(
        ILocalizer localizer,
        IReadOnlyList<ChatSuggestion>? catalog = null,
        SuggestedPromptsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new SuggestedPromptsDiagnostics();
        _viewModel = new SuggestedPromptsViewModel(localizer, catalog);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        AutomationProperties.SetName(_host, _viewModel.RegionName);
        AutomationProperties.SetLandmarkType(_host, AutomationLandmarkType.Custom);
        AutomationProperties.SetLocalizedLandmarkType(_host, _viewModel.RegionName);
        Content = _host;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>
    /// Raised when a suggestion chip is picked, carrying the localized prompt text — the native analogue of the
    /// web <c>onPick(text)</c> callback. The host fills its input and focuses it but does not auto-submit, so
    /// the user can edit the prompt before sending.
    /// </summary>
    public event EventHandler<string>? PromptPicked;

    /// <summary>The canonical diagnostics slug this surface reports under (<c>SuggestedPrompts</c>).</summary>
    public static string Slug => SuggestedPromptsRegistration.Slug;

    /// <summary>
    /// Re-resolve every label from the localizer and re-render — call after the active language changes so the
    /// chips and accessibility copy update without reconstructing the surface (web react-i18next parity).
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
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        GC.SuppressFinalize(this);
    }

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
        if (e.PropertyName is not (null or nameof(SuggestedPromptsViewModel.Items)))
        {
            return;
        }

        AutomationProperties.SetName(_host, _viewModel.RegionName);
        AutomationProperties.SetLocalizedLandmarkType(_host, _viewModel.RegionName);
        Render();
    }

    private void Render()
    {
        _host.Children.Clear();
        _host.Children.Add(_viewModel.State == SuggestedPromptState.Empty ? BuildEmpty() : BuildChips());
    }

    private TsEmptyState BuildEmpty() => new()
    {
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private ChipWrapPanel BuildChips()
    {
        var strip = new ChipWrapPanel
        {
            HorizontalSpacing = Gap,
            VerticalSpacing = Gap,
            MaxWidth = MaxStripWidth,
            HorizontalAlignment = HorizontalAlignment.Center,
        };

        foreach (var item in _viewModel.Items)
        {
            strip.Children.Add(BuildChip(item));
        }

        return strip;
    }

    private TsButton BuildChip(SuggestedPromptItem item)
    {
        var chip = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = item.Glyph,
            Text = item.Text,
            CornerRadius = DisplayTokens.Radius("TsRadiusPill", 9999),
        };
        AutomationProperties.SetName(chip, item.AutomationName);
        ToolTipService.SetToolTip(chip, item.Text);

        string text = item.Text;
        chip.Click += (_, _) => PromptPicked?.Invoke(this, text);
        return chip;
    }

    /// <summary>
    /// A minimal flow panel that lays its children left to right and wraps to a new row when the next child
    /// would overflow the available width — the native equivalent of the web ul's <c>flex flex-wrap gap-2</c>.
    /// Base WinUI ships no wrap panel, so the surface carries its own (the same pattern the dashboard chip
    /// clusters and the CronParser preset row use).
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

            foreach (var child in Children)
            {
                child.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
                var desired = child.DesiredSize;

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

            foreach (var child in Children)
            {
                var desired = child.DesiredSize;
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
}

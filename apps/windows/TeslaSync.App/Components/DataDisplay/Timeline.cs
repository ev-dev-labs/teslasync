using System.Collections.Generic;
using System.Linq;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Microsoft.UI.Text;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// A single timeline row (mirrors the web <c>TimelineItem</c>): a severity-coloured
/// marker, a connector rail, a title, an optional detail line, and a relative time.
/// Tokenized; safe to render standalone or inside a <see cref="TsTimeline"/>.
/// </summary>
public sealed partial class TsTimelineItem : ContentControl
{
    /// <summary>The entry to render.</summary>
    public static readonly DependencyProperty EntryProperty = DependencyProperty.Register(
        nameof(Entry), typeof(TsActivityEntry), typeof(TsTimelineItem), new PropertyMetadata(null, OnChanged));

    /// <summary>When false, the trailing connector rail is hidden (last item).</summary>
    public static readonly DependencyProperty ShowConnectorProperty = DependencyProperty.Register(
        nameof(ShowConnector), typeof(bool), typeof(TsTimelineItem), new PropertyMetadata(true, OnChanged));

    /// <summary>Initialise the item.</summary>
    public TsTimelineItem()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The activity entry.</summary>
    public TsActivityEntry? Entry
    {
        get => (TsActivityEntry?)GetValue(EntryProperty);
        set => SetValue(EntryProperty, value);
    }

    /// <summary>Whether the trailing connector is shown.</summary>
    public bool ShowConnector
    {
        get => (bool)GetValue(ShowConnectorProperty);
        set => SetValue(ShowConnectorProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTimelineItem)d).Rebuild();

    private void Rebuild()
    {
        var entry = Entry;
        var tokens = SeverityLevels.TokensFor(entry?.Severity);
        var accent = DisplayTokens.Brush(tokens.AccentBrushKey);

        var marker = DisplayPrimitives.Column(0);
        marker.HorizontalAlignment = HorizontalAlignment.Center;
        marker.Children.Add(DisplayPrimitives.Dot(accent, 10));
        if (ShowConnector)
        {
            marker.Children.Add(new Rectangle
            {
                Width = 2,
                MinHeight = 24,
                Fill = DisplayTokens.Border,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Stretch,
            });
        }

        var body = DisplayPrimitives.Column(2);
        body.Children.Add(DisplayPrimitives.Value(entry?.Title ?? string.Empty, 14));
        if (!string.IsNullOrEmpty(entry?.Detail))
        {
            body.Children.Add(DisplayPrimitives.Label(entry!.Detail!));
        }

        body.Children.Add(DisplayPrimitives.Caption(
            DateTimeFormatting.Format(entry?.Timestamp, DateTimeVariant.Relative, DateTimeOffset.Now)));

        var row = DisplayPrimitives.Row(10);
        row.VerticalAlignment = VerticalAlignment.Top;
        row.Children.Add(marker);
        row.Children.Add(body);

        Content = row;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, entry?.Title ?? string.Empty);
    }
}

/// <summary>
/// Vertical event timeline (mirrors the web <c>Timeline</c>): a stacked set of
/// <see cref="TsTimelineItem"/>s with the connector suppressed on the last entry.
/// Renders an em-dash empty state when there are no entries.
/// </summary>
public sealed partial class TsTimeline : ContentControl
{
    /// <summary>The entries, newest first.</summary>
    public static readonly DependencyProperty ItemsProperty = DependencyProperty.Register(
        nameof(Items), typeof(IEnumerable<TsActivityEntry>), typeof(TsTimeline), new PropertyMetadata(null, OnChanged));

    /// <summary>Empty-state message when there are no entries.</summary>
    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsTimeline), new PropertyMetadata("No activity", OnChanged));

    /// <summary>Initialise the timeline.</summary>
    public TsTimeline()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The entries.</summary>
    public IEnumerable<TsActivityEntry>? Items
    {
        get => (IEnumerable<TsActivityEntry>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    /// <summary>The empty-state message.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTimeline)d).Rebuild();

    private void Rebuild()
    {
        var entries = (Items ?? Array.Empty<TsActivityEntry>()).ToList();
        if (entries.Count == 0)
        {
            Content = DisplayPrimitives.Caption(EmptyMessage);
            return;
        }

        var column = DisplayPrimitives.Column(0);
        for (int i = 0; i < entries.Count; i++)
        {
            column.Children.Add(new TsTimelineItem { Entry = entries[i], ShowConnector = i < entries.Count - 1 });
        }

        Content = column;
    }
}

/// <summary>
/// Compact recent-activity feed (mirrors the web <c>RecentActivityFeed</c>): like
/// <see cref="TsTimeline"/> but capped to the most recent <see cref="MaxItems"/>
/// entries, each a single dot + title + relative time line.
/// </summary>
public sealed partial class TsRecentActivityFeed : ContentControl
{
    /// <summary>The entries, newest first.</summary>
    public static readonly DependencyProperty ItemsProperty = DependencyProperty.Register(
        nameof(Items), typeof(IEnumerable<TsActivityEntry>), typeof(TsRecentActivityFeed), new PropertyMetadata(null, OnChanged));

    /// <summary>Maximum entries to show (default 5).</summary>
    public static readonly DependencyProperty MaxItemsProperty = DependencyProperty.Register(
        nameof(MaxItems), typeof(int), typeof(TsRecentActivityFeed), new PropertyMetadata(5, OnChanged));

    /// <summary>Empty-state message.</summary>
    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsRecentActivityFeed), new PropertyMetadata("No recent activity", OnChanged));

    /// <summary>Initialise the feed.</summary>
    public TsRecentActivityFeed()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The entries.</summary>
    public IEnumerable<TsActivityEntry>? Items
    {
        get => (IEnumerable<TsActivityEntry>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    /// <summary>Maximum entries to show.</summary>
    public int MaxItems
    {
        get => (int)GetValue(MaxItemsProperty);
        set => SetValue(MaxItemsProperty, value);
    }

    /// <summary>The empty-state message.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsRecentActivityFeed)d).Rebuild();

    private void Rebuild()
    {
        var entries = (Items ?? Array.Empty<TsActivityEntry>()).Take(Math.Max(0, MaxItems)).ToList();
        if (entries.Count == 0)
        {
            Content = DisplayPrimitives.Caption(EmptyMessage);
            return;
        }

        var column = DisplayPrimitives.Column(8);
        foreach (var entry in entries)
        {
            var tokens = SeverityLevels.TokensFor(entry.Severity);
            var row = DisplayPrimitives.Row(8);
            row.Children.Add(DisplayPrimitives.Dot(DisplayTokens.Brush(tokens.AccentBrushKey), 8));
            row.Children.Add(DisplayPrimitives.Label(entry.Title));
            var time = DisplayPrimitives.Caption(
                DateTimeFormatting.Format(entry.Timestamp, DateTimeVariant.Relative, DateTimeOffset.Now));
            row.Children.Add(time);
            column.Children.Add(row);
        }

        Content = column;
    }
}

/// <summary>
/// Date-grouped list (mirrors the web <c>DateGroupedList</c>): buckets entries under
/// "Today" / "Yesterday" / absolute-date headers, newest group first.
/// </summary>
public sealed partial class TsDateGroupedList : ContentControl
{
    /// <summary>The entries to group.</summary>
    public static readonly DependencyProperty ItemsProperty = DependencyProperty.Register(
        nameof(Items), typeof(IEnumerable<TsActivityEntry>), typeof(TsDateGroupedList), new PropertyMetadata(null, OnChanged));

    /// <summary>Empty-state message.</summary>
    public static readonly DependencyProperty EmptyMessageProperty = DependencyProperty.Register(
        nameof(EmptyMessage), typeof(string), typeof(TsDateGroupedList), new PropertyMetadata("No entries", OnChanged));

    /// <summary>Initialise the list.</summary>
    public TsDateGroupedList()
    {
        IsTabStop = false;
        Rebuild();
    }

    /// <summary>The entries.</summary>
    public IEnumerable<TsActivityEntry>? Items
    {
        get => (IEnumerable<TsActivityEntry>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    /// <summary>The empty-state message.</summary>
    public string EmptyMessage
    {
        get => (string)GetValue(EmptyMessageProperty);
        set => SetValue(EmptyMessageProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsDateGroupedList)d).Rebuild();

    private static string GroupLabel(DateTimeOffset? ts, DateTimeOffset now)
    {
        if (ts is not { } t)
        {
            return "Unknown";
        }

        DateTime day = t.LocalDateTime.Date;
        DateTime today = now.LocalDateTime.Date;
        if (day == today)
        {
            return "Today";
        }

        if (day == today.AddDays(-1))
        {
            return "Yesterday";
        }

        return DateTimeFormatting.Format(t, DateTimeVariant.Date, now);
    }

    private void Rebuild()
    {
        var entries = (Items ?? Array.Empty<TsActivityEntry>()).ToList();
        if (entries.Count == 0)
        {
            Content = DisplayPrimitives.Caption(EmptyMessage);
            return;
        }

        var now = DateTimeOffset.Now;
        var groups = entries
            .OrderByDescending(e => e.Timestamp ?? DateTimeOffset.MinValue)
            .GroupBy(e => GroupLabel(e.Timestamp, now));

        var column = DisplayPrimitives.Column(16);
        foreach (var group in groups)
        {
            var section = DisplayPrimitives.Column(8);
            var header = DisplayPrimitives.Caption(group.Key);
            header.FontWeight = FontWeights.SemiBold;
            header.Foreground = DisplayTokens.TextSecondary;
            section.Children.Add(header);

            foreach (var entry in group)
            {
                var tokens = SeverityLevels.TokensFor(entry.Severity);
                var row = DisplayPrimitives.Row(8);
                row.Children.Add(DisplayPrimitives.Dot(DisplayTokens.Brush(tokens.AccentBrushKey), 8));
                row.Children.Add(DisplayPrimitives.Label(entry.Title));
                row.Children.Add(DisplayPrimitives.Caption(
                    DateTimeFormatting.Format(entry.Timestamp, DateTimeVariant.Time, now)));
                section.Children.Add(row);
            }

            column.Children.Add(section);
        }

        Content = column;
    }
}

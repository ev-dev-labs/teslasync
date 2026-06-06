using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Core.Navigation;

namespace TeslaSync.App.Shell;

/// <summary>
/// The content surface the shell shows for a resolved route whose page module has
/// not yet been generated (W7 owns the page bodies). It is intentionally <b>not</b> a
/// fake page: it renders the live result of the routing layer — the resolved title,
/// path, group, extracted parameters, auth requirement, shell mode and the route's
/// canonical deep link — so the navigation shell is fully demonstrable on its own and
/// the W7 hand-off target is unambiguous. When a real page factory is registered for
/// the route this view is never constructed.
/// </summary>
internal sealed partial class RoutePendingView : UserControl
{
    /// <summary>The scroll host, exposed so the shell can save/restore scroll position.</summary>
    public ScrollViewer ScrollHost { get; }

    public RoutePendingView(RouteMatch match)
    {
        var route = match.Route;
        var title = Localization.Title(route);

        var heading = new TextBlock
        {
            Text = title,
            Style = TryStyle("TitleTextBlockStyle"),
        };

        var glyph = new FontIcon
        {
            Glyph = route.Glyph,
            FontSize = 28,
            Margin = new Thickness(0, 0, 0, 4),
        };

        var lead = new TextBlock
        {
            Text = Localization.Get(
                "shell.routePending.lead",
                "The navigation shell resolved this route. Its page module is delivered by a later build stage (W7)."),
            TextWrapping = TextWrapping.Wrap,
            Opacity = 0.75,
            Margin = new Thickness(0, 0, 0, 16),
            MaxWidth = 560,
        };

        var details = new Grid
        {
            ColumnSpacing = 16,
            RowSpacing = 8,
            HorizontalAlignment = HorizontalAlignment.Left,
        };
        details.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        details.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        AddDetail(details, Localization.Get("shell.routePending.name", "Route"), route.Name);
        AddDetail(details, Localization.Get("shell.routePending.path", "Path"), "/" + match.MatchedPath);
        AddDetail(details, Localization.Get("shell.routePending.group", "Group"), GroupLabel(route.Group));
        if (match.Parameters.Count > 0)
        {
            AddDetail(
                details,
                Localization.Get("shell.routePending.params", "Parameters"),
                string.Join(", ", match.Parameters.Select(p => $"{p.Key} = {p.Value}")));
        }

        AddDetail(
            details,
            Localization.Get("shell.routePending.auth", "Auth required"),
            route.AuthRequired ? "yes" : "no");
        AddDetail(
            details,
            Localization.Get("shell.routePending.shellMode", "Shell mode"),
            route.ShellMode.ToString());
        AddDetail(
            details,
            Localization.Get("shell.routePending.deepLink", "Deep link"),
            DeepLinkFor(match));

        var panel = new StackPanel
        {
            Spacing = 4,
            Padding = new Thickness(32),
            VerticalAlignment = VerticalAlignment.Top,
            HorizontalAlignment = HorizontalAlignment.Left,
            Children = { glyph, heading, lead, details },
        };

        Content = new ScrollViewer
        {
            Content = panel,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        };
        ScrollHost = (ScrollViewer)Content;
    }

    private static string DeepLinkFor(RouteMatch match)
    {
        try
        {
            return match.Route.IsParameterized
                ? DeepLink.BuildUri(match.Route, match.Parameters).ToString()
                : DeepLink.BuildUri(match.MatchedPath).ToString();
        }
        catch (ArgumentException)
        {
            return DeepLink.BuildUri(match.MatchedPath).ToString();
        }
    }

    private static string GroupLabel(RouteGroup group) =>
        group == RouteGroup.None ? "—" : Localization.GroupTitle(RouteGroups.Info(group));

    private static void AddDetail(Grid grid, string label, string value)
    {
        int row = grid.RowDefinitions.Count;
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        var key = new TextBlock { Text = label, Opacity = 0.6 };
        Grid.SetRow(key, row);
        Grid.SetColumn(key, 0);

        var val = new TextBlock
        {
            Text = value,
            FontFamily = new FontFamily("Consolas"),
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = 480,
        };
        Grid.SetRow(val, row);
        Grid.SetColumn(val, 1);

        grid.Children.Add(key);
        grid.Children.Add(val);
    }

    private static Style? TryStyle(string key) =>
        Application.Current.Resources.TryGetValue(key, out var s) ? s as Style : null;
}

namespace TeslaSync.App.Core.Notifications;

/// <summary>
/// One entry in the Windows jump list (P2/W8-0001): a localized task that deep-links to a real W3
/// route. <see cref="Arguments"/> is a <c>teslasync://app/&lt;path&gt;</c> activation URI that the
/// launch-activation handler resolves back to the route, so a jump-list task always opens a valid page.
/// </summary>
public sealed record JumpListEntry(
    string RouteName,
    string Label,
    string Glyph,
    string Arguments,
    string GroupLabel);

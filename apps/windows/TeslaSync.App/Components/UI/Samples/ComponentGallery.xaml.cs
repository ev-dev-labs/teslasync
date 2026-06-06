using System.Collections.Generic;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI.Samples;

/// <summary>
/// Code-behind for the build-time component gallery. Seeds the data table and
/// command palette with representative data so their interactive states (sorting,
/// selection, expansion, paging, filtering) are exercised at runtime, and wires the
/// palette open button. This is sample/demo scaffolding, not production UI.
/// </summary>
public sealed partial class ComponentGallery : UserControl
{
    public ComponentGallery()
    {
        InitializeComponent();
        SeedTable();
        SeedPalette();
        OpenPaletteButton.Click += (s, e) => Palette.IsOpen = true;
    }

    private void SeedTable()
    {
        Table.Columns =
        [
            new TsDataColumn { Key = "name", Header = "Name" },
            new TsDataColumn { Key = "status", Header = "Status" },
            new TsDataColumn { Key = "range", Header = "Range", IsNumeric = true },
        ];

        var rows = new List<TsDataRow>();
        for (var i = 1; i <= 12; i++)
        {
            var values = new Dictionary<string, object?>
            {
                ["name"] = $"Vehicle {i}",
                ["status"] = i % 2 == 0 ? "Charging" : "Idle",
                ["range"] = 200 + (i * 7),
            };
            rows.Add(new TsDataRow(i, values, new TextBlock { Text = $"Details for vehicle {i}" }));
        }

        Table.Rows = rows;
    }

    private void SeedPalette()
    {
        Palette.Commands =
        [
            new CommandItem("dashboard", "Open dashboard", "Go to overview"),
            new CommandItem("vehicles", "List vehicles", "All linked cars"),
            new CommandItem("charging", "Charging history", Keywords: ["energy", "kwh"]),
            new CommandItem("settings", "Settings", "Preferences"),
        ];
    }
}

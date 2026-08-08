package geocoding

import (
	"strings"
	"testing"
)

func TestGeoResultShortName(t *testing.T) {
	longName := strings.Repeat("x", 80)

	tests := []struct {
		name   string
		result GeoResult
		want   string
	}{
		// ── specificity order ────────────────────────────────────────────────
		{
			"poi name wins over road",
			GeoResult{Name: "Costco Wholesale", Road: "Bothell Everett Hwy", City: "Mill Creek"},
			"Costco Wholesale, Mill Creek",
		},
		{
			"poi name stands alone without a locality",
			GeoResult{Name: "Costco Wholesale"},
			"Costco Wholesale",
		},
		{
			"poi name is not repeated when it equals the locality",
			GeoResult{Name: "Springfield", City: "Springfield"},
			"Springfield",
		},
		{
			"house number is included with the road",
			GeoResult{HouseNumber: "19205", Road: "Bothell Everett Hwy", City: "Bothell"},
			"19205 Bothell Everett Hwy, Bothell",
		},
		{
			"suburb is preferred over city as the qualifier",
			GeoResult{Road: "Main St", Suburb: "Kenmore", City: "Springfield"},
			"Main St, Kenmore",
		},

		// ── historical behaviour that must not regress ────────────────────────
		{"road and city", GeoResult{Road: "Main St", City: "Springfield"}, "Main St, Springfield"},
		{"city only", GeoResult{City: "Springfield"}, "Springfield"},
		{
			"road without a locality falls back to display name",
			GeoResult{Road: "Main St", DisplayName: "Fallback"},
			"Fallback",
		},
		{
			"bare road is used only when there is no display name",
			GeoResult{Road: "Main St"},
			"Main St",
		},
		{"short display name", GeoResult{DisplayName: "Just A Place"}, "Just A Place"},
		{"long display name is truncated", GeoResult{DisplayName: longName}, longName[:60] + "..."},
		{"all empty", GeoResult{}, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := tt.result
			if got := r.ShortName(); got != tt.want {
				t.Errorf("ShortName() = %q, want %q", got, tt.want)
			}
		})
	}
}

// TestShortName_EndpointsOnSameRoadStayDistinct is the regression guard for the
// drive-detail bug where Journey Details rendered Start and Destination as the
// same string. Both ends of a commute sit on one highway, so a "Road, City"
// label collapsed them; the house number is what keeps them apart.
func TestShortName_EndpointsOnSameRoadStayDistinct(t *testing.T) {
	road, city := "Bothell Everett Hwy", "Bothell"

	start := GeoResult{HouseNumber: "19205", Road: road, City: city}
	end := GeoResult{HouseNumber: "13023", Road: road, City: city}

	gotStart, gotEnd := start.ShortName(), end.ShortName()
	if gotStart == gotEnd {
		t.Fatalf("start and destination collapsed to the same label: %q", gotStart)
	}
	if gotStart != "19205 Bothell Everett Hwy, Bothell" {
		t.Errorf("start = %q", gotStart)
	}
	if gotEnd != "13023 Bothell Everett Hwy, Bothell" {
		t.Errorf("end = %q", gotEnd)
	}
}

func TestNominatimToGeoResult(t *testing.T) {
	tests := []struct {
		name string
		raw  NominatimResult
		want GeoResult
	}{
		{
			"full address with house number",
			NominatimResult{
				DisplayName: "19205 Bothell Everett Hwy, Bothell, WA, USA",
				Address: NominatimAddress{
					HouseNumber: "19205",
					Road:        "Bothell Everett Hwy",
					City:        "Bothell",
					State:       "Washington",
					Country:     "United States",
					PostCode:    "98012",
				},
			},
			GeoResult{
				DisplayName: "19205 Bothell Everett Hwy, Bothell, WA, USA",
				HouseNumber: "19205",
				Road:        "Bothell Everett Hwy",
				City:        "Bothell",
				State:       "Washington",
				Country:     "United States",
				PostCode:    "98012",
			},
		},
		{
			"top-level name is carried as the poi label",
			NominatimResult{Name: "Costco Wholesale", Address: NominatimAddress{City: "Mill Creek"}},
			GeoResult{Name: "Costco Wholesale", City: "Mill Creek"},
		},
		{
			"amenity is used when no top-level name is present",
			NominatimResult{Address: NominatimAddress{Amenity: "Supercharger", City: "Bothell"}},
			GeoResult{Name: "Supercharger", City: "Bothell"},
		},
		{
			"shop falls in behind amenity",
			NominatimResult{Address: NominatimAddress{Shop: "Trader Joe's", City: "Bothell"}},
			GeoResult{Name: "Trader Joe's", City: "Bothell"},
		},
		{
			"neighbourhood is preferred over suburb",
			NominatimResult{Address: NominatimAddress{Neighbourhood: "Canyon Park", Suburb: "North Creek"}},
			GeoResult{Suburb: "Canyon Park"},
		},
		{
			"suburb is used when no neighbourhood is present",
			NominatimResult{Address: NominatimAddress{Suburb: "North Creek"}},
			GeoResult{Suburb: "North Creek"},
		},
		{
			"town fills in for a missing city",
			NominatimResult{Address: NominatimAddress{Town: "Shelbyville"}},
			GeoResult{City: "Shelbyville"},
		},
		{
			"village fills in for a missing city and town",
			NominatimResult{Address: NominatimAddress{Village: "Smallville"}},
			GeoResult{City: "Smallville"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.raw.toGeoResult()
			if *got != tt.want {
				t.Errorf("toGeoResult() = %+v, want %+v", *got, tt.want)
			}
		})
	}
}

// TestNominatimToGeoResult_PreservesDisplayName pins that the conversion no
// longer rewrites DisplayName. It used to be overwritten with a synthesised
// "house road, city" string, which destroyed the provider's own formatted
// address before it could be used as the ShortName fallback.
func TestNominatimToGeoResult_PreservesDisplayName(t *testing.T) {
	raw := NominatimResult{
		DisplayName: "19205 Bothell Everett Hwy, Bothell, WA 98012, United States",
		Address: NominatimAddress{
			HouseNumber: "19205",
			Road:        "Bothell Everett Hwy",
			City:        "Bothell",
		},
	}
	if got := raw.toGeoResult().DisplayName; got != raw.DisplayName {
		t.Errorf("DisplayName = %q, want it preserved as %q", got, raw.DisplayName)
	}
}

func TestParseGoogleResult(t *testing.T) {
	r := googleResult{
		FormattedAddress: "19205 Bothell Everett Hwy, Bothell, WA 98012, USA",
		AddressComponents: []googleAddressComponent{
			{LongName: "19205", Types: []string{"street_number"}},
			{LongName: "Bothell Everett Highway", Types: []string{"route"}},
			{LongName: "Canyon Park", Types: []string{"neighborhood", "political"}},
			{LongName: "Bothell", Types: []string{"locality", "political"}},
			{LongName: "Washington", Types: []string{"administrative_area_level_1"}},
			{LongName: "United States", Types: []string{"country"}},
			{LongName: "98012", Types: []string{"postal_code"}},
		},
	}

	got := parseGoogleResult(&r)

	if got.HouseNumber != "19205" {
		t.Errorf("HouseNumber = %q, want %q", got.HouseNumber, "19205")
	}
	if got.Road != "Bothell Everett Highway" {
		t.Errorf("Road = %q", got.Road)
	}
	if got.Suburb != "Canyon Park" {
		t.Errorf("Suburb = %q", got.Suburb)
	}
	if got.City != "Bothell" {
		t.Errorf("City = %q", got.City)
	}
	// Suburb outranks city as the qualifier, and the street number is what
	// makes two addresses on this highway distinguishable.
	if want := "19205 Bothell Everett Highway, Canyon Park"; got.ShortName() != want {
		t.Errorf("ShortName() = %q, want %q", got.ShortName(), want)
	}
}

func TestGooglePOIName(t *testing.T) {
	tests := []struct {
		name    string
		results []googleResult
		want    string
	}{
		{
			"point of interest is found in a later result",
			[]googleResult{
				{AddressComponents: []googleAddressComponent{
					{LongName: "19205", Types: []string{"street_number"}},
				}},
				{AddressComponents: []googleAddressComponent{
					{LongName: "Costco Wholesale", Types: []string{"point_of_interest", "establishment"}},
				}},
			},
			"Costco Wholesale",
		},
		{
			"premise counts as a named place",
			[]googleResult{{AddressComponents: []googleAddressComponent{
				{LongName: "Canyon Park Plaza", Types: []string{"premise"}},
			}}},
			"Canyon Park Plaza",
		},
		{
			"street addresses yield no name",
			[]googleResult{{AddressComponents: []googleAddressComponent{
				{LongName: "Bothell", Types: []string{"locality", "political"}},
			}}},
			"",
		},
		{"no results", nil, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := googlePOIName(tt.results); got != tt.want {
				t.Errorf("googlePOIName() = %q, want %q", got, tt.want)
			}
		})
	}
}

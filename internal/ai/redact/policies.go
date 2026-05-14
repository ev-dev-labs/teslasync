package redact

// PolicyChatbot is the policy for the LLM chatbot strategy (Phase-50
// slice U1). Allows nothing — the chatbot MUST use round-trip tokens
// for every PII reference. The user sees their own VIN restored via
// [Restore]; the provider only ever sees `<vin id='1'/>`.
func PolicyChatbot() Policy {
	return Policy{
		Allow: nil,
		Mode:  ModeRedactedTags,
	}
}

// PolicyDigest is the policy for the LLM-narrated weekly digest (slice
// U2). Allows ClassVehicleName because the digest's value proposition
// includes naming the user's car ("This week, Roadie drove 142 mi").
// Every other class is still redacted.
func PolicyDigest() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

// PolicyYearInReview is the policy for the LLM-narrated year-in-review
// slides (slice U3, prompt 0013). Allows ClassVehicleName so the
// narration can address the user's car by name across the slide deck
// ("This year, Roadie covered 12,500 km"). Every other PII class
// — VIN, lat/long, addresses, etc. — is redacted to a round-trip
// tag (`<vin id='1'/>`) and restored by the F8 redact decorator
// before the response reaches the user.
//
// Mirrors PolicyDigest's allow-list intentionally: both narrators
// share the same value proposition (name the car, never expose
// trips/locations) and a future change to one frequently warrants
// the same change to the other. They are kept as DISTINCT policy
// constructors (rather than aliasing) so per-slice allow-list
// drift can happen without cross-slice collateral damage.
func PolicyYearInReview() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

// PolicyAlertBuilder is the policy for the NL alert builder (slice
// N1). Allows nothing — alert IDs and selectors flow through the F4
// tool registry, not through prose. The LLM sees redacted text and
// proposes a typed AlertRule DTO; restoration happens server-side
// before persistence.
func PolicyAlertBuilder() Policy {
	return Policy{
		Allow: nil,
		Mode:  ModeRedactedTags,
	}
}

// PolicyAutomationBuilder mirrors PolicyAlertBuilder for slice N2.
// Defined explicitly so each slice's policy lives in one named place
// rather than aliased to another slice's policy (so a future per-slice
// change does not require touching the wrong identifier).
func PolicyAutomationBuilder() Policy {
	return Policy{
		Allow: nil,
		Mode:  ModeRedactedTags,
	}
}

// PolicyDriveCoaching is the policy for per-drive coaching narratives
// (slice N4). Allows ClassVehicleName so the coach can address the
// car by name. Lat/long stays redacted — the coach narrates trends,
// not exact coordinates.
func PolicyDriveCoaching() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

// PolicyChargingDiagnosis is the policy for the per-session charging
// diagnosis narrative (slice N5, prompt 0019). Allows ClassVehicleName
// so the diagnosis can address the user's car by name when it
// explains a specific session ("Roadie's home AC session ran for
// 7h 12m at 1.6 kW — that's a trickle charge"). Charging location
// names — including the `start_place` text the user-facing UI
// renders as a location chip — stay redacted by default per the
// slice prompt's ADR-015 §I9 commitment ("charging location names
// remain tagged by default"); the diagnosis narrates flag patterns,
// not exact addresses or station names.
//
// Mirrors PolicyDigest / PolicyYearInReview / PolicyDriveCoaching's
// allow-list intentionally: every per-feature narrator that names
// the user's car shares the same allow-list shape. They are kept as
// DISTINCT policy constructors (rather than aliasing) so per-slice
// allow-list drift can happen without cross-slice collateral damage.
func PolicyChargingDiagnosis() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

// PolicySpeedProfileInsights is the policy for the per-drive speed
// profile insights narrative (slice D2, prompt 0022). Allows
// ClassVehicleName so the insights can address the user's car by
// name when it discusses the drive's speed regime ("Roadie spent
// most of this drive at highway speeds"). Precise route coordinates
// — lat/long pairs, full street addresses — stay redacted by
// default per the slice prompt's ADR-015 §I9 commitment ("precise
// route coordinates remain tagged"); the insights narrate the
// drive's bucket distribution and energy efficiency, not exact
// route geometry or stop addresses.
//
// Mirrors PolicyDigest / PolicyYearInReview / PolicyDriveCoaching /
// PolicyChargingDiagnosis's allow-list intentionally: every
// per-feature narrator that names the user's car shares the same
// allow-list shape. They are kept as DISTINCT policy constructors
// (rather than aliasing) so per-slice allow-list drift can happen
// without cross-slice collateral damage — a future change to drive
// coaching's allow-list does not bleed across to speed-profile
// insights.
func PolicySpeedProfileInsights() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

// PolicyRouteEfficiencySuggestions is the policy for the
// route-efficiency suggestions narrative (slice D3, prompt 0023).
// Allows ClassVehicleName so the suggestions can address the user's
// car by name when it discusses route-level habits ("Roadie's home
// → work commute averages 165 Wh/km"). Place names and street
// addresses — which are the natural identifier of a "route" — flow
// through the F8 redactor as round-trip ClassStreetAddr tags: the
// provider sees `<addr id='1'/> → <addr id='2'/>`, and the
// addresses are restored only in the final SSE frame returned to
// the same authenticated user who issued the request. This keeps
// the provider transcript free of personally identifying location
// strings while preserving the user-facing narration ("From your
// usual Home → Work commute…"). Lat/long pairs are likewise tagged
// (ClassLatLong) and never exposed in cleartext to the provider.
//
// Mirrors PolicyDigest / PolicyYearInReview / PolicyDriveCoaching /
// PolicyChargingDiagnosis / PolicySpeedProfileInsights's allow-list
// intentionally: every per-feature narrator that names the user's
// car shares the same allow-list shape. They are kept as DISTINCT
// policy constructors (rather than aliasing) so per-slice
// allow-list drift can happen without cross-slice collateral damage
// — a future change to charging diagnosis's allow-list does not
// bleed across to route-efficiency suggestions.
//
// Slice prompt mandate (verbatim): "Allowed classes: ClassVehicleName
// only; locations are tagged and restored only to same user.
// Round-trip required: yes."
func PolicyRouteEfficiencySuggestions() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

// PolicyAutoTripNaming is the policy for the per-trip auto-naming
// narrative (slice D4, prompt 0024). Allows ClassVehicleName so the
// suggestion can address the user's car by name when the proposed
// name reasonably includes a vehicle reference (e.g. "Roadie's
// October Road Trip" — only the vehicle's display name is allowed
// through; place names are still tagged). Precise route coordinates
// — lat/long pairs, street addresses, place names that the trip
// happens to traverse — stay redacted by default: the proposed
// trip name is meant to surface a concise human label like "Weekend
// Road Trip — October 2024", NOT a turn-by-turn dossier ("Trip
// through 4123 Oak St"). Per the slice prompt's ADR-015 §I9
// commitment, the redaction policy allow-list mirrors
// PolicyDigest's so a future change to one does not silently bleed
// into the other.
//
// Mirrors PolicyDigest / PolicyYearInReview / PolicyDriveCoaching /
// PolicyChargingDiagnosis / PolicySpeedProfileInsights /
// PolicyRouteEfficiencySuggestions's allow-list intentionally: every
// per-feature narrator that names the user's car shares the same
// allow-list shape. They are kept as DISTINCT policy constructors
// (rather than aliasing) so per-slice allow-list drift can happen
// without cross-slice collateral damage — a future change to
// charging diagnosis's allow-list does not bleed across to
// auto-trip-naming.
//
// Slice prompt mandate (verbatim): "Allowed classes: ClassVehicleName
// only; places stay tagged unless restored to same user.
// Round-trip required: yes."
func PolicyAutoTripNaming() Policy {
	return Policy{
		Allow: []PIIClass{ClassVehicleName},
		Mode:  ModeRedactedTags,
	}
}

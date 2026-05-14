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

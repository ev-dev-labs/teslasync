package signal

// PrivacyClass is the sensitivity class stamped on every raw_signal and
// canonical_signal row (the SMALLINT privacy_class column in migrations
// 000214/000215). It is sourced verbatim from the SignalDescriptor
// (ADR-0331 / ADR-0094) so retention, redaction, and DSAR crypto-erasure
// tooling can scope behaviour off the row directly without re-deriving
// sensitivity from provider_kind / canonical_kind.
//
// The taxonomy program owns the descriptor field; telemetry only consumes it
// (ADR-0094). The build-time descriptor validator rejects the unspecified
// class, so PrivacyClassUnspecified (the zero value) must never reach a
// persisted row.
type PrivacyClass int16

const (
	// PrivacyClassUnspecified is the zero value and is never persistable — the
	// descriptor validator rejects PRIVACY_CLASS_UNSPECIFIED (ADR-0094).
	PrivacyClassUnspecified PrivacyClass = iota
	PrivacyClassPublic
	PrivacyClassInternal
	PrivacyClassConfidential
	PrivacyClassRestricted
	PrivacyClassHighlyRestricted
)

// Valid reports whether c is a stampable sensitivity class (anything other
// than the unspecified zero value).
func (c PrivacyClass) Valid() bool {
	switch c {
	case PrivacyClassPublic,
		PrivacyClassInternal,
		PrivacyClassConfidential,
		PrivacyClassRestricted,
		PrivacyClassHighlyRestricted:
		return true
	}
	return false
}

// CrossesTrustBoundaryRaw reports whether a reading of this class may leave a
// trust boundary un-redacted. Restricted-and-above telemetry never crosses a
// boundary raw (ADR-0094 §3); the Phase-7 redaction processor must act on it.
func (c PrivacyClass) CrossesTrustBoundaryRaw() bool {
	return c == PrivacyClassPublic ||
		c == PrivacyClassInternal ||
		c == PrivacyClassConfidential
}

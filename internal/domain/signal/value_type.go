package signal

// ValueType is the storage-layer value discriminator carried by both
// raw_signal.value_type and canonical_signal.value_type (SMALLINT in
// migrations 000214/000215). It tells a reader how to interpret a row's value:
// for raw rows, how to parse the opaque raw_value TEXT; for canonical rows,
// which typed column (num_value / str_value / bool_value) is populated.
//
// The integer values mirror internal/tesla/protomodel.ValueKind exactly so the
// SMALLINT on disk agrees with the codec's classification and with
// signal_log.value_kind (000186). It is re-declared here as a pure-domain type
// rather than imported so the repository port stays framework- and
// vendor-free (H31): the Phase-5 adapter maps protomodel.ValueKind to this
// domain type at the persistence boundary, not inside the port contract.
type ValueType int16

const (
	// ValueTypeUnknown is the zero value; a production row must never carry it.
	ValueTypeUnknown ValueType = iota
	ValueTypeString
	ValueTypeBool
	ValueTypeInt32
	ValueTypeInt64
	ValueTypeFloat
	ValueTypeDouble
	ValueTypeEnum
	ValueTypeCompound
	ValueTypeTime
	// ValueTypeInvalid marks a producer-flagged untrustworthy sample; decoders
	// drop these rather than persist a substituted default.
	ValueTypeInvalid
)

// IsNumeric reports whether the value flavour collapses to canonical_signal's
// num_value column (the SI-canonical DOUBLE PRECISION, H13). Int/float/double
// and enum readings are all stored numerically.
func (t ValueType) IsNumeric() bool {
	switch t {
	case ValueTypeInt32, ValueTypeInt64, ValueTypeFloat, ValueTypeDouble, ValueTypeEnum:
		return true
	}
	return false
}

// IsString reports whether the value is stored in str_value.
func (t ValueType) IsString() bool { return t == ValueTypeString }

// IsBool reports whether the value is stored in bool_value.
func (t ValueType) IsBool() bool { return t == ValueTypeBool }

// Valid reports whether t is a persistable discriminator — i.e. a known kind
// that is neither the uninitialised zero value nor an explicitly-invalid
// sample.
func (t ValueType) Valid() bool {
	switch t {
	case ValueTypeString,
		ValueTypeBool,
		ValueTypeInt32,
		ValueTypeInt64,
		ValueTypeFloat,
		ValueTypeDouble,
		ValueTypeEnum,
		ValueTypeCompound,
		ValueTypeTime:
		return true
	}
	return false
}

package queries

// Signal store SQL — the Contract C two-layer signal store (ADR-0091).
//
// raw_signal (migration 000214) is the append-only, provider-native system of
// record. The only write verb is an append; there is no UPDATE or DELETE
// statement here by design (H17 append-only). A correction is expressed as a
// NEW row with a later observed_at for the same (vehicle_id, provider_kind),
// never an in-place edit.

// AppendRawSignal appends one provider-native reading to raw_signal.
//
// Idempotency (H24): the composite primary key
// (vehicle_id, observed_at, provider_kind) plus ON CONFLICT ... DO NOTHING
// makes an at-least-once redelivery a no-op — a duplicate collapses onto the
// row already on disk instead of erroring or double-writing. DO NOTHING (never
// DO UPDATE) is what keeps the layer append-only (H17): an existing row is
// never mutated, so raw_value / created_at on a persisted row are immutable.
//
// raw_value is bound verbatim as the opaque provider-native TEXT (H13); the
// adapter performs no parse-to-number that would imply an SI normalization.
// created_at is intentionally omitted from the column list so the table's
// DEFAULT now() stamps the server-side ingest time.
//
// $1 vehicle_id (BIGINT), $2 observed_at (TIMESTAMPTZ), $3 provider_kind (TEXT),
// $4 value_type (SMALLINT), $5 raw_value (TEXT), $6 brand (TEXT),
// $7 privacy_class (SMALLINT).
const AppendRawSignal = `
	INSERT INTO raw_signal (
		vehicle_id, observed_at, provider_kind, value_type, raw_value, brand, privacy_class
	) VALUES ($1, $2, $3, $4, $5, $6, $7)
	ON CONFLICT (vehicle_id, observed_at, provider_kind) DO NOTHING`

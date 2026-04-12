package queries

// FSM history SQL queries.
const (
	InsertFSMTransition = `
		INSERT INTO fsm_transitions (id, entity_id, fsm_name, from_state, event, to_state, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`

	GetFSMHistory = `
		SELECT id, entity_id, fsm_name, from_state, event, to_state, created_at
		FROM fsm_transitions
		WHERE entity_id = $1
		ORDER BY created_at DESC
		LIMIT $2`

	GetFSMHistoryByEntityID = `
		SELECT id, entity_id, fsm_name, from_state, event, to_state, created_at
		FROM fsm_transitions
		WHERE entity_id = $1
		ORDER BY created_at ASC`
)

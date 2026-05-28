package database

import "fmt"

// buildPartialUpdate constructs a parameterised UPDATE statement from the
// provided fields, filtering through the allowed map. Only keys present in
// both fields and allowed are included in the SET clause. The id is appended
// as the final positional argument.
//
// Returns an empty query and nil args when no allowed fields are present,
// signalling the caller that no update is needed.
func buildPartialUpdate(table string, id int64, fields map[string]interface{}, allowed map[string]string) (string, []interface{}) {
	return BuildPartialUpdate(table, id, fields, allowed)
}

// BuildPartialUpdate is the exported entry point for sibling subpackages
// (e.g. internal/database/charging) that need the same partial-UPDATE
// builder logic. The unexported buildPartialUpdate alias is retained for
// the legacy in-package call sites still in this directory.
func BuildPartialUpdate(table string, id int64, fields map[string]interface{}, allowed map[string]string) (string, []interface{}) {
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1
	for jsonKey, col := range allowed {
		if val, ok := fields[jsonKey]; ok {
			setClauses = append(setClauses, fmt.Sprintf("%s=$%d", col, argIdx))
			args = append(args, val)
			argIdx++
		}
	}
	if len(setClauses) == 0 {
		return "", nil
	}

	query := fmt.Sprintf("UPDATE %s SET ", table)
	for i, c := range setClauses {
		if i > 0 {
			query += ", "
		}
		query += c
	}
	query += fmt.Sprintf(" WHERE id=$%d", argIdx)
	args = append(args, id)

	return query, args
}

// ptrStr safely dereferences a *string, returning "" if nil.
func ptrStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ptrFloat safely dereferences a *float64, returning 0 if nil.
func ptrFloat(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

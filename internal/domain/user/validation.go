package user

import (
	"regexp"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

func (u *User) Validate() error {
	var errs domain.ValidationErrors

	if u.Email == "" {
		errs = append(errs, domain.ValidationError{Field: "email", Message: "required"})
	} else if !emailRegex.MatchString(u.Email) {
		errs = append(errs, domain.ValidationError{Field: "email", Message: "invalid email format"})
	}

	if u.DisplayName == "" {
		errs = append(errs, domain.ValidationError{Field: "displayName", Message: "required"})
	} else if len(u.DisplayName) > 100 {
		errs = append(errs, domain.ValidationError{Field: "displayName", Message: "must be at most 100 characters"})
	}

	if len(errs) > 0 {
		return errs
	}
	return nil
}

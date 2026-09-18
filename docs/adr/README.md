# Architecture Decision Records

| ADR                                          | Decision                                                              | Status   |
| -------------------------------------------- | --------------------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)             | Start as a modular monolith with separate process roles               | Accepted |
| [0002](0002-identity-and-primary-channel.md) | Platform-neutral people and one temporal primary interaction channel  | Accepted |
| [0003](0003-checkin-uniqueness.md)           | One canonical check-in per person and practice date                   | Accepted |
| [0004](0004-region-temporal-scope.md)        | Temporal region assignments and historical access boundaries          | Accepted |
| [0005](0005-admin-auth-and-authorization.md) | Website OIDC plus scoped RBAC and database enforcement                | Accepted |
| [0006](0006-timezone-and-makeup.md)          | Learner time zones and noon make-up cutoff                            | Accepted |
| [0007](0007-practice-note-sharing.md)        | Private notes separated from authenticated learner sharing            | Accepted |
| [0008](0008-reminder-capabilities.md)        | Reminder preferences separated from platform capabilities and consent | Accepted |
| [0009](0009-seasonal-campaign-calendar.md)   | Sanfu and Sanjiu use the official Asia/Taipei calendar                | Accepted |
| [0010](0010-greenfield-data-and-cutover.md)  | New global data, no legacy test-data migration                        | Accepted |

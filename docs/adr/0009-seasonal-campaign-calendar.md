# ADR 0009: Seasonal Campaign Calendar

## Status

Accepted

## Decision

Sanfu and Sanjiu use the official Baiyan campaign calendar fixed to `Asia/Taipei`. Campaign definitions and badge rules are versioned and immutable after publication.

Learner reminders may be delivered in the learner's reminder time zone. The first release uses calendar-label matching: a learner qualifies when the canonical `practice_date` value is one of the published Asia/Taipei official dates. It does not convert Taipei midnight instants into the learner's time zone.

Make-up eligibility still follows the learner's practice time zone and noon cutoff. Rule-version tests cover east/west time zones, travel changes, first/last campaign dates, and final-day make-ups.

## Consequences

- Region time zones do not redefine campaign dates.
- Rule changes create new versions rather than rewriting historical awards.
- Campaign UI must explain that the official calendar is based on Taipei dates.

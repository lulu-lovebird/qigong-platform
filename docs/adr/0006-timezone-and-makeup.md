# ADR 0006: Practice Time Zone and Make-Up Rules

## Status

Accepted

## Decision

Practice and reminder time zones are separate IANA time zones. Each check-in stores the practice-time-zone snapshot used to calculate its date.

Yesterday may be entered or edited only before 12:00 local time in the learner's effective practice time zone. Future dates and dates older than yesterday are rejected.

The first release detects device time-zone differences and asks the learner whether to make a permanent manual change. It never changes time zone from IM metadata, IP geolocation, language, or device detection without confirmation. Temporary travel mode is deferred.

## Consequences

- Device time zone is advisory only.
- Historical check-in dates and snapshots never change after a profile time-zone change.
- Make-ups count toward date-based statistics and badges, but not time-of-day badges.

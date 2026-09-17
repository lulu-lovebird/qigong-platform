# ADR 0007: Practice Note Sharing

## Status

Accepted

## Decision

The original check-in note remains a private service record. Sharing is represented separately by an authenticated-learner post or publication record.

The default sharing option is visible to authenticated Baiyan Qigong learners, using the learner's real name. A learner may select a public nickname or opt out of sharing. An unshared note remains visible to the learner, assigned coach, and administrators with explicit private-note permission.

No practice-note content is available anonymously on the public internet or to search engines.

## Required Controls

- clear pre-submit explanation of visibility;
- explicit visibility and display-name choice;
- `noindex`, private cache controls, and authenticated responses;
- unpublish, reporting, moderation, and deletion propagation;
- audit access to private notes;
- warning against unnecessary medical and sensitive personal data.

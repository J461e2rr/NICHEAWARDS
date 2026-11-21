CREATE TABLE nomination_ballots (
  voter_hash TEXT PRIMARY KEY NOT NULL,
  choices TEXT NOT NULL CHECK (
    json_valid(choices) AND json_type(choices) = 'array'
    AND json_array_length(choices) <= 4
  ),
  revision INTEGER NOT NULL CHECK (revision > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


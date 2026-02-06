import { Schema } from "effect"

export class Session extends Schema.Class<Session>("Session")({
  id: Schema.String,
  name: Schema.String,
  cwd: Schema.String,
  created_at: Schema.Number,
}) {}

export class Entry extends Schema.Class<Entry>("Entry")({
  id: Schema.Number,
  session_id: Schema.String,
  type: Schema.String,
  content: Schema.String,
  created_at: Schema.Number,
}) {}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    id: Schema.String,
  }
) {}

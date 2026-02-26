import { Schema } from "effect"

export class Session extends Schema.Class<Session>("Session")({
  id: Schema.String,
  name: Schema.String,
  cwd: Schema.String,
  agent_type: Schema.String,
  agent_session_id: Schema.NullOr(Schema.String),
  mcp_servers: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
}) {}

export class Turn extends Schema.Class<Turn>("Turn")({
  id: Schema.String,
  session_id: Schema.String,
  role: Schema.Literal("user", "assistant"),
  stop_reason: Schema.NullOr(Schema.String),
  prompt_tokens: Schema.NullOr(Schema.Number),
  completion_tokens: Schema.NullOr(Schema.Number),
  total_tokens: Schema.NullOr(Schema.Number),
  token_source: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
}) {}

export class MessageBlock extends Schema.Class<MessageBlock>("MessageBlock")({
  id: Schema.String,
  turn_id: Schema.String,
  kind: Schema.String,
  content: Schema.String,
  created_at: Schema.Number,
}) {}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  "SessionNotFoundError",
  {
    id: Schema.String,
  }
) {
  get httpStatus() { return 404 as const }
  get httpMessage() { return "Session not found" }
}

export class AcpConnectionError extends Schema.TaggedError<AcpConnectionError>()(
  "AcpConnectionError",
  {
    message: Schema.String,
  }
) {
  get httpStatus() { return 502 as const }
  get httpMessage() { return this.message }
}

export class AuthRequiredError extends Schema.TaggedError<AuthRequiredError>()(
  "AuthRequiredError",
  {
    message: Schema.String,
    provider: Schema.String,
    authMethods: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        description: Schema.optional(Schema.String),
      })
    ),
  }
) {
  get httpStatus() { return 401 as const }
  get httpMessage() { return this.message }
}

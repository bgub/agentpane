import { spawn } from "node:child_process"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { SessionRepo } from "./session-repo"

export interface CommandExecutor {
  readonly exec: (
    sessionId: string,
    command: string,
    cwd: string
  ) => Effect.Effect<ReadableStream<Uint8Array>, Error>
}

export const CommandExecutor =
  Context.GenericTag<CommandExecutor>("CommandExecutor")

const CWD_MARKER = "__ACAPA_CWD_9f3a__"

export const CommandExecutorLive = Layer.effect(
  CommandExecutor,
  Effect.gen(function* () {
    const repo = yield* SessionRepo

    // Create promise-based wrappers for repo methods so we can call them from stream callbacks
    const addEntry = (sessionId: string, type: string, content: string) =>
      Effect.runPromise(repo.addEntry(sessionId, type, content))
    const updateCwd = (id: string, cwd: string) =>
      Effect.runPromise(repo.updateCwd(id, cwd))

    return CommandExecutor.of({
      exec: (sessionId, command, cwd) =>
        Effect.gen(function* () {
          yield* repo.addEntry(sessionId, "command", `$ ${command}`)

          const encoder = new TextEncoder()

          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const effectiveCwd = cwd === "~" ? process.env.HOME || "/" : cwd
              // Run command, then echo a marker followed by pwd so we can extract the final cwd
              const fullCommand = `${command}\n__acapa_exit=$?\necho "${CWD_MARKER}$(pwd)"\nexit $__acapa_exit`

              const proc = spawn("bash", ["-c", fullCommand], {
                cwd: effectiveCwd,
                env: { ...process.env },
              })

              let stdoutAccum = ""

              proc.stdout.on("data", (data: Buffer) => {
                const text = data.toString()
                stdoutAccum += text

                // Check if we have the marker in accumulated buffer
                // Only send data that's before the marker to the client
                const markerIdx = stdoutAccum.indexOf(CWD_MARKER)
                if (markerIdx === -1) {
                  // No marker yet — but hold back the last partial line in case
                  // marker arrives split across chunks
                  const lastNewline = text.lastIndexOf("\n")
                  if (lastNewline === -1) {
                    // No complete line, buffer will be flushed later
                    // Still send the data for real-time streaming
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({ type: "stdout", data: text }) + "\n"
                      )
                    )
                  } else {
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({ type: "stdout", data: text }) + "\n"
                      )
                    )
                  }
                } else {
                  // Marker found — send only the part before the marker
                  const beforeMarker = text.substring(
                    0,
                    text.indexOf(CWD_MARKER)
                  )
                  if (beforeMarker) {
                    controller.enqueue(
                      encoder.encode(
                        JSON.stringify({ type: "stdout", data: beforeMarker }) +
                          "\n"
                      )
                    )
                  }
                }
              })

              proc.stderr.on("data", (data: Buffer) => {
                const text = data.toString()
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ type: "stderr", data: text }) + "\n"
                  )
                )
                addEntry(sessionId, "stderr", text.replace(/\n$/, "")).catch(
                  () => {}
                )
              })

              proc.on("close", (code: number | null) => {
                // Extract cwd from accumulated stdout
                const markerIdx = stdoutAccum.indexOf(CWD_MARKER)
                let outputText = stdoutAccum
                if (markerIdx !== -1) {
                  outputText = stdoutAccum.substring(0, markerIdx)
                  const afterMarker = stdoutAccum
                    .substring(markerIdx + CWD_MARKER.length)
                    .trim()
                  if (afterMarker.startsWith("/")) {
                    const newCwd = afterMarker.split("\n")[0].trim()
                    updateCwd(sessionId, newCwd).catch(() => {})
                  }
                }

                // Persist stdout (trimmed)
                const trimmed = outputText.replace(/\n$/, "")
                if (trimmed) {
                  addEntry(sessionId, "stdout", trimmed).catch(() => {})
                }

                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ type: "exit", code: code ?? 1 }) + "\n"
                  )
                )

                if (code !== 0 && code !== null) {
                  addEntry(sessionId, "info", `exit code: ${code}`).catch(
                    () => {}
                  )
                }

                controller.close()
              })

              proc.on("error", (err: Error) => {
                controller.enqueue(
                  encoder.encode(
                    JSON.stringify({ type: "error", data: err.message }) + "\n"
                  )
                )
                addEntry(sessionId, "error", err.message).catch(() => {})
                controller.close()
              })
            },
          })

          return stream
        }),
    })
  })
)

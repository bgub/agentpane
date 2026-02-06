import { spawn } from "node:child_process"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { SessionRepo } from "./session-repo"

type OutputEvent =
  | { readonly type: "stdout"; readonly data: string }
  | { readonly type: "stderr"; readonly data: string }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "error"; readonly data: string }

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

    return CommandExecutor.of({
      exec: (sessionId, command, cwd) =>
        Effect.gen(function* () {
          yield* repo.addEntry(sessionId, "command", `$ ${command}`)

          const effectiveCwd = cwd === "~" ? process.env.HOME || "/" : cwd
          const fullCommand = `${command}\n__acapa_exit=$?\necho "${CWD_MARKER}$(pwd)"\nexit $__acapa_exit`

          let stdoutAccum = ""

          const eventStream = Stream.asyncPush<OutputEvent>((emit) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const proc = spawn("bash", ["-c", fullCommand], {
                  cwd: effectiveCwd,
                  env: { ...process.env },
                })

                proc.stdout.on("data", (data: Buffer) => {
                  const text = data.toString()
                  stdoutAccum += text

                  const markerIdx = stdoutAccum.indexOf(CWD_MARKER)
                  if (markerIdx === -1) {
                    emit.single({ type: "stdout", data: text })
                  } else {
                    const beforeMarker = text.substring(
                      0,
                      text.indexOf(CWD_MARKER)
                    )
                    if (beforeMarker) {
                      emit.single({ type: "stdout", data: beforeMarker })
                    }
                  }
                })

                proc.stderr.on("data", (data: Buffer) => {
                  const text = data.toString()
                  emit.single({ type: "stderr", data: text })
                  Effect.runPromise(
                    repo.addEntry(sessionId, "stderr", text.replace(/\n$/, ""))
                  ).catch(() => {})
                })

                proc.on("close", (code: number | null) => {
                  const markerIdx = stdoutAccum.indexOf(CWD_MARKER)
                  let outputText = stdoutAccum
                  if (markerIdx !== -1) {
                    outputText = stdoutAccum.substring(0, markerIdx)
                    const afterMarker = stdoutAccum
                      .substring(markerIdx + CWD_MARKER.length)
                      .trim()
                    if (afterMarker.startsWith("/")) {
                      const newCwd = afterMarker.split("\n")[0].trim()
                      Effect.runPromise(
                        repo.updateCwd(sessionId, newCwd)
                      ).catch(() => {})
                    }
                  }

                  const trimmed = outputText.replace(/\n$/, "")
                  if (trimmed) {
                    Effect.runPromise(
                      repo.addEntry(sessionId, "stdout", trimmed)
                    ).catch(() => {})
                  }

                  emit.single({ type: "exit", code: code ?? 1 })
                  if (code !== 0 && code !== null) {
                    Effect.runPromise(
                      repo.addEntry(sessionId, "info", `exit code: ${code}`)
                    ).catch(() => {})
                  }
                  emit.end()
                })

                proc.on("error", (err: Error) => {
                  emit.single({ type: "error", data: err.message })
                  Effect.runPromise(
                    repo.addEntry(sessionId, "error", err.message)
                  ).catch(() => {})
                  emit.end()
                })

                return proc
              }),
              (proc) =>
                Effect.sync(() => {
                  if (!proc.killed) proc.kill()
                })
            )
          )

          return eventStream.pipe(
            Stream.map((event) => JSON.stringify(event) + "\n"),
            Stream.encodeText,
            Stream.toReadableStream()
          )
        }),
    })
  })
)

import { spawn } from "node:child_process"
import { Context, Effect, Layer, Runtime, Stream } from "effect"
import { SessionRepo } from "./session-repo"

type OutputEvent =
  | { readonly type: "stdout"; readonly data: string }
  | { readonly type: "stderr"; readonly data: string }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "error"; readonly data: string }
  | { readonly type: "cwd"; readonly data: string }

export class CommandExecutor extends Context.Tag("@acapa/CommandExecutor")<
  CommandExecutor,
  {
    readonly exec: (
      sessionId: string,
      command: string,
      cwd: string
    ) => Effect.Effect<ReadableStream<Uint8Array>>
    readonly runningSessionIds: () => ReadonlySet<string>
  }
>() {
  static readonly layer = Layer.effect(
    CommandExecutor,
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const CWD_MARKER = "__ACAPA_CWD_9f3a__"
      const runningSessions = new Set<string>()

      const exec = Effect.fn("CommandExecutor.exec")(
        function* (sessionId: string, command: string, cwd: string) {
          yield* repo.addEntry(sessionId, "command", `$ ${command}`).pipe(Effect.orDie)
          runningSessions.add(sessionId)

          const effectiveCwd = cwd === "~" ? process.env.HOME || "/" : cwd
          const fullCommand = `${command}\n__acapa_exit=$?\necho "${CWD_MARKER}$(pwd)"\nexit $__acapa_exit`

          const stdoutChunks: string[] = []
          let markerFound = false
          let extractedCwd: string | null = null

          const eventStream = Stream.asyncPush<OutputEvent>((emit) =>
            Effect.acquireRelease(
              Effect.sync(() => {
                const proc = spawn("bash", ["-c", fullCommand], {
                  cwd: effectiveCwd,
                  env: { ...process.env },
                })

                proc.stdout.on("data", (data: Buffer) => {
                  const text = data.toString()
                  const markerIdx = text.indexOf(CWD_MARKER)
                  if (markerIdx === -1) {
                    if (!markerFound) {
                      stdoutChunks.push(text)
                      emit.single({ type: "stdout", data: text })
                    }
                  } else {
                    markerFound = true
                    const beforeMarker = text.substring(0, markerIdx)
                    if (beforeMarker) {
                      stdoutChunks.push(beforeMarker)
                      emit.single({ type: "stdout", data: beforeMarker })
                    }
                    const afterMarker = text
                      .substring(markerIdx + CWD_MARKER.length)
                      .trim()
                    if (afterMarker.startsWith("/")) {
                      extractedCwd = afterMarker.split("\n")[0].trim()
                    }
                  }
                })

                proc.stderr.on("data", (data: Buffer) => {
                  const text = data.toString()
                  emit.single({ type: "stderr", data: text })
                  runPromise(
                    repo.addEntry(sessionId, "stderr", text.replace(/\n$/, ""))
                  ).catch((err) => console.error("[acapa] DB write failed:", err))
                })

                proc.on("close", (code: number | null) => {
                  runningSessions.delete(sessionId)
                  const outputText = stdoutChunks.join("")
                  const trimmed = outputText.replace(/\n$/, "")
                  if (trimmed) {
                    runPromise(
                      repo.addEntry(sessionId, "stdout", trimmed)
                    ).catch((err) => console.error("[acapa] DB write failed:", err))
                  }

                  if (extractedCwd) {
                    runPromise(
                      repo.updateCwd(sessionId, extractedCwd)
                    ).catch((err) => console.error("[acapa] DB write failed:", err))
                    emit.single({ type: "cwd", data: extractedCwd })
                  }

                  emit.single({ type: "exit", code: code ?? 1 })
                  if (code !== 0 && code !== null) {
                    runPromise(
                      repo.addEntry(sessionId, "info", `exit code: ${code}`)
                    ).catch((err) => console.error("[acapa] DB write failed:", err))
                  }
                  emit.end()
                })

                proc.on("error", (err: Error) => {
                  runningSessions.delete(sessionId)
                  emit.single({ type: "error", data: err.message })
                  runPromise(
                    repo.addEntry(sessionId, "error", err.message)
                  ).catch((err) => console.error("[acapa] DB write failed:", err))
                  emit.end()
                })

                return proc
              }),
              (proc) =>
                Effect.sync(() => {
                  runningSessions.delete(sessionId)
                  if (!proc.killed) proc.kill()
                })
            )
          )

          return eventStream.pipe(
            Stream.map((event) => JSON.stringify(event) + "\n"),
            Stream.encodeText,
            Stream.toReadableStream()
          )
        }
      )

      return CommandExecutor.of({
        exec,
        runningSessionIds: () => runningSessions as ReadonlySet<string>,
      })
    })
  )
}

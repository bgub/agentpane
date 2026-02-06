import { spawn } from "node:child_process"
import { Context, Effect, Layer, Runtime, Stream } from "effect"
import { SessionRepo } from "./session-repo"

type OutputEvent =
  | { readonly type: "stdout"; readonly data: string }
  | { readonly type: "stderr"; readonly data: string }
  | { readonly type: "exit"; readonly code: number }
  | { readonly type: "error"; readonly data: string }

export class CommandExecutor extends Context.Tag("@acapa/CommandExecutor")<
  CommandExecutor,
  {
    readonly exec: (
      sessionId: string,
      command: string,
      cwd: string
    ) => Effect.Effect<ReadableStream<Uint8Array>>
  }
>() {
  static readonly layer = Layer.effect(
    CommandExecutor,
    Effect.gen(function* () {
      const repo = yield* SessionRepo
      const runtime = yield* Effect.runtime<never>()
      const runPromise = Runtime.runPromise(runtime)

      const CWD_MARKER = "__ACAPA_CWD_9f3a__"

      const exec = Effect.fn("CommandExecutor.exec")(
        function* (sessionId: string, command: string, cwd: string) {
          yield* repo.addEntry(sessionId, "command", `$ ${command}`).pipe(Effect.orDie)

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
                  runPromise(
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
                      runPromise(
                        repo.updateCwd(sessionId, newCwd)
                      ).catch(() => {})
                    }
                  }

                  const trimmed = outputText.replace(/\n$/, "")
                  if (trimmed) {
                    runPromise(
                      repo.addEntry(sessionId, "stdout", trimmed)
                    ).catch(() => {})
                  }

                  emit.single({ type: "exit", code: code ?? 1 })
                  if (code !== 0 && code !== null) {
                    runPromise(
                      repo.addEntry(sessionId, "info", `exit code: ${code}`)
                    ).catch(() => {})
                  }
                  emit.end()
                })

                proc.on("error", (err: Error) => {
                  emit.single({ type: "error", data: err.message })
                  runPromise(
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
        }
      )

      return CommandExecutor.of({ exec })
    })
  )
}

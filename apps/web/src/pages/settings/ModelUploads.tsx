import { useRef, useState, type DragEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MODEL_ACCEPT, MODEL_FORMAT_LABEL, modelFileProblem, modelSizeProblem, type ModelUploadView } from "@ecomanage/shared"
import { applyModelUpload, deleteModelUpload, getModelUploads, uploadModel } from "@/api/settings"
import { useToast } from "@/hooks/useToast"
import { cn } from "@/lib/utils"

// Settings → Site model → Upload a 3D file (App v2, P5-02). The file is checked here first (the
// same checks as the server), then converted by the worker: under 200k triangles, Draco + KTX2,
// centred, with a thumbnail. "Use this model" makes it the site model; anchors carry over.

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)
/** The file's bytes (FileReader: every browser, and jsdom in tests). */
const bytesOf = (file: Blob) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(file)
  })
const STATUS: Record<ModelUploadView["status"], string> = { queued: "Waiting to be processed…", processing: "Processing…", ready: "Ready", rejected: "Can’t be used", failed: "Failed" }

export function ModelUploads({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState("")
  const [over, setOver] = useState(false)
  const uploads = useQuery({
    queryKey: ["site", "model", "uploads"],
    queryFn: getModelUploads,
    // Poll while something is being processed.
    refetchInterval: (q) => (q.state.data?.some((u) => u.status === "queued" || u.status === "processing") ? 3000 : false),
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["site", "model"] })
  }

  const send = async (file: File | undefined) => {
    if (!file) return
    setProblem("")
    const reason = modelSizeProblem(file.size) ?? modelFileProblem(file.name, await bytesOf(file))
    if (reason) return setProblem(reason)
    setBusy(true)
    try {
      await uploadModel(file)
      toast({ description: `${file.name} uploaded. It’s being checked and simplified.` })
      refresh()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The file couldn’t be uploaded.")
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ""
    }
  }

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn()
      toast({ description: done })
      refresh()
    } catch (err) {
      toast({ variant: "destructive", description: err instanceof Error ? err.message : "That didn’t work." })
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (canEdit && !busy) void send(e.dataTransfer.files[0])
  }

  return (
    <div className="flex flex-col gap-3">
      {canEdit ? (
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={cn("flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-4 text-center text-[13px]", over ? "border-tag-bat bg-app-hv" : "border-app-ln")}
        >
          <span>
            Drop a .glb or .gltf here, or{" "}
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className="p-0 text-tag-grid underline-offset-2 hover:underline disabled:text-app-dm">
              choose a file
            </button>
          </span>
          <span className="text-xs text-app-sb">OBJ, FBX and IFC are converted · up to 30 MB · metres, Y up</span>
          <input ref={input} type="file" accept={MODEL_ACCEPT} className="sr-only" aria-label="3D model file" onChange={(e) => void send(e.target.files?.[0])} disabled={busy} />
          {busy ? <span className="text-xs text-app-sb" role="status">Uploading…</span> : null}
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="m-0 text-xs text-tag-hp">
          {problem}
        </p>
      ) : null}
      {uploads.data?.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Uploaded models">
          {uploads.data.map((u) => (
            <li key={u.id} className="flex gap-3 rounded-lg border border-app-ln p-2.5 text-[13px]">
              <div className="flex h-12 w-[72px] flex-none items-center justify-center overflow-hidden rounded bg-app-ch">
                {u.thumbUrl ? <img src={u.thumbUrl} alt="" className="h-full w-full object-contain" /> : <span className="text-[10px] uppercase text-app-sb">{u.format}</span>}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-medium" title={u.originalName}>
                  {u.originalName}
                </span>
                <span className={cn("text-xs", u.status === "rejected" || u.status === "failed" ? "text-tag-hp" : "text-app-sb")}>
                  {u.status === "ready"
                    ? `${(u.tris ?? 0).toLocaleString("en-US")} triangles${u.trisIn && u.trisIn > (u.tris ?? 0) ? ` (from ${u.trisIn.toLocaleString("en-US")})` : ""} · ${size(u.glbBytes ?? 0)}${u.scale && u.scale !== 1 ? ` · read as ${u.scale === 0.01 ? "centimetres" : "millimetres"}` : ""}`
                    : u.reason
                      ? `${STATUS[u.status]}: ${u.reason}`
                      : `${STATUS[u.status]} · ${MODEL_FORMAT_LABEL[u.format]}, ${size(u.bytes)}`}
                </span>
                {canEdit ? (
                  <span className="flex gap-3 pt-0.5">
                    {u.inUse ? <span className="text-xs font-medium text-tag-bat">In use</span> : null}
                    {u.status === "ready" && !u.inUse ? (
                      <button type="button" onClick={() => void act(() => applyModelUpload(u.id), "The site now uses this model. Check the anchors are still in place.")} className="p-0 text-xs text-tag-grid">
                        Use this model
                      </button>
                    ) : null}
                    {!u.inUse && u.status !== "queued" && u.status !== "processing" ? (
                      <button type="button" aria-label={`Remove ${u.originalName}`} onClick={() => void act(() => deleteModelUpload(u.id), "Upload removed.")} className="p-0 text-xs text-app-sb hover:text-app-tx">
                        Remove
                      </button>
                    ) : null}
                  </span>
                ) : u.inUse ? (
                  <span className="text-xs font-medium text-tag-bat">In use</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

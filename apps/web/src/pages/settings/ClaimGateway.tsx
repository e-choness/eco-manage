import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { formatClaimCode, parseGatewayQr, type GatewayView } from "@ecomanage/shared"
import { claimGateway } from "@/api/settings"
import { inputClass } from "./styles"
import { cn } from "@/lib/utils"

// Settings → Site → Gateway (P5-04, Data and Device Audit §4 step 01): the installer types the
// serial number and claim code from the gateway's label, or pastes what its QR code says. It
// applies straight away; the card then waits for the gateway to connect and get its certificate.

export function ClaimGateway({ gateway }: { gateway: GatewayView | undefined }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(!gateway?.id)
  const [serial, setSerial] = useState("")
  const [code, setCode] = useState("")
  const qr = parseGatewayQr(serial)
  const claim = useMutation({
    mutationFn: () => claimGateway(qr ? { qr: serial.trim() } : { serial: serial.trim(), code }),
    onSuccess: (view) => {
      qc.setQueryData(["site", "gateway"], view)
      setSerial("")
      setCode("")
      setOpen(false)
    },
  })
  const waiting = gateway?.claim?.state === "waiting"

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-app-ln pt-4 text-[13px]">
      {waiting ? (
        <p role="status" className="m-0 text-app-sb">
          Claimed {gateway.claim!.serial}. Waiting for it to connect: power it on with a network cable plugged in. This can take a minute.
        </p>
      ) : null}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="self-start p-0 text-xs text-tag-grid">
          {gateway?.id ? "Claim a replacement gateway" : "Claim a gateway"}
        </button>
      ) : (
        <form
          aria-label="Claim a gateway"
          onSubmit={(e) => {
            e.preventDefault()
            claim.mutate()
          }}
          className="flex flex-col gap-2"
        >
          <p className="m-0 text-app-sb">Type the serial number and claim code from the label on the gateway, or paste what its QR code says.</p>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex flex-col gap-1 text-app-sb">
              Serial number or QR code
              <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="EM-GW-000123" autoComplete="off" className={cn(inputClass, "w-64 font-mono")} />
            </label>
            {qr ? (
              <span className="pb-2 font-mono text-xs text-app-sb">
                {qr.serial} · {formatClaimCode(qr.code)}
              </span>
            ) : (
              <label className="flex flex-col gap-1 text-app-sb">
                Claim code
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" className={cn(inputClass, "w-64 font-mono")} />
              </label>
            )}
            <button type="submit" disabled={claim.isPending || !serial.trim() || (!qr && !code.trim())} className="h-9 rounded-lg border border-app-ln px-3 text-app-tx disabled:text-app-dm">
              {claim.isPending ? "Claiming…" : "Claim"}
            </button>
            {gateway?.id ? (
              <button type="button" onClick={() => setOpen(false)} className="h-9 p-0 text-xs text-app-sb">
                Cancel
              </button>
            ) : null}
          </div>
          {claim.error ? (
            <p role="alert" className="m-0 text-xs text-tag-hp">
              {claim.error instanceof Error ? claim.error.message : "The gateway couldn’t be claimed."}
            </p>
          ) : null}
        </form>
      )}
    </div>
  )
}

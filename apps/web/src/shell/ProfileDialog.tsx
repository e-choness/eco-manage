import { useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/contexts/AuthContext"
import { changePassword, updateProfile } from "@/api/auth"
import { ME_KEY, useMe } from "@/hooks/useMe"

/** Avatar menu → Profile: the person's name, and where their access comes from. */
export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, updateUser } = useAuth()
  const { membership, roleLabel } = useMe()
  const queryClient = useQueryClient()
  const [name, setName] = useState(user?.name ?? "")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const [pw, setPw] = useState({ current: "", next: "", message: "", error: "" })
  const changePw = async (e: FormEvent) => {
    e.preventDefault()
    if (pw.next.length < 8) return setPw({ ...pw, error: "Use at least 8 characters.", message: "" })
    try {
      await changePassword(pw.current, pw.next)
      setPw({ current: "", next: "", message: "Password changed.", error: "" })
    } catch (err) {
      setPw({ ...pw, error: err instanceof Error ? err.message : "The password couldn't be changed.", message: "" })
    }
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError("Enter your name.")
    setSaving(true)
    try {
      await updateProfile({ name: name.trim() })
      updateUser({ name: name.trim() })
      void queryClient.invalidateQueries({ queryKey: ME_KEY })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={save} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>
              {membership ? `${roleLabel} at ${membership.siteName}. Your role is set by the site owner.` : "You don't have access to a site yet."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={user?.email ?? ""} readOnly disabled />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
        <form onSubmit={changePw} aria-label="Change password" className="mt-2 flex flex-col gap-3 border-t pt-4">
          <h3 className="m-0 text-sm font-semibold">Change password</h3>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-next">New password</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </div>
          {pw.error ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {pw.error}
            </p>
          ) : null}
          {pw.message ? (
            <p role="status" className="m-0 text-sm text-muted-foreground">
              {pw.message}
            </p>
          ) : null}
          <Button type="submit" variant="outline" className="self-end" disabled={!pw.current || !pw.next}>
            Change password
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState, type FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/contexts/AuthContext"
import { updateProfile } from "@/api/auth"
import { ME_KEY, useMe } from "@/hooks/useMe"

/** Avatar menu → Profile: the person's name, and where their access comes from. */
export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, updateUser } = useAuth()
  const { membership, roleLabel } = useMe()
  const queryClient = useQueryClient()
  const [name, setName] = useState(user?.name ?? "")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(user?.name ?? "")
      setError("")
    }
  }, [open, user?.name])

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
      </DialogContent>
    </Dialog>
  )
}

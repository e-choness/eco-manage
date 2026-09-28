import { useQuery } from "@tanstack/react-query"
import { getSnapshot } from "@/api/site"
import { SNAPSHOT_KEY, useSiteStream } from "@/hooks/useSiteStream"


/**
 * The site's live view: the snapshot from GET /api/site/snapshot, kept current by the stream the
 * shell holds open (SiteStreamProvider).
 */
export function useSiteLive() {
  const query = useQuery({ queryKey: SNAPSHOT_KEY, queryFn: getSnapshot })
  const { connected, lastEventAt } = useSiteStream()
  return { ...query, connected, lastEventAt }
}

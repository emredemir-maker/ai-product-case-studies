import type { Recommendation } from "@/lib/api"
import { AREA, PRIORITY } from "@/lib/tr"

/** A tag tinted with the area's own colour, so the list can be scanned by colour. */
export function AreaTag({ area }: { area: Recommendation["area"] }) {
  const { label, color } = AREA[area]
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-semibold" style={{ color, backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)` }}>
      {label}
    </span>
  )
}

export function PriorityDot({ priority }: { priority: Recommendation["priority"] }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: PRIORITY[priority].color }} title={PRIORITY[priority].short} />
}

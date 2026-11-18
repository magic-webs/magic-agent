import { HugeiconsIcon } from "@hugeicons/react";
import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import type { Doc } from "@/convex/_generated/dataModel";

export type AdReferral = NonNullable<Doc<"messages">["referral"]> & {
  imageUrl?: string | null;
};

export function adTitle(ad: AdReferral) {
  return ad.headline || ad.body || (ad.sourceType === "post" ? "Facebook post" : "Meta ad");
}

export function AdBadge() {
  return (
    <span className="shrink-0 rounded-full bg-[#0866FF]/10 px-1.5 py-px text-[10px] font-semibold text-[#0866FF]">
      Meta ad
    </span>
  );
}

export function AdQuote({ ad }: { ad: AdReferral }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 px-2 py-1">
        <span className="block font-medium text-[#0866FF]">
          {ad.sourceType === "post" ? "From a post" : "From a Meta ad"}
        </span>
        <span className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">
          {adTitle(ad)}
        </span>
      </span>
      {ad.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- any host
        <img src={ad.imageUrl} alt="" className="size-14 shrink-0 object-cover" />
      ) : null}
    </>
  );
  const className =
    "-mx-1 mb-1.5 flex items-center overflow-hidden rounded-md border-l-4 border-[#0866FF] bg-foreground/5 text-xs";
  return ad.sourceUrl ? (
    <a href={ad.sourceUrl} target="_blank" rel="noreferrer" className={className}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function AdDetails({ ad }: { ad: AdReferral & { at?: number } }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      {ad.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- any host
        <img src={ad.imageUrl} alt="" className="aspect-[1.6] w-full rounded-lg object-cover" />
      ) : null}
      <p className="font-medium text-foreground">{adTitle(ad)}</p>
      {ad.body && ad.body !== adTitle(ad) ? (
        <p className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">{ad.body}</p>
      ) : null}
      <p className="text-muted-foreground">
        {[ad.mediaType, ad.sourceId ? `Ad ${ad.sourceId}` : null, ad.at ? new Date(ad.at).toLocaleString() : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {ad.sourceUrl ? (
        <a
          href={ad.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 font-medium text-[#0866FF] hover:underline"
        >
          <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} className="size-3.5" />
          Open ad
        </a>
      ) : null}
    </div>
  );
}

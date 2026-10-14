export const CATALOGUE_KINDS = ["product", "service", "brochure", "other"] as const;

export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

/** Rows saved before `kind` existed marked a service with a tag. */
export function catalogueKind(entry: {
  kind?: CatalogueKind;
  tags: string[];
}): CatalogueKind {
  return entry.kind ?? (entry.tags.includes("service") ? "service" : "product");
}

export function isOrderable(kind: CatalogueKind) {
  return kind === "product" || kind === "service";
}

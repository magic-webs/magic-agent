import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import {
  catalogueKind as catalogueKindArg,
  kvPair,
  productFile,
  productImage,
  requirementField,
} from "./schema";
import { slugify, buildSearchBlob, randomKey } from "./lib/shared";
import { requireProduct, requireWorkspace } from "./lib/auth";
import { deleteFile, requireOwnKey, uploadUrlFor, urlFor } from "./lib/files";
import {
  catalogueKind,
  isOrderable,
  type CatalogueKind,
} from "./lib/catalogue";

const MAX_FILES = 10;

const productInput = {
  kind: v.optional(catalogueKindArg),
  sku: v.optional(v.string()),
  name: v.string(),
  category: v.optional(v.string()),
  description: v.optional(v.string()),
  price: v.optional(v.number()),
  currency: v.optional(v.string()),
  unit: v.optional(v.string()),
  requirementFields: v.optional(v.array(requirementField)),
  images: v.optional(v.array(productImage)),
  files: v.optional(v.array(productFile)),
  attributes: v.optional(v.array(kvPair)),
  exampleSpec: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
};

function blobFor(p: {
  kind?: CatalogueKind;
  name: string;
  category?: string;
  description?: string;
  tags?: string[];
  sku?: string;
}): string {
  return buildSearchBlob([
    p.kind && p.kind !== "product" ? p.kind : undefined,
    p.name,
    p.category,
    p.description,
    p.sku,
    ...(p.tags ?? []),
  ]);
}

async function uniqueProductSlug(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  desired: string
): Promise<string> {
  const base = slugify(desired) || `product-${randomKey(6)}`;
  let candidate = base;
  for (let attempt = 0; attempt < 20; attempt++) {
    const clash = await ctx.db
      .query("products")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", workspaceId).eq("slug", candidate)
      )
      .unique();
    if (!clash) return candidate;
    candidate = `${base}-${attempt + 2}`;
  }
  return `${base}-${randomKey(6)}`;
}

type StoredImage = {
  fileKey?: string;
  storageId?: Id<"_storage">;
  externalUrl?: string;
  alt?: string;
};

/**
 * Turns the stored image list into something a browser can render.
 *
 * An uploaded file is only reachable through a signed storage URL, which has to
 * be minted per read, so the resolved list travels alongside the raw one rather
 * than replacing it: the editor still needs the storage ids to know what it is
 * editing.
 */
async function resolveImages(
  ctx: QueryCtx,
  images: StoredImage[] | undefined
): Promise<Array<{ url: string; alt: string | null }>> {
  const out: Array<{ url: string; alt: string | null }> = [];
  for (const image of images ?? []) {
    const url =
      (await urlFor(ctx, image.fileKey, image.storageId)) ?? image.externalUrl;
    // A file deleted out from under the row resolves to null. Skipping it beats
    // rendering a broken thumbnail.
    if (url) out.push({ url, alt: image.alt ?? null });
  }
  return out;
}

type StoredFile = {
  fileKey: string;
  filename: string;
  mimeType?: string;
  size?: number;
};

async function resolveFiles(ctx: QueryCtx, files: StoredFile[] | undefined) {
  const out: Array<{
    url: string;
    filename: string;
    mimeType: string | null;
    size: number | null;
  }> = [];
  for (const file of files ?? []) {
    const url = await urlFor(ctx, file.fileKey);
    if (url) {
      out.push({
        url,
        filename: file.filename,
        mimeType: file.mimeType ?? null,
        size: file.size ?? null,
      });
    }
  }
  return out;
}

async function withImages(ctx: QueryCtx, products: Doc<"products">[]) {
  return await Promise.all(
    products.map(async (product) => ({
      ...product,
      kind: catalogueKind(product),
      resolvedImages: await resolveImages(ctx, product.images),
      resolvedFiles: await resolveFiles(ctx, product.files),
    }))
  );
}

/** The catalogue image an agent can point a customer at, if there is one. */
async function primaryImageUrl(
  ctx: QueryCtx,
  product: Doc<"products">
): Promise<string | null> {
  const resolved = await resolveImages(ctx, product.images?.slice(0, 1));
  return resolved[0]?.url ?? null;
}

// Storage files are not owned by the product row, so removing an image from the
// list has to delete the file too — otherwise every edit leaks one.
async function deleteOrphanedImages(
  ctx: MutationCtx,
  before: StoredImage[] | undefined,
  after: StoredImage[] | undefined
): Promise<void> {
  const kept = new Set<string>();
  for (const image of after ?? []) {
    if (image.fileKey) kept.add(image.fileKey);
    if (image.storageId) kept.add(image.storageId);
  }
  for (const image of before ?? []) {
    await deleteFile(
      ctx,
      image.fileKey && !kept.has(image.fileKey) ? image.fileKey : undefined,
      image.storageId && !kept.has(image.storageId) ? image.storageId : undefined
    );
  }
}

function requireOwnImages(
  images: StoredImage[] | undefined,
  workspaceId: Id<"workspaces">
) {
  for (const image of images ?? []) {
    requireOwnKey(image.fileKey, "products", workspaceId);
  }
}

function requireOwnFiles(
  files: StoredFile[] | undefined,
  workspaceId: Id<"workspaces">
) {
  if ((files?.length ?? 0) > MAX_FILES) {
    throw new ConvexError(`Attach at most ${MAX_FILES} files`);
  }
  for (const file of files ?? []) {
    requireOwnKey(file.fileKey, "products", workspaceId);
  }
}

async function deleteOrphanedFiles(
  ctx: MutationCtx,
  before: StoredFile[] | undefined,
  after: StoredFile[] | undefined
) {
  const kept = new Set((after ?? []).map((file) => file.fileKey));
  for (const file of before ?? []) {
    if (!kept.has(file.fileKey)) await deleteFile(ctx, file.fileKey);
  }
}

async function listOfKind(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  kind: CatalogueKind
) {
  const typed = await ctx.db
    .query("products")
    .withIndex("by_workspace_kind", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", kind)
    )
    .order("desc")
    .take(200);
  if (!isOrderable(kind)) return typed;
  const untyped = await ctx.db
    .query("products")
    .withIndex("by_workspace_kind", (q) =>
      q.eq("workspaceId", workspaceId).eq("kind", undefined)
    )
    .order("desc")
    .take(200);
  return [...typed, ...untyped.filter((p) => catalogueKind(p) === kind)]
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, 200);
}

export const generateUploadUrl = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    return await uploadUrlFor("products", args.workspaceId);
  },
});

export const listByWorkspace = query({
  args: {
    workspaceId: v.id("workspaces"),
    search: v.optional(v.string()),
    category: v.optional(v.string()),
    kind: v.optional(catalogueKindArg),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const ofKind = (rows: Doc<"products">[]) =>
      args.kind ? rows.filter((p) => catalogueKind(p) === args.kind) : rows;
    const term = args.search?.trim();
    if (term) {
      return await withImages(
        ctx,
        ofKind(
          await ctx.db
            .query("products")
            .withSearchIndex("search_products", (q) =>
              q
                .search("searchBlob", term.toLowerCase())
                .eq("workspaceId", args.workspaceId)
            )
            .take(100)
        )
      );
    }

    if (args.category) {
      return await withImages(
        ctx,
        ofKind(
          await ctx.db
            .query("products")
            .withIndex("by_workspace_category", (q) =>
              q.eq("workspaceId", args.workspaceId).eq("category", args.category!)
            )
            .order("desc")
            .take(200)
        )
      );
    }

    if (args.kind) {
      return await withImages(
        ctx,
        await listOfKind(ctx, args.workspaceId, args.kind)
      );
    }

    return await withImages(
      ctx,
      await ctx.db
        .query("products")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .order("desc")
        .take(200)
    );
  },
});

/** The catalogue a page at a time, newest first. */
export const listPage = query({
  args: {
    workspaceId: v.id("workspaces"),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const term = args.search?.trim();
    const result = term
      ? await ctx.db
          .query("products")
          .withSearchIndex("search_products", (q) =>
            q
              .search("searchBlob", term.toLowerCase())
              .eq("workspaceId", args.workspaceId)
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("products")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
          .order("desc")
          .paginate(args.paginationOpts);
    return { ...result, page: await withImages(ctx, result.page) };
  },
});

export const categories = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const products = await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  },
});

export const kindCounts = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    const products = await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const counts: Record<CatalogueKind, number> = {
      product: 0,
      service: 0,
      brochure: 0,
      other: 0,
    };
    for (const product of products) counts[catalogueKind(product)]++;
    return counts;
  },
});

export const get = query({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    await requireProduct(ctx, args.productId);
    const product = await ctx.db.get("products", args.productId);
    if (!product) return null;
    return {
      ...product,
      kind: catalogueKind(product),
      resolvedImages: await resolveImages(ctx, product.images),
      resolvedFiles: await resolveFiles(ctx, product.files),
    };
  },
});

export const create = mutation({
  args: { workspaceId: v.id("workspaces"), ...productInput },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    requireOwnImages(args.images, args.workspaceId);
    requireOwnFiles(args.files, args.workspaceId);
    const now = Date.now();
    const slug = await uniqueProductSlug(ctx, args.workspaceId, args.name);
    return await ctx.db.insert("products", {
      workspaceId: args.workspaceId,
      slug,
      kind: args.kind ?? "product",
      sku: args.sku,
      name: args.name.trim(),
      category: args.category?.trim() || "General",
      description: args.description?.trim() || "",
      price: args.price,
      currency: args.currency,
      unit: args.unit,
      requirementFields: args.requirementFields ?? [],
      images: args.images ?? [],
      files: args.files ?? [],
      attributes: args.attributes ?? [],
      exampleSpec: args.exampleSpec,
      notes: args.notes,
      tags: args.tags ?? [],
      searchBlob: blobFor(args),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    productId: v.id("products"),
    ...productInput,
    name: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    /**
     * Takes the price off the product.
     *
     * An omitted argument means "leave this field alone", which is what makes
     * a partial update safe — but it also means there is no value of `price`
     * that means "no price", and "stop quoting this, it is bespoke now" is an
     * edit a company genuinely makes. Hence an explicit flag rather than
     * overloading the number.
     */
    clearPrice: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireProduct(ctx, args.productId);
    const { productId, clearPrice, ...rest } = args;
    const existing = await ctx.db.get("products", productId);
    if (!existing) throw new ConvexError("Product not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) patch[key] = value;
    }
    if (clearPrice) {
      patch.price = undefined;
      patch.currency = undefined;
    }

    if (args.images !== undefined) {
      requireOwnImages(args.images, existing.workspaceId);
      await deleteOrphanedImages(ctx, existing.images, args.images);
    }
    if (args.files !== undefined) {
      requireOwnFiles(args.files, existing.workspaceId);
      await deleteOrphanedFiles(ctx, existing.files, args.files);
    }

    patch.searchBlob = blobFor({
      kind: (patch.kind as CatalogueKind) ?? catalogueKind(existing),
      name: (patch.name as string) ?? existing.name,
      category: (patch.category as string) ?? existing.category,
      description: (patch.description as string) ?? existing.description,
      sku: (patch.sku as string) ?? existing.sku,
      tags: (patch.tags as string[]) ?? existing.tags,
    });

    await ctx.db.patch(productId, patch);
    return { success: true };
  },
});

export const remove = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, args) => {
    const product = await requireProduct(ctx, args.productId);
    await deleteOrphanedImages(ctx, product.images, []);
    await deleteOrphanedFiles(ctx, product.files, []);
    await ctx.db.delete(args.productId);
    return { success: true };
  },
});

// Paste-a-JSON-array import. Keeps catalogue onboarding to one step.
export const bulkImport = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    products: v.array(
      v.object({
        kind: v.optional(catalogueKindArg),
        name: v.string(),
        sku: v.optional(v.string()),
        category: v.optional(v.string()),
        description: v.optional(v.string()),
        price: v.optional(v.number()),
        currency: v.optional(v.string()),
        unit: v.optional(v.string()),
        requirementFields: v.optional(v.array(requirementField)),
        // Import carries URLs only: a spreadsheet cannot hold a file, and a
        // company importing a catalogue already hosts its product shots.
        imageUrls: v.optional(v.array(v.string())),
        attributes: v.optional(v.array(kvPair)),
        exampleSpec: v.optional(v.string()),
        notes: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    await requireWorkspace(ctx, args.workspaceId);
    let created = 0;
    let updated = 0;
    const now = Date.now();

    for (const input of args.products) {
      if (!input.name?.trim()) continue;
      const slug = slugify(input.name);
      const existing = await ctx.db
        .query("products")
        .withIndex("by_workspace_slug", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("slug", slug)
        )
        .unique();

      const images = input.imageUrls
        ?.map((url) => url.trim())
        .filter(Boolean)
        .map((url) => ({ externalUrl: url }));

      const shared = {
        ...(input.kind ? { kind: input.kind } : {}),
        sku: input.sku,
        name: input.name.trim(),
        category: input.category?.trim() || "General",
        description: input.description?.trim() || "",
        price: input.price,
        currency: input.currency,
        unit: input.unit,
        requirementFields: input.requirementFields ?? [],
        attributes: input.attributes ?? [],
        exampleSpec: input.exampleSpec,
        notes: input.notes,
        tags: input.tags ?? [],
        searchBlob: blobFor(input),
        updatedAt: now,
      };

      if (existing) {
        // A file with no image column must not wipe pictures somebody uploaded
        // by hand, so images are only written when the import supplies them.
        if (images?.length) {
          await deleteOrphanedImages(ctx, existing.images, images);
        }
        await ctx.db.patch(existing._id, {
          ...shared,
          ...(images?.length ? { images } : {}),
        });
        updated++;
      } else {
        await ctx.db.insert("products", {
          workspaceId: args.workspaceId,
          slug: slug || `product-${randomKey(6)}`,
          kind: input.kind ?? "product",
          status: "active",
          createdAt: now,
          images: images ?? [],
          ...shared,
        });
        created++;
      }
    }

    return { created, updated };
  },
});

// ---------------------------------------------------------------------------
// Internal — backing the search_products / get_product_requirements tools
// ---------------------------------------------------------------------------

function toToolShape(product: Doc<"products">) {
  const kind = catalogueKind(product);
  return {
    kind,
    orderable: isOrderable(kind),
    slug: product.slug,
    name: product.name,
    category: product.category,
    description: product.description,
    price: product.price ?? null,
    currency: product.currency ?? null,
    unit: product.unit ?? null,
    tags: product.tags,
    attributes: product.attributes,
    exampleSpec: product.exampleSpec ?? null,
    notes: product.notes ?? null,
    requiredFields: product.requirementFields
      .filter((f) => f.required)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        example: f.example ?? null,
      })),
    optionalFields: product.requirementFields
      .filter((f) => !f.required)
      .map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        options: f.options ?? null,
        example: f.example ?? null,
      })),
  };
}

async function runSearch(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  term: string | undefined,
  limit: number
): Promise<Doc<"products">[]> {
  const cleaned = term?.trim().toLowerCase();
  if (!cleaned) {
    return await ctx.db
      .query("products")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(limit);
  }

  const hits = await ctx.db
    .query("products")
    .withSearchIndex("search_products", (q) =>
      q
        .search("searchBlob", cleaned)
        .eq("workspaceId", workspaceId)
        .eq("status", "active")
    )
    .take(limit);

  if (hits.length > 0) return hits;

  // Search index needs whole-word matches; fall back to substring for
  // partial product names the customer typed loosely.
  const all = await ctx.db
    .query("products")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return all
    .filter(
      (p) => p.status === "active" && p.searchBlob.includes(cleaned)
    )
    .slice(0, limit);
}

export const searchForTool = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const products = await runSearch(
      ctx,
      args.workspaceId,
      args.query,
      args.limit ?? 8
    );
    return await Promise.all(
      products.map(async (p) => ({
        kind: catalogueKind(p),
        slug: p.slug,
        name: p.name,
        category: p.category,
        description: p.description,
        price: p.price ?? null,
        currency: p.currency ?? null,
        unit: p.unit ?? null,
        // So the agent knows a picture exists and can offer it, rather than
        // telling a customer there is nothing to look at.
        imageUrl: await primaryImageUrl(ctx, p),
        files: (await resolveFiles(ctx, p.files)).map((file) => ({
          url: file.url,
          filename: file.filename,
        })),
        requiredFieldCount: p.requirementFields.filter((f) => f.required).length,
      }))
    );
  },
});

export const requirementsForTool = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    product: v.string(),
  },
  handler: async (ctx, args) => {
    const matches = await runSearch(ctx, args.workspaceId, args.product, 3);
    if (matches.length === 0) {
      const all = await ctx.db
        .query("products")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .take(30);
      return {
        found: false,
        product: null,
        availableProducts: all.map((p) => p.name),
      };
    }
    return {
      found: true,
      product: {
        ...toToolShape(matches[0]),
        images: await resolveImages(ctx, matches[0].images),
        files: (await resolveFiles(ctx, matches[0].files)).map((file) => ({
          url: file.url,
          filename: file.filename,
        })),
      },
      alternatives: matches.slice(1).map((p) => p.name),
    };
  },
});

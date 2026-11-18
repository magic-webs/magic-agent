/**
 * The catalogue an agent is allowed to talk about: products, services, and
 * brochures or other documents it can send.
 */

import { z } from "zod";
import { kvArg, requirementFieldArg, workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { fileSourceArgs, loadFile } from "../files.mjs";
import { findProduct } from "../lookup.mjs";
import { handler, ok, productBrief } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

const KINDS = ["product", "service", "brochure", "other"];

const kindArg = z
  .enum(KINDS)
  .describe(
    "product or service to sell; brochure or other for a document agents send rather than sell (price list, menu, spec sheet). Defaults to product."
  );

const fileArg = z.object(fileSourceArgs);

const imageArg = z.object({
  ...fileSourceArgs,
  filename: z
    .string()
    .optional()
    .describe("e.g. 'front.jpg'. Required with contentBase64 or fileKey; defaults to the URL's last segment."),
  alt: z.string().optional().describe("What the image shows"),
});

async function storeFile(workspaceId, file) {
  if (file.fileKey) {
    return { fileKey: file.fileKey, filename: file.filename, mimeType: file.mimeType };
  }
  const target = await call.mutation(api.products.generateUploadUrl, {
    workspaceId,
  });
  const put = await fetch(target.url, {
    method: "PUT",
    headers: { "Content-Type": file.mimeType ?? "application/octet-stream" },
    body: file.bytes,
  });
  if (!put.ok) {
    throw new Error(`Uploading ${file.filename} failed with HTTP ${put.status}`);
  }
  return {
    fileKey: target.key,
    filename: file.filename,
    mimeType: file.mimeType,
    size: file.bytes.byteLength,
  };
}

const copyFiles = async (workspaceId, files) => {
  const out = [];
  for (const file of files) out.push(await storeFile(workspaceId, await loadFile(file)));
  return out;
};

const uploadedKeys = (...lists) =>
  lists.flatMap((list) => (list ?? []).map((file) => file.fileKey?.trim()).filter(Boolean));

async function missingUploads(productId, keys) {
  if (keys.length === 0) return [];
  const product = await call.query(api.products.get, { productId });
  const urls = [...(product?.resolvedFiles ?? []), ...(product?.resolvedImages ?? [])].map(
    (file) => file.url
  );
  const missing = [];
  for (const key of keys) {
    const url = urls.find((candidate) => candidate.endsWith(`/${key}`));
    const head = url ? await fetch(url, { method: "HEAD" }) : null;
    if (!head?.ok) missing.push(key);
  }
  return missing;
}

const notArrived = (missing) =>
  new Error(
    `Nothing has been uploaded to ${missing.join(", ")}. Nothing was changed, and the uploads in this call were discarded: call create_upload_url again for each file, PUT it to the new uploadUrl, then retry.`
  );

const copyImages = async (workspaceId, images) => {
  const out = [];
  for (const { alt, ...source } of images) {
    const file = await loadFile(source);
    if (!file.mimeType?.startsWith("image/")) {
      throw new Error(`${file.filename} is not an image. Use a .png, .jpg, .webp or .gif file.`);
    }
    const stored = await storeFile(workspaceId, file);
    out.push({ fileKey: stored.fileKey, alt: alt?.trim() || undefined });
  }
  return out;
};

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "The catalogue: products, services, and brochures or other documents with their files. Agents refuse to discuss anything not listed here, and never quote a price a product does not carry.",
      inputSchema: {
        ...workspaceArg,
        search: z.string().optional(),
        category: z.string().optional(),
        kind: z.enum(KINDS).optional().describe("Only entries of this kind"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, search, category, kind }) => {
      const found = await resolveWorkspace(workspace);
      const products = await call.query(api.products.listByWorkspace, {
        workspaceId: found._id,
        search,
        category,
        kind,
      });
      return ok(products.map(productBrief));
    })
  );

  const productFields = {
    kind: kindArg.optional(),
    sku: z.string().optional(),
    category: z.string().optional().describe("Defaults to 'General'"),
    description: z.string().optional(),
    price: z
      .number()
      .optional()
      .describe(
        "Leave unset and agents are told never to quote — the team quotes manually."
      ),
    unit: z.string().optional().describe("What the price is per, e.g. 'per 1000'"),
    requirementFields: z
      .array(requirementFieldArg)
      .optional()
      .describe(
        "The spec questions an agent must collect before it can record an order for this product."
      ),
    attributes: z
      .array(kvArg)
      .optional()
      .describe("Extra facts an agent may state — lead time, minimum order"),
    imageUrls: z
      .array(z.string())
      .optional()
      .describe(
        "Image addresses linked as they are. The first image overall is the catalogue thumbnail."
      ),
    exampleSpec: z.string().optional(),
    notes: z.string().optional().describe("Internal — never shown to customers"),
    tags: z.array(z.string()).optional(),
  };

  const toImages = (imageUrls) =>
    imageUrls === undefined
      ? undefined
      : imageUrls
          .map((url) => url.trim())
          .filter(Boolean)
          .map((url) => ({ externalUrl: url }));

  server.registerTool(
    "create_product",
    {
      title: "Create product",
      description:
        "Add a product, service, brochure or other document to the catalogue. For a product or service, set requirementFields to the questions an agent must ask before it can take an order — that is what turns a chat into a complete enquiry. For a brochure, pass its PDF in files; agents send it when a customer asks.",
      inputSchema: {
        ...workspaceArg,
        name: z.string(),
        currency: z
          .string()
          .optional()
          .describe("Defaults to the workspace currency when a price is given"),
        ...productFields,
        imageFiles: z
          .array(imageArg)
          .max(10)
          .optional()
          .describe(
            "Images copied into storage, each a url to download, a fileKey from create_upload_url, or contentBase64 for a small file, with filename, up to 25 MB. They come before imageUrls, so the first is the thumbnail."
          ),
        files: z
          .array(fileArg)
          .max(10)
          .optional()
          .describe(
            "PDFs or documents agents can send — a brochure, price list or spec sheet. Each is a url to download, a fileKey from create_upload_url, or contentBase64 for a small file, with filename, up to 25 MB."
          ),
      },
    },
    handler(async ({ workspace, imageUrls, imageFiles, files, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const stored = imageFiles?.length ? await copyImages(found._id, imageFiles) : [];
      const productId = await call.mutation(api.products.create, {
        workspaceId: found._id,
        currency: fields.price !== undefined ? fields.currency ?? found.currency : undefined,
        ...fields,
        images: stored.length ? [...stored, ...(toImages(imageUrls) ?? [])] : toImages(imageUrls),
        files: files ? await copyFiles(found._id, files) : undefined,
      });
      const missing = await missingUploads(productId, uploadedKeys(imageFiles, files));
      if (missing.length) {
        await call.mutation(api.products.remove, { productId });
        throw notArrived(missing);
      }
      return ok({ productId, name: fields.name });
    })
  );

  server.registerTool(
    "update_product",
    {
      title: "Update product",
      description:
        "Change a catalogue entry. Omitted fields are left alone; arrays replace the whole list, except files, which change through addFiles and removeFiles, and addImages, which appends. Omitting price therefore keeps the price it has — use clearPrice to take it off.",
      inputSchema: {
        ...workspaceArg,
        product: z.string().describe("Product name, SKU, slug or id"),
        name: z.string().optional(),
        currency: z.string().optional(),
        status: z.enum(["active", "archived"]).optional(),
        clearPrice: z
          .boolean()
          .optional()
          .describe(
            "Remove the price, so agents stop quoting it and take the enquiry instead. There is no value of price that means 'none', which is why this is its own flag."
          ),
        ...productFields,
        addImages: z
          .array(imageArg)
          .optional()
          .describe(
            "Images to add after the current ones (or after imageUrls, when given), each a url to download, a fileKey from create_upload_url, or contentBase64 for a small file, with filename, up to 25 MB"
          ),
        addFiles: z
          .array(fileArg)
          .optional()
          .describe("Files to attach, each a url to download, a fileKey from create_upload_url, or contentBase64 for a small file, with filename, up to 25 MB"),
        removeFiles: z
          .array(z.string())
          .optional()
          .describe("Filenames of attached files to delete"),
      },
    },
    handler(async ({ workspace, product, imageUrls, addImages, addFiles, removeFiles, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findProduct(found._id, product);
      const removing = new Set((removeFiles ?? []).map((name) => name.trim()));
      const files =
        addFiles?.length || removing.size
          ? [
              ...(target.files ?? []).filter(
                (file) => !removing.has(file.filename)
              ),
              ...(await copyFiles(found._id, addFiles ?? [])),
            ]
          : undefined;
      const images = addImages?.length
        ? [
            ...(toImages(imageUrls) ?? target.images ?? []),
            ...(await copyImages(found._id, addImages)),
          ]
        : toImages(imageUrls);
      const keys = uploadedKeys(addImages, addFiles);
      if (keys.length) {
        await call.mutation(api.products.update, { productId: target._id, images, files });
        const missing = await missingUploads(target._id, keys);
        if (missing.length) {
          await call.mutation(api.products.update, {
            productId: target._id,
            images: target.images ?? [],
            files: target.files ?? [],
          });
          throw notArrived(missing);
        }
        await call.mutation(api.products.update, { productId: target._id, ...fields });
      } else {
        await call.mutation(api.products.update, { productId: target._id, ...fields, images, files });
      }
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_product",
    {
      title: "Delete product",
      description:
        "Permanently delete a catalogue entry and its uploaded images and files. Archiving with update_product status:'archived' is usually better — it keeps the record and stops agents offering it.",
      inputSchema: {
        ...workspaceArg,
        product: z.string().describe("Product name, SKU, slug or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, product }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findProduct(found._id, product);
      await call.mutation(api.products.remove, { productId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );

  server.registerTool(
    "import_products",
    {
      title: "Import products",
      description:
        "Create or update many catalogue entries at once, matched by name. An entry already in the catalogue is updated rather than duplicated. Omitting imageUrls on an existing entry keeps the images it already has. Files are not imported — attach them with create_product or update_product.",
      inputSchema: {
        ...workspaceArg,
        products: z
          .array(
            z.object({
              name: z.string(),
              currency: z.string().optional(),
              ...productFields,
            })
          )
          .min(1),
      },
    },
    handler(async ({ workspace, products }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.mutation(api.products.bulkImport, {
        workspaceId: found._id,
        products: products.map(({ imageUrls, ...rest }) => ({
          ...rest,
          imageUrls: imageUrls?.map((url) => url.trim()).filter(Boolean),
        })),
      });
      return ok(result);
    })
  );

  server.registerTool(
    "draft_catalogue",
    {
      title: "Draft a starter catalogue",
      description:
        "Have the platform's own model draft a starter catalogue from the workspace's industry and description, including the spec questions for each product. Costs tokens against the workspace. Review with list_products afterwards — it is a starting point, not a price list.",
      inputSchema: {
        ...workspaceArg,
        brief: z
          .string()
          .optional()
          .describe("Extra steer, e.g. 'focus on large-format print'"),
      },
    },
    handler(async ({ workspace, brief }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.ai.draftCatalogue, {
        workspaceId: found._id,
        brief,
      });
      return ok(result);
    })
  );
}

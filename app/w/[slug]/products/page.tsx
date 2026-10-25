"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
  CATALOGUE_KINDS,
  isOrderable,
  type CatalogueKind,
} from "@/convex/lib/catalogue";
import { useWorkspace } from "@/components/workspace-provider";
import {
  KeyValueEditor,
  ChipListEditor,
  type KeyValue,
} from "@/components/editors";
import {
  ProductImagesEditor,
  ProductThumbnail,
  draftsFromProduct,
  uploadDrafts,
  type ImageDraft,
} from "@/components/product-images";
import {
  FileGlyph,
  ProductFilesEditor,
  filesFromProduct,
  uploadFileDrafts,
  type FileDraft,
} from "@/components/product-files";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { SelectField } from "@/components/select-field";
import {
  FieldListEditor,
  type CollectedField as RequirementField,
} from "@/components/field-list-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CSV_COLUMNS,
  parseProductCsv,
  sampleProductCsv,
  type ParseResult,
} from "@/lib/product-csv";
import { downloadCsv } from "@/lib/csv";
import { friendlyError } from "@/lib/errors";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { toast } from "@/components/ui/toast";
import { TableSkeleton } from "@/components/skeletons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  BookOpen02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Download01Icon,
  FileImportIcon,
  Folder01Icon,
  PackageIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  Search01Icon,
  SparklesIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

type CatalogueProduct = FunctionReturnType<
  typeof api.products.listByWorkspace
>[number];

const KINDS: Record<
  CatalogueKind,
  {
    label: string;
    plural: string;
    noun: string;
    icon: IconSvgElement;
    name: string;
    category: string;
    unit?: string;
  }
> = {
  product: {
    label: "Product",
    plural: "Products",
    noun: "a product",
    icon: PackageIcon,
    name: "Product name",
    category: "Category",
    unit: "What the price is per",
  },
  service: {
    label: "Service",
    plural: "Services",
    noun: "a service",
    icon: Wrench01Icon,
    name: "Service name",
    category: "Category",
    unit: "What the price is per",
  },
  brochure: {
    label: "Brochure",
    plural: "Brochures",
    noun: "a brochure",
    icon: BookOpen02Icon,
    name: "Brochure name",
    category: "Category",
  },
  other: {
    label: "Other",
    plural: "Other",
    noun: "a document",
    icon: Folder01Icon,
    name: "Document name",
    category: "Category",
  },
};

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

type ProductForm = {
  kind: CatalogueKind;
  name: string;
  sku: string;
  category: string;
  description: string;
  price: string;
  unit: string;
  exampleSpec: string;
  notes: string;
  tags: string[];
  attributes: KeyValue[];
  requirementFields: RequirementField[];
  images: ImageDraft[];
  files: FileDraft[];
};

const emptyForm = (kind: CatalogueKind): ProductForm => ({
  kind,
  name: "",
  sku: "",
  category: "",
  description: "",
  price: "",
  unit: "",
  exampleSpec: "",
  notes: "",
  tags: [],
  attributes: [],
  requirementFields: [],
  images: [],
  files: [],
});

function ProductDialog({
  product,
  defaultKind = "product",
  trigger,
}: {
  product?: CatalogueProduct;
  defaultKind?: CatalogueKind;
  trigger: React.ReactElement;
}) {
  const workspace = useWorkspace();
  const createProduct = useMutation(api.products.create);
  const updateProduct = useMutation(api.products.update);
  const generateUploadUrl = useMutation(api.products.generateUploadUrl);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ProductForm>(
    product
      ? {
          kind: product.kind,
          name: product.name,
          sku: product.sku ?? "",
          category: product.category,
          description: product.description,
          price: product.price !== undefined ? String(product.price) : "",
          unit: product.unit ?? "",
          exampleSpec: product.exampleSpec ?? "",
          notes: product.notes ?? "",
          tags: product.tags,
          attributes: product.attributes,
          requirementFields: product.requirementFields,
          images: draftsFromProduct(
            product.images ?? [],
            product.resolvedImages,
          ),
          files: filesFromProduct(product.files ?? [], product.resolvedFiles),
        }
      : emptyForm(defaultKind),
  );
  const meta = KINDS[form.kind];
  const priced = isOrderable(form.kind);

  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.add({ title: "A name is required", type: "error" });
      return;
    }
    if (form.kind === "brochure" && form.files.length === 0) {
      toast.add({ title: "Attach the brochure file", type: "error" });
      return;
    }
    const parsedPrice =
      priced && form.price.trim() ? Number(form.price) : undefined;
    if (parsedPrice !== undefined && !Number.isFinite(parsedPrice)) {
      toast.add({ title: "Price must be a number", type: "error" });
      return;
    }

    setBusy(true);
    try {
      // Files chosen in this dialog are uploaded now rather than on selection,
      // so cancelling out of the dialog leaves nothing behind in storage.
      const images = await uploadDrafts(form.images, () =>
        generateUploadUrl({ workspaceId: workspace._id }),
      );
      const files = await uploadFileDrafts(form.files, () =>
        generateUploadUrl({ workspaceId: workspace._id }),
      );

      const payload = {
        kind: form.kind,
        name: form.name,
        sku: priced ? form.sku || undefined : undefined,
        category: form.category || undefined,
        description: form.description || undefined,
        price: parsedPrice,
        currency: parsedPrice !== undefined ? workspace.currency : undefined,
        unit: priced ? form.unit || undefined : undefined,
        exampleSpec: priced ? form.exampleSpec || undefined : undefined,
        notes: form.notes || undefined,
        tags: form.tags.filter((tag) => tag !== "service"),
        attributes: form.attributes.filter((a) => a.key.trim()),
        requirementFields: priced
          ? form.requirementFields.filter((f) => f.key.trim())
          : [],
        images,
        files,
      };

      if (product) {
        await updateProduct({
          productId: product._id,
          ...payload,
          clearPrice: parsedPrice === undefined && product.price !== undefined,
        });
        toast.add({ title: `${meta.label} updated`, type: "success" });
      } else {
        await createProduct({ workspaceId: workspace._id, ...payload });
        toast.add({ title: `${meta.label} added`, type: "success" });
        setForm(emptyForm(defaultKind));
      }
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Save failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {product ? `Edit ${product.name}` : `Add ${meta.noun}`}
          </DialogTitle>
          <DialogDescription>
            {priced
              ? "Leave the price empty if the team quotes manually — the agent is then told never to quote."
              : "Upload the file agents should send when a customer asks for it."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <ToggleGroup
            value={[form.kind]}
            onValueChange={(value) => {
              const next = value[0] as CatalogueKind | undefined;
              if (next) set("kind", next);
            }}
            className="w-full rounded-lg border p-0.5"
          >
            {CATALOGUE_KINDS.map((kind) => {
              const KindIcon = KINDS[kind].icon;
              return (
                <ToggleGroupItem key={kind} value={kind} className="flex-1">
                  <HugeiconsIcon icon={KindIcon} strokeWidth={2} /> {KINDS[kind].label}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={form.name}
                placeholder={meta.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-category">Category</Label>
              <Input
                id="p-category"
                value={form.category}
                placeholder={meta.category}
                onChange={(event) => set("category", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-description">Description</Label>
            <Textarea
              id="p-description"
              rows={2}
              value={form.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </div>

          {priced ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-sku">SKU</Label>
                <Input
                  id="p-sku"
                  value={form.sku}
                  onChange={(event) => set("sku", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-price">Price ({workspace.currency})</Label>
                <Input
                  id="p-price"
                  value={form.price}
                  placeholder="Leave empty for manual quoting"
                  onChange={(event) => set("price", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-unit">Unit</Label>
                <Input
                  id="p-unit"
                  value={form.unit}
                  placeholder={meta.unit}
                  onChange={(event) => set("unit", event.target.value)}
                />
              </div>
            </div>
          ) : null}

          <Separator />

          <ProductFilesEditor
            value={form.files}
            onChange={(next) => set("files", next)}
            description={
              priced
                ? "Spec sheets, price lists or menus agents can send — PDFs and documents up to 25 MB each."
                : undefined
            }
          />

          <Separator />

          <ProductImagesEditor
            value={form.images}
            onChange={(next) => set("images", next)}
          />

          {priced ? (
            <>
              <Separator />

              <FieldListEditor
                label="Specification questions"
                description={
                  <>
                    The agent is handed this checklist by{" "}
                    <code>get_product_requirements</code> and must collect every
                    required field before it can create an order.
                  </>
                }
                value={form.requirementFields}
                onChange={(next) => set("requirementFields", next)}
              />

              <Separator />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-example">Example specification</Label>
                <Input
                  id="p-example"
                  value={form.exampleSpec}
                  placeholder="A typical specification"
                  onChange={(event) => set("exampleSpec", event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Given to the agent so it can offer a typical spec instead of
                  asking blind.
                </p>
              </div>
            </>
          ) : null}

          <ChipListEditor
            label="Tags"
            value={form.tags}
            onChange={(next) => set("tags", next)}
            placeholder="Tag"
          />

          <KeyValueEditor
            label="Attributes"
            description="Extra facts the agent may state — lead time, minimum order, finish options."
            value={form.attributes}
            onChange={(next) => set("attributes", next)}
            keyPlaceholder="Attribute"
            valuePlaceholder="Value"
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-notes">Internal notes for the agent</Label>
            <Textarea
              id="p-notes"
              rows={2}
              value={form.notes}
              placeholder="Anything the agent should keep in mind"
              onChange={(event) => set("notes", event.target.value)}
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Spinner /> : <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />}{" "}
            {product ? "Save changes" : `Add ${meta.label.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk import + AI draft
// ---------------------------------------------------------------------------

function ImportDialog() {
  const workspace = useWorkspace();
  const bulkImport = useMutation(api.products.bulkImport);
  const draftCatalogue = useAction(api.ai.draftCatalogue);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [brief, setBrief] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    try {
      setParsed(parseProductCsv(await file.text()));
    } catch (error) {
      setParsed(null);
      toast.add({
        title: "Could not read that file",
        description: friendlyError(error),
        type: "error",
      });
    }
  };

  const downloadSample = () =>
    downloadCsv("catalogue-sample.csv", sampleProductCsv());

  const runImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const result = await bulkImport({
        workspaceId: workspace._id,
        products: parsed.products,
      });
      toast.add({
        title: `${result.created} added, ${result.updated} updated`,
        type: "success",
      });
      setParsed(null);
      setFileName("");
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Import failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const runDraft = async () => {
    setBusy(true);
    try {
      const result = await draftCatalogue({
        workspaceId: workspace._id,
        brief: brief || undefined,
      });
      toast.add({
        title: `${result.created} products drafted`,
        description: "Review each one and adjust the spec questions.",
        type: "success",
      });
      setOpen(false);
    } catch (error) {
      toast.add({
        title: "Drafting failed",
        description: friendlyError(error),
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  // A catalogue imported half-right is worse than one not imported at all: the
  // agent starts asking the wrong spec questions. So any issue blocks import.
  const blocked =
    !parsed || parsed.issues.length > 0 || parsed.products.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} /> Import
          </Button>
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Populate the catalogue</DialogTitle>
          <DialogDescription>
            Upload a CSV exported from your own system, or let the model draft a
            starter catalogue from the workspace description.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Tabs defaultValue="draft">
            <TabsList className="w-full">
              <TabsTrigger value="draft">
                <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} /> Draft with AI
              </TabsTrigger>
              <TabsTrigger value="csv">
                <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} /> Import CSV
              </TabsTrigger>
            </TabsList>

            <TabsContent value="draft" className="flex flex-col gap-3 pt-3">
              <Textarea
                rows={4}
                value={brief}
                placeholder="Optional: anything specific about the range"
                onChange={(event) => setBrief(event.target.value)}
              />
              <Button onClick={runDraft} disabled={busy}>
                {busy ? <Spinner /> : <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} />} Draft the catalogue
              </Button>
            </TabsContent>

            <TabsContent value="csv" className="flex flex-col gap-3 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  className="h-auto flex-1 py-1"
                  onChange={(event) => {
                    void readFile(event.target.files?.[0]);
                  }}
                />
                <Button variant="outline" onClick={downloadSample}>
                  <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Sample CSV
                </Button>
              </div>

              <Accordion>
                <AccordionItem value="columns">
                  <AccordionTrigger className="text-sm">
                    Columns, and how spec questions are written
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="mb-2 text-xs text-muted-foreground">
                      One row per spec question. Leave <code>name</code> blank
                      to add another question to the product on the row above; a
                      product with no questions is a single row. Column order
                      does not matter, and extra columns are ignored.
                    </p>
                    <div className="max-h-56 overflow-y-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-36">Column</TableHead>
                            <TableHead>Meaning</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {CSV_COLUMNS.map((column) => (
                            <TableRow key={column.name}>
                              <TableCell className="align-top font-mono text-xs">
                                {column.name}
                                {column.required ? (
                                  <span className="text-destructive"> *</span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {column.detail}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {parsed ? (
                <>
                  {parsed.issues.length > 0 ? (
                    <Alert variant="destructive">
                      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
                      <AlertTitle>
                        {parsed.issues.length}{" "}
                        {parsed.issues.length === 1 ? "problem" : "problems"} in{" "}
                        {fileName}
                      </AlertTitle>
                      <AlertDescription>
                        Fix these and choose the file again. Nothing is imported
                        until the file is clean.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert>
                      <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
                      <AlertTitle>
                        {parsed.products.length}{" "}
                        {parsed.products.length === 1 ? "product" : "products"},{" "}
                        {parsed.fieldCount} spec{" "}
                        {parsed.fieldCount === 1 ? "question" : "questions"}
                      </AlertTitle>
                      <AlertDescription>
                        Matched by name — an existing product with the same name
                        is updated rather than duplicated.
                      </AlertDescription>
                    </Alert>
                  )}

                  {parsed.unknownColumns.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Ignored{" "}
                      {parsed.unknownColumns.length === 1
                        ? "column"
                        : "columns"}
                      :{" "}
                      <span className="font-mono">
                        {parsed.unknownColumns.join(", ")}
                      </span>
                    </p>
                  ) : null}

                  <div className="max-h-56 overflow-y-auto rounded-md border">
                    {parsed.issues.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-14">Line</TableHead>
                            <TableHead className="w-28">Column</TableHead>
                            <TableHead>Problem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsed.issues.slice(0, 50).map((issue, index) => (
                            <TableRow
                              key={`${issue.line}-${issue.column}-${index}`}
                            >
                              <TableCell className="font-mono tabular-nums">
                                {issue.line}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {issue.column}
                              </TableCell>
                              <TableCell className="text-xs">
                                {issue.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Images</TableHead>
                            <TableHead className="text-right">
                              Questions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsed.products.slice(0, 25).map((product) => (
                            <TableRow key={product.name}>
                              <TableCell className="font-medium">
                                {product.name}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {product.category || "General"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {product.price === undefined
                                  ? "—"
                                  : `${product.currency ?? ""} ${product.price}`}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {product.imageUrls?.length ?? 0}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {product.requirementFields?.length ?? 0}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  {parsed.issues.length > 50 ? (
                    <p className="text-xs text-muted-foreground">
                      Showing the first 50 of {parsed.issues.length}.
                    </p>
                  ) : null}
                  {parsed.issues.length === 0 && parsed.products.length > 25 ? (
                    <p className="text-xs text-muted-foreground">
                      Showing the first 25 of {parsed.products.length}.
                    </p>
                  ) : null}
                </>
              ) : null}

              <Button onClick={runImport} disabled={busy || blocked}>
                {busy ? <Spinner /> : <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} />}{" "}
                {parsed &&
                parsed.issues.length === 0 &&
                parsed.products.length > 0
                  ? `Import ${parsed.products.length} ${parsed.products.length === 1 ? "product" : "products"}`
                  : "Import"}
              </Button>
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

function TabCount({ value }: { value: number | undefined }) {
  if (!value) return null;
  return (
    <span className="text-xs tabular-nums text-muted-foreground">{value}</span>
  );
}

function ProductFileLinks({
  files,
}: {
  files: CatalogueProduct["resolvedFiles"];
}) {
  if (files.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {files.slice(0, 2).map((file) => (
        <a
          key={file.url}
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1.5 text-xs hover:underline"
        >
          <FileGlyph filename={file.filename} />
          <span className="truncate">{file.filename}</span>
        </a>
      ))}
      {files.length > 2 ? (
        <span className="text-xs text-muted-foreground">
          +{files.length - 2} more
        </span>
      ) : null}
    </div>
  );
}

export default function ProductsPage() {
  const workspace = useWorkspace();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [tab, setTab] = useState<"all" | CatalogueKind>("all");
  const addKind: CatalogueKind = tab === "all" ? "product" : tab;

  const products = useQuery(api.products.listByWorkspace, {
    workspaceId: workspace._id,
    search: search.trim() || undefined,
    category: category === "all" ? undefined : category,
    kind: tab === "all" ? undefined : tab,
  });
  const counts = useQuery(api.products.kindCounts, {
    workspaceId: workspace._id,
  });
  const total = counts
    ? CATALOGUE_KINDS.reduce((sum, kind) => sum + counts[kind], 0)
    : undefined;
  const addButton = (
    <ProductDialog
      key={addKind}
      defaultKind={addKind}
      trigger={
        <Button>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} /> Add {KINDS[addKind].label.toLowerCase()}
        </Button>
      }
    />
  );
  const categories = useQuery(api.products.categories, {
    workspaceId: workspace._id,
  });
  const removeProduct = useMutation(api.products.remove);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Catalogue
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Products, services and brochures agents may discuss and send, and
            what they must collect.
          </p>
        </div>
        <div className="flex gap-2">
          <ImportDialog />
          {addButton}
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "all" | CatalogueKind)}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="all">
            All
            <TabCount value={total} />
          </TabsTrigger>
          {CATALOGUE_KINDS.map((kind) => {
            const KindIcon = KINDS[kind].icon;
            return (
              <TabsTrigger key={kind} value={kind}>
                <HugeiconsIcon icon={KindIcon} strokeWidth={2} /> {KINDS[kind].plural}
                <TabCount value={counts?.[kind]} />
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search the catalogue…"
            className="pl-7"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <SelectField
          value={category}
          aria-label="Filter by category"
          onValueChange={setCategory}
          options={[
            { value: "all", label: "All categories" },
            ...(categories ?? []).map((name) => ({
              value: name,
              label: name,
            })),
          ]}
        />
      </div>

      {products === undefined ? (
        <TableSkeleton rows={8} columns={5} />
      ) : products.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={PackageIcon} strokeWidth={2} />
            </EmptyMedia>
            <EmptyTitle>
              {search
                ? "Nothing matches"
                : tab === "all"
                  ? "The catalogue is empty"
                  : `No ${KINDS[tab].plural.toLowerCase()} yet`}
            </EmptyTitle>
            <EmptyDescription>
              {search
                ? "Try a different search term."
                : tab === "brochure" || tab === "other"
                  ? "Upload brochures, price lists and other documents, and agents can send them when a customer asks."
                  : "Agents refuse to discuss products that aren't listed here. Add them manually, import a CSV, or let the model draft a starter set."}
            </EmptyDescription>
          </EmptyHeader>
          {!search ? (
            <EmptyContent>
              <div className="flex gap-2">
                <ImportDialog />
                {addButton}
              </div>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="hidden md:table-cell">Files</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product._id}>
                  {/* Bounded, so line-clamp-1 has something to clamp against:
                      an unbounded cell sizes to the description's full single
                      line and pushes every later column off-screen. */}
                  <TableCell className="max-w-md min-w-0">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProductThumbnail
                        url={product.resolvedImages[0]?.url}
                        alt={product.resolvedImages[0]?.alt ?? product.name}
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium">
                            {product.name}
                          </span>
                          {tab === "all" && product.kind !== "product" ? (
                            <Badge variant="outline" className="font-normal">
                              {KINDS[product.kind].label}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {product.description || "No description"}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{product.category}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {!isOrderable(product.kind) ? (
                      <span className="text-muted-foreground">—</span>
                    ) : product.price !== undefined ? (
                      <span>
                        {product.currency ?? workspace.currency}{" "}
                        {product.price.toFixed(2)}
                        {product.unit ? (
                          <span className="text-muted-foreground">
                            {" "}
                            {product.unit}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      // Not "quoted" — that is also an order status, so it
                      // reads as state rather than a price.
                      <span className="text-muted-foreground">On request</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-56 md:table-cell">
                    <ProductFileLinks files={product.resolvedFiles} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <ProductDialog
                        product={product}
                        trigger={
                          <Button
                            size="icon-lg"
                            variant="ghost"
                            aria-label={`Edit ${product.name}`}
                          >
                            <HugeiconsIcon icon={PencilEdit02Icon} strokeWidth={2} />
                          </Button>
                        }
                      />
                      <Button
                        size="icon-lg"
                        variant="ghost"
                        aria-label={`Delete ${product.name}`}
                        onClick={async () => {
                          await removeProduct({
                            productId: product._id as Id<"products">,
                          });
                          toast.add({
                            title: `${KINDS[product.kind].label} deleted`,
                            type: "success",
                          });
                        }}
                      >
                        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

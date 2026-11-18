/**
 * Files handed to a tool either as a public address or as base64 bytes.
 */

import { z } from "zod";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const fileSourceArgs = {
  url: z.string().optional().describe("Public address of the file to download"),
  contentBase64: z
    .string()
    .optional()
    .describe("The file's bytes, base64-encoded. Only for small files; use create_upload_url for anything over a few KB."),
  fileKey: z
    .string()
    .optional()
    .describe("The fileKey from create_upload_url, after the file has been PUT to its uploadUrl"),
  filename: z
    .string()
    .optional()
    .describe("e.g. 'Brochure 2026.pdf'. Required with contentBase64 or fileKey; defaults to the URL's last segment."),
};

export function guessMime(filename, given) {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const known = MIME_BY_EXTENSION[extension];
  if (known) return known;
  if (given && given !== "application/octet-stream") return given.split(";")[0].trim();
  return undefined;
}

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

function filenameFrom(response, url) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  if (quoted) return decoded(quoted[1]);
  const last = new URL(url).pathname.split("/").filter(Boolean).pop();
  return last ? decoded(last) : "file";
}

function checkSize(bytes, filename) {
  if (bytes.byteLength === 0) throw new Error(`${filename} is empty.`);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`${filename} is over 25 MB.`);
}

/**
 * A file already uploaded through create_upload_url comes back with its
 * fileKey and no bytes.
 *
 * @param {{ url?: string, contentBase64?: string, fileKey?: string, filename?: string }} file
 * @returns {Promise<{ bytes?: Uint8Array, fileKey?: string, filename: string, mimeType: string | undefined }>}
 */
export async function loadFile({ url, contentBase64, fileKey, filename }) {
  if ([url, contentBase64, fileKey].filter(Boolean).length !== 1) {
    throw new Error("Pass exactly one of url, contentBase64 or fileKey for each file.");
  }
  let name = filename?.trim();

  if (fileKey) {
    if (!name) throw new Error("filename is required with fileKey.");
    return { fileKey: fileKey.trim(), filename: name, mimeType: guessMime(name) };
  }

  if (contentBase64) {
    if (!name) throw new Error("filename is required with contentBase64.");
    const bytes = new Uint8Array(Buffer.from(contentBase64.replace(/^data:[^,]*,/, ""), "base64"));
    checkSize(bytes, name);
    return { bytes, filename: name, mimeType: guessMime(name) };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetching ${url} returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  name ||= filenameFrom(response, url);
  checkSize(bytes, name);
  return { bytes, filename: name, mimeType: guessMime(name, response.headers.get("content-type")) };
}

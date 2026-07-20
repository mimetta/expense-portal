"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolveFileUrl } from "@/components/shared/RequestForm";
import type { FileEntry } from "@/types/database";

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNERS: { key: Corner; label: string }[] = [
  { key: "top-left", label: "Top-Left" },
  { key: "top-right", label: "Top-Right" },
  { key: "bottom-left", label: "Bottom-Left" },
  { key: "bottom-right", label: "Bottom-Right" },
];

const PAD_WIDTH = 400;
const PAD_HEIGHT = 120;
const SIGNATURE_MARGIN = 20;
// Signature width as a fraction of the page canvas width — resolution
// -independent, so the same placement (xFrac/yFrac) looks identical on the
// low-res preview canvas and the high-res export canvas.
const SIGNATURE_WIDTH_FRACTION = 0.35;
const SIGNATURE_MAX_WIDTH = 180;

interface Placement {
  xFrac: number;
  yFrac: number;
}

interface PDFSignerProps {
  file: FileEntry;
  onSaved: (entry: FileEntry) => void;
  onCancel: () => void;
}

// pdfjs-dist is pinned to 3.11.174 (package.json) specifically so this
// worker version always matches the API version — pdf.js hard-errors if
// they drift apart.
async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return pdfjsLib;
}

function signedFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, "");
  return `${base}_SIGNED.pdf`;
}

function signatureBoxSize(canvasWidth: number, img: HTMLImageElement) {
  const w = Math.min(SIGNATURE_MAX_WIDTH, canvasWidth * SIGNATURE_WIDTH_FRACTION);
  const h = w * (img.height / img.width);
  return { w, h };
}

function cornerPlacement(corner: Corner, canvasWidth: number, canvasHeight: number, img: HTMLImageElement): Placement {
  const { w, h } = signatureBoxSize(canvasWidth, img);
  const x = corner === "top-left" || corner === "bottom-left" ? SIGNATURE_MARGIN : canvasWidth - w - SIGNATURE_MARGIN;
  const y = corner === "top-left" || corner === "top-right" ? SIGNATURE_MARGIN : canvasHeight - h - SIGNATURE_MARGIN;
  return { xFrac: x / canvasWidth, yFrac: y / canvasHeight };
}

// Draws an already-loaded signature image onto a rendered page canvas at a
// given fractional position. Synchronous (the image is decoded once, up
// front, and reused for every redraw — including on every drag-move tick —
// rather than re-decoding a data URL each time).
function drawSignatureImage(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  img: HTMLImageElement,
  placement: Placement,
) {
  const { w, h } = signatureBoxSize(canvasWidth, img);
  ctx.drawImage(img, placement.xFrac * canvasWidth, placement.yFrac * canvasHeight, w, h);
}

function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load signature image"));
    img.src = dataUrl;
  });
}

export default function PDFSigner({ file, onSaved, onCancel }: PDFSignerProps) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Falls back to file.url until resolved — only used for the "download
  // separately" link shown alongside loadError, so a brief stale value
  // before resolution finishes is harmless.
  const [resolvedUrl, setResolvedUrl] = useState(file.url);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);

  // Position only — the decoded signature image itself lives in
  // sigImageCacheRef (a ref, not state) since it's mutable/non-serializable
  // and doesn't need to trigger re-renders on its own.
  const [placedSignatures, setPlacedSignatures] = useState<Record<number, Placement>>({});
  const [selectedCorner, setSelectedCorner] = useState<Corner>("bottom-right");
  const [hasDrawnSig, setHasDrawnSig] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const padCanvasRef = useRef<HTMLCanvasElement>(null);
  const padDrawingRef = useRef(false);

  // One decoded signature <img> per page (a page can carry a different
  // signature drawing than another, though usually the same one).
  const sigImageCacheRef = useRef<Map<number, HTMLImageElement>>(new Map());
  // The plain page raster (no signature) per page, captured right after
  // pdf.js renders it — lets drag-move redraws skip re-invoking pdf.js
  // (which is async and comparatively slow) on every pointer-move event.
  const pageRasterCacheRef = useRef<Map<number, ImageData>>(new Map());

  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });

  // Load the PDF. Fetched as a blob first rather than handed straight to
  // pdf.js — pdf.js's own range-request fetching can fail on files served
  // with restrictive CORS headers, so this reads the whole file up front
  // instead. `resolveFileUrl` re-signs the file's URL first when it has a
  // `path` (private "attachments" bucket) — the stored `url` is only valid
  // for 7 days from upload (see app/api/upload/route.ts), and signing can
  // happen well after that (e.g. a request sitting at BO_APPROVED for a
  // while before the CEO signs it).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const pdfjsLib = await loadPdfjs();
        const url = await resolveFileUrl(file);
        if (!cancelled) setResolvedUrl(url);
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const buf = await res.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNum(1);
      } catch {
        if (!cancelled) {
          setLoadError("ไม่สามารถโหลด PDF ได้ กรุณาดาวน์โหลดและเซ็นแยก");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.url]);

  // Redraws the current page from the cached raster (if any) plus its
  // signature overlay (if placed) — no pdf.js call, safe to run on every
  // drag-move tick.
  const redrawFromCache = (page: number) => {
    const canvas = pageCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const raster = pageRasterCacheRef.current.get(page);
    if (!canvas || !ctx || !raster) return;
    ctx.putImageData(raster, 0, 0);
    const placement = placedSignatures[page];
    const img = sigImageCacheRef.current.get(page);
    if (placement && img) {
      drawSignatureImage(ctx, canvas.width, canvas.height, img, placement);
    }
  };

  // Renders the current page via pdf.js and caches the plain raster.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = pageCanvasRef.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (cancelled) return;
      pageRasterCacheRef.current.set(pageNum, ctx.getImageData(0, 0, canvas.width, canvas.height));
      redrawFromCache(pageNum);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, pageNum]);

  // Redraws (cheaply, from the raster cache) whenever a placement changes —
  // covers both a fresh placement and every tick of a drag.
  useEffect(() => {
    if (pageRasterCacheRef.current.has(pageNum)) {
      redrawFromCache(pageNum);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedSignatures]);

  // Signature pad setup (white bg, dark pen) — separate from the page
  // preview canvas above.
  useEffect(() => {
    const canvas = padCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#1A1A1A";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPadPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = padCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in e ? e.touches[0] ?? e.changedTouches[0] : e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startPadDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const ctx = padCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    padDrawingRef.current = true;
    setHasDrawnSig(true);
    const { x, y } = getPadPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const padDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!padDrawingRef.current) return;
    e.preventDefault();
    const ctx = padCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPadPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const stopPadDraw = () => {
    padDrawingRef.current = false;
  };
  const clearPad = () => {
    const canvas = padCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasDrawnSig(false);
  };

  // Snaps whatever's already placed on this page to a corner; if nothing's
  // placed yet, just remembers the choice for the next "Place Signature"
  // click (the highlighted button).
  const selectCorner = (corner: Corner) => {
    setSelectedCorner(corner);
    const canvas = pageCanvasRef.current;
    const img = sigImageCacheRef.current.get(pageNum);
    if (!canvas || !img) return;
    setPlacedSignatures((prev) => ({
      ...prev,
      [pageNum]: cornerPlacement(corner, canvas.width, canvas.height, img),
    }));
  };

  // Commits the pad's current drawing onto the page at `selectedCorner`
  // (decoding + caching the image if this page doesn't have one cached
  // yet). Re-clicking after redrawing the pad replaces the cached image.
  const placeSignature = async () => {
    const padCanvas = padCanvasRef.current;
    const pageCanvas = pageCanvasRef.current;
    if (!padCanvas || !pageCanvas || !hasDrawnSig) return;
    try {
      const img = await decodeImage(padCanvas.toDataURL("image/png"));
      sigImageCacheRef.current.set(pageNum, img);
      setPlacedSignatures((prev) => ({
        ...prev,
        [pageNum]: cornerPlacement(selectedCorner, pageCanvas.width, pageCanvas.height, img),
      }));
    } catch {
      setSaveError("Failed to place signature");
    }
  };

  // --- Drag-to-reposition on the page preview -----------------------------

  const getPageCanvasPoint = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = pageCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const point = "touches" in e ? e.touches[0] ?? e.changedTouches[0] : e;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const currentSignatureBox = () => {
    const canvas = pageCanvasRef.current;
    const placement = placedSignatures[pageNum];
    const img = sigImageCacheRef.current.get(pageNum);
    if (!canvas || !placement || !img) return null;
    const { w, h } = signatureBoxSize(canvas.width, img);
    return { x: placement.xFrac * canvas.width, y: placement.yFrac * canvas.height, w, h };
  };

  const handlePreviewDown = (e: React.MouseEvent | React.TouchEvent) => {
    const box = currentSignatureBox();
    if (!box) return;
    const { x, y } = getPageCanvasPoint(e);
    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
      e.preventDefault();
      draggingRef.current = true;
      dragOffsetRef.current = { dx: x - box.x, dy: y - box.y };
    }
  };

  const handlePreviewMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    const canvas = pageCanvasRef.current;
    const box = currentSignatureBox();
    if (!canvas || !box) return;
    const { x, y } = getPageCanvasPoint(e);
    const newX = Math.max(0, Math.min(canvas.width - box.w, x - dragOffsetRef.current.dx));
    const newY = Math.max(0, Math.min(canvas.height - box.h, y - dragOffsetRef.current.dy));
    setPlacedSignatures((prev) => ({
      ...prev,
      [pageNum]: { xFrac: newX / canvas.width, yFrac: newY / canvas.height },
    }));
  };

  const handlePreviewUp = () => {
    draggingRef.current = false;
  };

  const canDragOnCurrentPage = Boolean(placedSignatures[pageNum] && sigImageCacheRef.current.get(pageNum));

  // --- Export ---------------------------------------------------------

  const handleSaveSignedPdf = async () => {
    if (!pdfDoc || Object.keys(placedSignatures).length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { jsPDF } = await import("jspdf");
      let doc: import("jspdf").jsPDF | null = null;

      for (let p = 1; p <= numPages; p++) {
        const page = await pdfDoc.getPage(p);
        const renderViewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = renderViewport.width;
        canvas.height = renderViewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

        const placement = placedSignatures[p];
        const img = sigImageCacheRef.current.get(p);
        if (placement && img) {
          drawSignatureImage(ctx, canvas.width, canvas.height, img, placement);
        }

        const imgData = canvas.toDataURL("image/jpeg", 0.85);
        const ptViewport = page.getViewport({ scale: 1 });
        if (!doc) {
          doc = new jsPDF({ unit: "pt", format: [ptViewport.width, ptViewport.height] });
        } else {
          doc.addPage([ptViewport.width, ptViewport.height]);
        }
        doc.addImage(imgData, "JPEG", 0, 0, ptViewport.width, ptViewport.height);
      }
      if (!doc) throw new Error("No pages to save");

      const blob = doc.output("blob");
      const name = signedFileName(file.name);
      const formData = new FormData();
      formData.append("file", blob, name);
      formData.append("bucket", "signed-documents");
      formData.append("filename", name);

      const res = await fetch("/api/storage/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error([body.error, body.hint].filter(Boolean).join(" — ") || "Failed to upload signed PDF");
      }
      const { url } = await res.json();
      onSaved({ name, url, doc_type: "Signed Document" });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save signed PDF");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-md border border-brand-border bg-white p-3 text-sm text-brand-muted">
        Loading PDF...
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-brand-border bg-white p-3">
        <p className="text-sm text-red-600">{loadError}</p>
        <div className="mt-2 flex gap-2">
          <a
            href={resolvedUrl}
            download={file.name}
            className="rounded-md border border-brand-border px-3 py-1.5 text-sm hover:bg-[#F9F8F6]"
          >
            ดาวน์โหลด
          </a>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-brand-border px-3 py-1.5 text-sm hover:bg-[#F9F8F6]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-brand-border bg-white p-3">
      <div className="mb-2 flex items-center justify-center gap-3 text-sm text-brand-dark">
        <button
          type="button"
          disabled={pageNum <= 1}
          onClick={() => setPageNum((p) => p - 1)}
          className="disabled:opacity-30"
        >
          ◀
        </button>
        <span>
          Page {pageNum} of {numPages}
        </span>
        <button
          type="button"
          disabled={pageNum >= numPages}
          onClick={() => setPageNum((p) => p + 1)}
          className="disabled:opacity-30"
        >
          ▶
        </button>
      </div>

      <div className="flex justify-center overflow-auto rounded-md border border-brand-border bg-[#F9F8F6] p-2">
        <canvas
          ref={pageCanvasRef}
          className={`max-w-full touch-none ${canDragOnCurrentPage ? "cursor-move" : ""}`}
          onMouseDown={handlePreviewDown}
          onMouseMove={handlePreviewMove}
          onMouseUp={handlePreviewUp}
          onMouseLeave={handlePreviewUp}
          onTouchStart={handlePreviewDown}
          onTouchMove={handlePreviewMove}
          onTouchEnd={handlePreviewUp}
        />
      </div>
      {canDragOnCurrentPage && (
        <p className="mt-1 text-center text-[11px] text-brand-subtle">
          Drag the signature on the page to fine-tune its position
        </p>
      )}

      <div className="relative mt-3">
        <canvas
          ref={padCanvasRef}
          width={PAD_WIDTH}
          height={PAD_HEIGHT}
          className="w-full max-w-[400px] touch-none rounded-md border border-brand-border bg-white"
          onMouseDown={startPadDraw}
          onMouseMove={padDraw}
          onMouseUp={stopPadDraw}
          onMouseLeave={stopPadDraw}
          onTouchStart={startPadDraw}
          onTouchMove={padDraw}
          onTouchEnd={stopPadDraw}
        />
        <div
          className={`pointer-events-none absolute inset-0 flex max-w-[400px] items-center justify-center text-xs text-brand-subtle transition-opacity duration-300 ${
            hasDrawnSig ? "opacity-0" : "opacity-100"
          }`}
        >
          Draw your signature here
        </div>
      </div>
      <button
        type="button"
        onClick={clearPad}
        className="mt-2 rounded-md border border-brand-border px-3 py-1.5 text-sm hover:bg-[#F9F8F6]"
      >
        Clear
      </button>

      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-brand-muted">
          Signature position — pick a corner, or drag it on the page above once placed
        </p>
        <div className="flex flex-wrap gap-2">
          {CORNERS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => selectCorner(c.key)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                selectedCorner === c.key
                  ? "border-brand-brown bg-brand-brown text-white"
                  : "border-brand-border text-brand-dark hover:bg-[#F9F8F6]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!hasDrawnSig}
          onClick={placeSignature}
          className="rounded-md border border-brand-brown px-3 py-1.5 text-sm font-medium text-brand-brown hover:bg-[#F9F8F6] disabled:opacity-40"
        >
          Place Signature
        </button>
        <button
          type="button"
          disabled={Object.keys(placedSignatures).length === 0 || saving}
          onClick={handleSaveSignedPdf}
          className="rounded-md bg-brand-brown px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-accent disabled:opacity-40"
        >
          {saving ? "Saving..." : "Save Signed PDF"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-brand-border px-3 py-1.5 text-sm hover:bg-[#F9F8F6]"
        >
          Cancel
        </button>
      </div>
      {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
    </div>
  );
}

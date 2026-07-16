"use client";

import { useRef, useState } from "react";
import type { FileEntry } from "@/types/database";

// A small canvas signature pad for the print view's three signature boxes
// (Requester / Approver / Accounting) — see app/print/[id]/page.tsx.
//
// This is a NEW component, not a reuse of the deleted components/shared/
// SignaturePad.tsx (see CLAUDE.md "PDF document signing" — that file was
// removed when PDFSigner.tsx replaced it with real per-PDF signing). The
// print view isn't a PDF, so PDFSigner's page-rendering approach doesn't
// apply here; this is a plain canvas -> PNG -> Storage upload, closer in
// spirit to what SignaturePad.tsx used to do, rebuilt fresh for this
// specific box-shaped use case.
const SIG_WIDTH = 300;
const SIG_HEIGHT = 100;

function pointerPos(canvas: HTMLCanvasElement, e: React.MouseEvent | React.TouchEvent) {
  const rect = canvas.getBoundingClientRect();
  const point = "touches" in e ? e.touches[0] ?? e.changedTouches[0] : e;
  return { x: point.clientX - rect.left, y: point.clientY - rect.top };
}

export default function PrintSignaturePad({
  boxKey,
  onSaved,
}: {
  boxKey: "requester" | "approver" | "accounting";
  onSaved: (entry: FileEntry) => Promise<void> | void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(canvas, e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !drawingRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { x, y } = pointerPos(canvas, e);
    ctx.strokeStyle = "#1E1E1E";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const end = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to export signature"))), "image/png"),
      );
      const filename = `signature_${boxKey}_${Date.now()}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      const formData = new FormData();
      // Dedicated "signatures" bucket (image/png-only) — the existing
      // "signed-documents" bucket is scoped to application/pdf only (see
      // CLAUDE.md "PDF document signing"), which is exactly why this was
      // failing with "mime type image/png is not supported": Supabase
      // Storage itself was rejecting the upload, not a Blob-vs-base64
      // issue on the client (this already sent a real Blob/File before).
      formData.append("file", file, filename);
      formData.append("filename", filename);
      formData.append("bucket", "signatures");
      const res = await fetch("/api/storage/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to upload signature");
      }
      const body = await res.json();
      await onSaved({ name: filename, url: body.url, size: blob.size, doc_type: "Signature" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <canvas
        ref={canvasRef}
        width={SIG_WIDTH}
        height={SIG_HEIGHT}
        className="cursor-crosshair rounded border border-dashed border-brand-border bg-white"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-1.5 flex gap-2 print:hidden">
        <button type="button" onClick={clear} className="mm-btn-secondary mm-btn-sm">
          Clear
        </button>
        <button type="button" onClick={save} disabled={busy || !hasDrawn} className="mm-btn-primary mm-btn-sm">
          {busy ? "Saving..." : "Save Signature"}
        </button>
      </div>
    </div>
  );
}

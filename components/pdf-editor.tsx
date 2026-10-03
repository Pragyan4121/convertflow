"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  degrees,
  PDFDocument,
  rgb,
  StandardFonts,
  type PDFFont,
} from "pdf-lib";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";

type Tool = "select" | "text" | "highlight" | "whiteout" | "draw";

type TextAlign = "left" | "center" | "right";
type FontFamily = "Helvetica" | "Times" | "Courier";

type PageModel = {
  id: string;
  sourcePageNumber: number;
  baseRotation: number;
  rotationDelta: number;
  width: number;
  height: number;
  thumbnail: string;
};

type TextElement = {
  id: string;
  type: "text";
  pageId: string;
  source: "existing" | "added";
  originalText: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: FontFamily;
  bold: boolean;
  italic: boolean;
  color: string;
  align: TextAlign;
  modified: boolean;
};

type RectElement = {
  id: string;
  type: "highlight" | "whiteout";
  pageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
};

type InkElement = {
  id: string;
  type: "ink";
  pageId: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
};

type ImageElement = {
  id: string;
  type: "image";
  pageId: string;
  kind: "image" | "signature";
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg";
  x: number;
  y: number;
  width: number;
  height: number;
};

type EditorElement = TextElement | RectElement | InkElement | ImageElement;

type Snapshot = {
  pages: PageModel[];
  elements: EditorElement[];
};

type DragState = {
  elementId: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

type GestureState =
  | {
      kind: "rect";
      tool: "highlight" | "whiteout";
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    }
  | {
      kind: "ink";
      points: Array<{ x: number; y: number }>;
    }
  | null;

type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFileHandle>;
};

type RawTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const HISTORY_LIMIT = 40;

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((pdfjs) => {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }

      return pdfjs;
    });
  }

  return pdfJsPromise;
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeRotation(value: number) {
  return ((value % 360) + 360) % 360;
}

function safeFilename(value: string) {
  const cleaned = value
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "");

  return cleaned || "Edited-PDF";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  if (typeof structuredClone === "function") {
    return structuredClone(snapshot);
  }

  return JSON.parse(JSON.stringify(snapshot)) as Snapshot;
}

function fontFamilyFromName(fontName: string): FontFamily {
  const normalized = fontName.toLowerCase();

  if (normalized.includes("times") || normalized.includes("serif")) {
    return "Times";
  }

  if (normalized.includes("courier") || normalized.includes("mono")) {
    return "Courier";
  }

  return "Helvetica";
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim();
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => part + part)
          .join("")
      : normalized.padEnd(6, "0").slice(0, 6);

  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
}

function dataUrlToBytes(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const base64 = dataUrl.slice(comma + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded."));
    image.src = url;
  });
}

function getCssFontFamily(fontFamily: FontFamily) {
  if (fontFamily === "Times") return '"Times New Roman", Times, serif';
  if (fontFamily === "Courier") return '"Courier New", Courier, monospace';
  return "Arial, Helvetica, sans-serif";
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const words = paragraph.split(/\s+/).filter(Boolean);

    if (words.length === 0) {
      lines.push("");
      return;
    }

    let current = words[0];

    for (let index = 1; index < words.length; index++) {
      const test = `${current} ${words[index]}`;

      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        current = test;
      } else {
        lines.push(current);
        current = words[index];
      }
    }

    lines.push(current);

    if (paragraphIndex < paragraphs.length - 1 && paragraph === "") {
      lines.push("");
    }
  });

  return lines;
}

function groupTextItems(items: RawTextItem[], pageId: string): TextElement[] {
  const sorted = [...items].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > Math.max(a.fontSize, b.fontSize) * 0.55) {
      return yDiff;
    }
    return a.x - b.x;
  });

  const rows: RawTextItem[][] = [];

  for (const item of sorted) {
    if (!item.str.trim()) continue;

    let target: RawTextItem[] | undefined;

    for (const row of rows) {
      const first = row[0];
      const tolerance = Math.max(
        2.5,
        Math.max(first.fontSize, item.fontSize) * 0.5,
      );

      if (Math.abs(first.y - item.y) <= tolerance) {
        target = row;
        break;
      }
    }

    if (target) {
      target.push(item);
    } else {
      rows.push([item]);
    }
  }

  return rows.flatMap((row) => {
    row.sort((a, b) => a.x - b.x);

    const chunks: RawTextItem[][] = [];
    let current: RawTextItem[] = [];

    row.forEach((item) => {
      if (current.length === 0) {
        current = [item];
        return;
      }

      const previous = current[current.length - 1];
      const previousRight = previous.x + previous.width;
      const gap = item.x - previousRight;
      const threshold = Math.max(previous.fontSize, item.fontSize) * 3.2;

      if (gap <= threshold) {
        current.push(item);
      } else {
        chunks.push(current);
        current = [item];
      }
    });

    if (current.length) chunks.push(current);

    return chunks.map((chunk) => {
      const first = chunk[0];
      const minX = Math.min(...chunk.map((item) => item.x));
      const minY = Math.min(...chunk.map((item) => item.y));
      const maxRight = Math.max(...chunk.map((item) => item.x + item.width));
      const maxBottom = Math.max(...chunk.map((item) => item.y + item.height));
      const fontName = first.fontName.toLowerCase();
      const text = chunk
        .map((item, index) => {
          if (index === 0) return item.str;
          const previous = chunk[index - 1];
          const gap = item.x - (previous.x + previous.width);
          return gap > Math.max(1.5, first.fontSize * 0.12)
            ? ` ${item.str}`
            : item.str;
        })
        .join("");

      return {
        id: createId(),
        type: "text" as const,
        pageId,
        source: "existing" as const,
        originalText: text,
        text,
        x: minX,
        y: minY,
        width: Math.max(12, maxRight - minX),
        height: Math.max(first.fontSize * 1.2, maxBottom - minY),
        fontSize: Math.max(6, first.fontSize),
        fontFamily: fontFamilyFromName(first.fontName),
        bold: fontName.includes("bold"),
        italic: fontName.includes("italic") || fontName.includes("oblique"),
        color: "#111111",
        align: "left" as const,
        modified: false,
      };
    });
  });
}

async function makeThumbnail(page: PDFPageProxy, rotation: number) {
  const baseViewport = page.getViewport({ scale: 1, rotation });
  const scale = Math.min(0.38, 190 / Math.max(1, baseViewport.width));
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Your browser could not create a PDF preview.");
  }

  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    background: "rgb(255,255,255)",
  }).promise;

  return canvas.toDataURL("image/jpeg", 0.72);
}

async function savePdfBlob(blob: Blob, filename: string) {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;

  if (picker) {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "PDF document",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "completed" as const;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return "cancelled" as const;
      }
    }
  }

  const file = new File([blob], filename, { type: "application/pdf" });

  if (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "completed" as const;
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return "cancelled" as const;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return "completed" as const;
}

function PdfCanvas({
  pdf,
  page,
  zoom,
}: {
  pdf: PDFDocumentProxy;
  page: PageModel;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null =
      null;

    void (async () => {
      const pdfPage = await pdf.getPage(page.sourcePageNumber);
      if (cancelled) return;

      const rotation = normalizeRotation(
        page.baseRotation + page.rotationDelta,
      );
      const viewport = pdfPage.getViewport({ scale: zoom, rotation });
      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;

      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      canvas.style.width = `${page.width * zoom}px`;
      canvas.style.height = `${page.height * zoom}px`;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      renderTask = pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        background: "rgb(255,255,255)",
      });

      try {
        await renderTask.promise;
      } catch (caught) {
        if (!cancelled) console.error("PDF page render error:", caught);
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [
    pdf,
    page.sourcePageNumber,
    page.baseRotation,
    page.rotationDelta,
    page.width,
    page.height,
    zoom,
  ]);

  return <canvas ref={canvasRef} className="block" />;
}

export function PdfEditor() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const signatureInputRef = useRef<HTMLInputElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const sourceBytesRef = useRef<Uint8Array | null>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const textEditHistoryRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageModel[]>([]);
  const [elements, setElements] = useState<EditorElement[]>([]);
  const [activePageId, setActivePageId] = useState("");
  const [selectedElementId, setSelectedElementId] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(1);
  const [filename, setFilename] = useState("Edited-PDF");
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [error, setError] = useState("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "completed">(
    "idle",
  );
  const [historyTick, setHistoryTick] = useState(0);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [gesture, setGesture] = useState<GestureState>(null);

  const activePage = useMemo(
    () => pages.find((page) => page.id === activePageId) ?? pages[0],
    [pages, activePageId],
  );

  const activeElements = useMemo(
    () => elements.filter((element) => element.pageId === activePage?.id),
    [elements, activePage?.id],
  );

  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedElementId),
    [elements, selectedElementId],
  );

  function invalidateOutput() {
    setOutputBlob(null);
    setSaveStatus("idle");
  }

  function recordHistory() {
    const snapshot = cloneSnapshot({ pages, elements });
    historyRef.current.push(snapshot);

    if (historyRef.current.length > HISTORY_LIMIT) {
      historyRef.current.shift();
    }

    redoRef.current = [];
    setUndoCount(historyRef.current.length);
    setRedoCount(0);
    setHistoryTick((value) => value + 1);
  }

  function restoreSnapshot(snapshot: Snapshot) {
    setPages(cloneSnapshot(snapshot).pages);
    setElements(cloneSnapshot(snapshot).elements);
    setSelectedElementId("");
    invalidateOutput();
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;

    redoRef.current.push(cloneSnapshot({ pages, elements }));
    restoreSnapshot(previous);
    setUndoCount(historyRef.current.length);
    setRedoCount(redoRef.current.length);
    setHistoryTick((value) => value + 1);
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;

    historyRef.current.push(cloneSnapshot({ pages, elements }));
    restoreSnapshot(next);
    setUndoCount(historyRef.current.length);
    setRedoCount(redoRef.current.length);
    setHistoryTick((value) => value + 1);
  }

  useEffect(() => {
    return () => {
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      pdfRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!dragState) return;

    const activeDrag = dragState;

    function handleMove(event: PointerEvent) {
      const dx = (event.clientX - activeDrag.startClientX) / zoom;
      const dy = (event.clientY - activeDrag.startClientY) / zoom;

      setElements((current) =>
        current.map((element) => {
          if (element.id !== activeDrag.elementId || element.type === "ink") {
            return element;
          }

          if (activeDrag.mode === "move") {
            return {
              ...element,
              x: Math.max(0, activeDrag.startX + dx),
              y: Math.max(0, activeDrag.startY + dy),
            };
          }

          return {
            ...element,
            width: Math.max(18, activeDrag.startWidth + dx),
            height: Math.max(12, activeDrag.startHeight + dy),
          };
        }),
      );

      invalidateOutput();
    }

    function handleUp() {
      setDragState(null);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragState, zoom]);

  async function loadPdf(nextFile: File) {
    if (
      nextFile.type !== "application/pdf" &&
      !nextFile.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Please select a PDF file.");
      return;
    }

    if (nextFile.size === 0 || nextFile.size > MAX_FILE_SIZE) {
      setError("Please use a PDF up to 100 MB.");
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      setProgressText("Opening PDF...");

      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      pdfRef.current = null;
      setPdfDocument(null);

      const buffer = await nextFile.arrayBuffer();
      const sourceBytes = new Uint8Array(buffer.slice(0));
      const pdfData = new Uint8Array(buffer.slice(0));
      sourceBytesRef.current = sourceBytes;

      const pdfjs = await getPdfJs();
      const loadingTask = pdfjs.getDocument({ data: pdfData });
      loadingTaskRef.current = loadingTask;
      const pdf = await loadingTask.promise;
      pdfRef.current = pdf;
      setPdfDocument(pdf);

      const nextPages: PageModel[] = [];
      const nextElements: EditorElement[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setProgressText(`Reading page ${pageNumber} of ${pdf.numPages}...`);

        const pdfPage = await pdf.getPage(pageNumber);
        const rotation = normalizeRotation(pdfPage.rotate);
        const viewport = pdfPage.getViewport({ scale: 1, rotation });
        const pageId = createId();
        const thumbnail = await makeThumbnail(pdfPage, rotation);
        const textContent = await pdfPage.getTextContent();
        const rawItems: RawTextItem[] = [];

        for (const item of textContent.items) {
          if (!("str" in item) || !item.str.trim()) continue;

          const transformed = pdfjs.Util.transform(
            viewport.transform,
            item.transform,
          );
          const fontSize = Math.max(
            5,
            Math.hypot(transformed[2], transformed[3]),
          );
          const width = Math.max(3, Math.abs(item.width));
          const height = Math.max(
            fontSize * 1.05,
            Math.abs(item.height || fontSize),
          );

          rawItems.push({
            str: item.str,
            x: transformed[4],
            y: transformed[5] - height,
            width,
            height,
            fontSize,
            fontName: item.fontName ?? "Helvetica",
          });
        }

        nextPages.push({
          id: pageId,
          sourcePageNumber: pageNumber,
          baseRotation: rotation,
          rotationDelta: 0,
          width: viewport.width,
          height: viewport.height,
          thumbnail,
        });

        nextElements.push(...groupTextItems(rawItems, pageId));
        pdfPage.cleanup();
      }

      setFile(nextFile);
      setFilename(safeFilename(nextFile.name));
      setPages(nextPages);
      setElements(nextElements);
      setActivePageId(nextPages[0]?.id ?? "");
      setSelectedElementId("");
      setTool("select");
      setZoom(1);
      setOutputBlob(null);
      setSaveStatus("idle");
      historyRef.current = [];
      redoRef.current = [];
      setUndoCount(0);
      setRedoCount(0);
      setHistoryTick((value) => value + 1);
    } catch (caught) {
      console.error("PDF editor load error:", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "The PDF could not be opened.",
      );
    } finally {
      setIsLoading(false);
      setProgressText("");
    }
  }

  function handlePdfInput(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (selected) void loadPdf(selected);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFile(false);
    const selected = event.dataTransfer.files?.[0];
    if (selected) void loadPdf(selected);
  }

  function updateElement(id: string, changes: Partial<EditorElement>) {
    setElements((current) =>
      current.map((element) =>
        element.id === id
          ? ({ ...element, ...changes } as EditorElement)
          : element,
      ),
    );
    invalidateOutput();
  }

  function deleteSelected() {
    if (!selectedElement) return;

    recordHistory();

    if (
      selectedElement.type === "text" &&
      selectedElement.source === "existing"
    ) {
      updateElement(selectedElement.id, {
        text: "",
        modified: true,
      } as Partial<TextElement>);
    } else {
      setElements((current) =>
        current.filter((item) => item.id !== selectedElement.id),
      );
    }

    setSelectedElementId("");
    invalidateOutput();
  }

  function startMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    element: Exclude<EditorElement, InkElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    recordHistory();
    setSelectedElementId(element.id);
    setDragState({
      elementId: element.id,
      mode: "move",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      startWidth: element.width,
      startHeight: element.height,
    });
  }

  function startResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    element: Exclude<EditorElement, InkElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    recordHistory();
    setSelectedElementId(element.id);
    setDragState({
      elementId: element.id,
      mode: "resize",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
      startWidth: element.width,
      startHeight: element.height,
    });
  }

  function rotatePage(pageId: string) {
    recordHistory();

    setPages((current) =>
      current.map((page) => {
        if (page.id !== pageId) return page;

        const oldWidth = page.width;
        const oldHeight = page.height;

        return {
          ...page,
          rotationDelta: normalizeRotation(page.rotationDelta + 90),
          width: oldHeight,
          height: oldWidth,
        };
      }),
    );

    setElements((current) =>
      current.map((element) => {
        if (element.pageId !== pageId) return element;
        const page = pages.find((item) => item.id === pageId);
        if (!page) return element;
        const oldHeight = page.height;

        if (element.type === "ink") {
          return {
            ...element,
            points: element.points.map((point) => ({
              x: oldHeight - point.y,
              y: point.x,
            })),
          };
        }

        return {
          ...element,
          x: oldHeight - (element.y + element.height),
          y: element.x,
          width: element.height,
          height: element.width,
        } as EditorElement;
      }),
    );

    invalidateOutput();
  }

  function deletePage(pageId: string) {
    if (pages.length <= 1) {
      setError("A PDF editor must keep at least one page.");
      return;
    }

    recordHistory();
    const index = pages.findIndex((page) => page.id === pageId);
    const remaining = pages.filter((page) => page.id !== pageId);
    setPages(remaining);
    setElements((current) =>
      current.filter((element) => element.pageId !== pageId),
    );
    setActivePageId(remaining[Math.min(index, remaining.length - 1)]?.id ?? "");
    setSelectedElementId("");
    invalidateOutput();
  }

  function movePage(pageId: string, direction: -1 | 1) {
    const index = pages.findIndex((page) => page.id === pageId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= pages.length) return;

    recordHistory();
    const next = [...pages];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setPages(next);
    invalidateOutput();
  }

  async function addImageFromFile(
    fileToAdd: File,
    kind: "image" | "signature",
  ) {
    if (!activePage) return;

    if (!fileToAdd.type.startsWith("image/")) {
      setError("Please select a PNG or JPG image.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(fileToAdd);
      const image = await loadHtmlImage(dataUrl);
      const maxWidth = Math.min(
        activePage.width * 0.42,
        kind === "signature" ? 220 : 280,
      );
      const ratio = image.naturalHeight / Math.max(1, image.naturalWidth);
      const width = Math.max(60, maxWidth);
      const height = Math.max(35, width * ratio);

      recordHistory();
      const element: ImageElement = {
        id: createId(),
        type: "image",
        pageId: activePage.id,
        kind,
        dataUrl,
        mimeType: fileToAdd.type === "image/png" ? "image/png" : "image/jpeg",
        x: Math.max(12, (activePage.width - width) / 2),
        y: Math.max(12, (activePage.height - height) / 2),
        width,
        height,
      };

      setElements((current) => [...current, element]);
      setSelectedElementId(element.id);
      setTool("select");
      invalidateOutput();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The image could not be added.",
      );
    }
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(activePage?.width ?? 0, (event.clientX - rect.left) / zoom),
      ),
      y: Math.max(
        0,
        Math.min(activePage?.height ?? 0, (event.clientY - rect.top) / zoom),
      ),
    };
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!activePage) return;

    if (tool === "select") {
      setSelectedElementId("");
      return;
    }

    const point = pointFromEvent(event);

    if (tool === "text") {
      recordHistory();
      const element: TextElement = {
        id: createId(),
        type: "text",
        pageId: activePage.id,
        source: "added",
        originalText: "",
        text: "Type here",
        x: point.x,
        y: point.y,
        width: Math.min(260, Math.max(120, activePage.width - point.x - 12)),
        height: 42,
        fontSize: 14,
        fontFamily: "Helvetica",
        bold: false,
        italic: false,
        color: "#111111",
        align: "left",
        modified: true,
      };
      setElements((current) => [...current, element]);
      setSelectedElementId(element.id);
      setTool("select");
      invalidateOutput();
      return;
    }

    if (tool === "highlight" || tool === "whiteout") {
      setGesture({
        kind: "rect",
        tool,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
      });
      return;
    }

    if (tool === "draw") {
      setGesture({ kind: "ink", points: [point] });
    }
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture) return;
    const point = pointFromEvent(event);

    if (gesture.kind === "rect") {
      setGesture({ ...gesture, currentX: point.x, currentY: point.y });
    } else {
      setGesture({ ...gesture, points: [...gesture.points, point] });
    }
  }

  function handleCanvasPointerUp() {
    if (!gesture || !activePage) return;

    if (gesture.kind === "rect") {
      const x = Math.min(gesture.startX, gesture.currentX);
      const y = Math.min(gesture.startY, gesture.currentY);
      const width = Math.abs(gesture.currentX - gesture.startX);
      const height = Math.abs(gesture.currentY - gesture.startY);

      if (width >= 3 && height >= 3) {
        recordHistory();
        const element: RectElement = {
          id: createId(),
          type: gesture.tool,
          pageId: activePage.id,
          x,
          y,
          width,
          height,
          color: gesture.tool === "highlight" ? "#fde047" : "#ffffff",
          opacity: gesture.tool === "highlight" ? 0.38 : 1,
        };
        setElements((current) => [...current, element]);
        setSelectedElementId(element.id);
        invalidateOutput();
      }
    } else if (gesture.points.length > 1) {
      recordHistory();
      const element: InkElement = {
        id: createId(),
        type: "ink",
        pageId: activePage.id,
        points: gesture.points,
        color: "#dc2626",
        width: 2.2,
      };
      setElements((current) => [...current, element]);
      setSelectedElementId(element.id);
      invalidateOutput();
    }

    setGesture(null);
  }

  function getStandardFontName(element: TextElement) {
    if (element.fontFamily === "Times") {
      if (element.bold && element.italic)
        return StandardFonts.TimesRomanBoldItalic;
      if (element.bold) return StandardFonts.TimesRomanBold;
      if (element.italic) return StandardFonts.TimesRomanItalic;
      return StandardFonts.TimesRoman;
    }

    if (element.fontFamily === "Courier") {
      if (element.bold && element.italic)
        return StandardFonts.CourierBoldOblique;
      if (element.bold) return StandardFonts.CourierBold;
      if (element.italic) return StandardFonts.CourierOblique;
      return StandardFonts.Courier;
    }

    if (element.bold && element.italic)
      return StandardFonts.HelveticaBoldOblique;
    if (element.bold) return StandardFonts.HelveticaBold;
    if (element.italic) return StandardFonts.HelveticaOblique;
    return StandardFonts.Helvetica;
  }

  async function createEditedPdf() {
    const sourceBytes = sourceBytesRef.current;
    const pdfjs = pdfRef.current;

    if (!sourceBytes || !pdfjs || pages.length === 0) {
      setError("Open a PDF first.");
      return;
    }

    try {
      setIsExporting(true);
      setError("");
      setOutputBlob(null);
      setSaveStatus("idle");
      setProgressText("Preparing edited PDF...");

      const sourceDoc = await PDFDocument.load(sourceBytes.slice());
      const outputDoc = await PDFDocument.create();
      const fontCache = new Map<string, PDFFont>();

      async function getFont(element: TextElement) {
        const name = getStandardFontName(element);
        const key = String(name);
        const cached = fontCache.get(key);
        if (cached) return cached;
        const font = await outputDoc.embedFont(name);
        fontCache.set(key, font);
        return font;
      }

      for (let index = 0; index < pages.length; index++) {
        const pageModel = pages[index];
        setProgressText(
          `Applying edits to page ${index + 1} of ${pages.length}...`,
        );

        const [copiedPage] = await outputDoc.copyPages(sourceDoc, [
          pageModel.sourcePageNumber - 1,
        ]);
        outputDoc.addPage(copiedPage);

        const effectiveRotation = normalizeRotation(
          pageModel.baseRotation + pageModel.rotationDelta,
        );
        copiedPage.setRotation(degrees(effectiveRotation));

        const pdfJsPage = await pdfjs.getPage(pageModel.sourcePageNumber);
        const viewport = pdfJsPage.getViewport({
          scale: 1,
          rotation: effectiveRotation,
        });
        const pageElements = elements.filter(
          (element) => element.pageId === pageModel.id,
        );

        const toPdfRect = (
          x: number,
          y: number,
          width: number,
          height: number,
        ) => {
          const points = [
            viewport.convertToPdfPoint(x, y),
            viewport.convertToPdfPoint(x + width, y),
            viewport.convertToPdfPoint(x + width, y + height),
            viewport.convertToPdfPoint(x, y + height),
          ];

          const xs = points.map((point) => point[0]);
          const ys = points.map((point) => point[1]);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);

          return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          };
        };

        for (const element of pageElements) {
          if (element.type === "text") {
            const pdfRect = toPdfRect(
              element.x,
              element.y,
              element.width,
              element.height,
            );

            if (element.source === "existing" && element.modified) {
              copiedPage.drawRectangle({
                x: pdfRect.x - 1.5,
                y: pdfRect.y - 1.5,
                width: pdfRect.width + 3,
                height: pdfRect.height + 3,
                color: rgb(1, 1, 1),
              });
            }

            if (
              (element.source === "added" || element.modified) &&
              element.text.trim()
            ) {
              const font = await getFont(element);
              const size = Math.max(5, element.fontSize);
              const lineHeight = size * 1.18;
              const textColor = hexToRgb(element.color);
              const lines = wrapText(
                element.text,
                font,
                size,
                Math.max(10, pdfRect.width),
              );
              let y = pdfRect.y + pdfRect.height - size;

              for (const line of lines) {
                if (y < pdfRect.y - lineHeight) break;

                const lineWidth = font.widthOfTextAtSize(line, size);
                let x = pdfRect.x;

                if (element.align === "center") {
                  x = pdfRect.x + Math.max(0, (pdfRect.width - lineWidth) / 2);
                } else if (element.align === "right") {
                  x = pdfRect.x + Math.max(0, pdfRect.width - lineWidth);
                }

                copiedPage.drawText(line, {
                  x,
                  y,
                  size,
                  font,
                  color: rgb(textColor.r, textColor.g, textColor.b),
                });

                y -= lineHeight;
              }
            }
          }

          if (element.type === "highlight" || element.type === "whiteout") {
            const pdfRect = toPdfRect(
              element.x,
              element.y,
              element.width,
              element.height,
            );
            const color = hexToRgb(element.color);
            copiedPage.drawRectangle({
              x: pdfRect.x,
              y: pdfRect.y,
              width: pdfRect.width,
              height: pdfRect.height,
              color: rgb(color.r, color.g, color.b),
              opacity: element.opacity,
            });
          }

          if (element.type === "ink") {
            const color = hexToRgb(element.color);

            for (
              let pointIndex = 1;
              pointIndex < element.points.length;
              pointIndex++
            ) {
              const previous = viewport.convertToPdfPoint(
                element.points[pointIndex - 1].x,
                element.points[pointIndex - 1].y,
              );
              const current = viewport.convertToPdfPoint(
                element.points[pointIndex].x,
                element.points[pointIndex].y,
              );

              copiedPage.drawLine({
                start: { x: previous[0], y: previous[1] },
                end: { x: current[0], y: current[1] },
                thickness: element.width,
                color: rgb(color.r, color.g, color.b),
              });
            }
          }

          if (element.type === "image") {
            const bytes = dataUrlToBytes(element.dataUrl);
            const embedded =
              element.mimeType === "image/png"
                ? await outputDoc.embedPng(bytes)
                : await outputDoc.embedJpg(bytes);
            const pdfRect = toPdfRect(
              element.x,
              element.y,
              element.width,
              element.height,
            );

            copiedPage.drawImage(embedded, {
              x: pdfRect.x,
              y: pdfRect.y,
              width: pdfRect.width,
              height: pdfRect.height,
            });
          }
        }

        pdfJsPage.cleanup();
      }

      const bytes = await outputDoc.save();
      const pdfBuffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(pdfBuffer).set(bytes);
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });
      setOutputBlob(blob);
      setProgressText("");
    } catch (caught) {
      console.error("PDF export error:", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "The edited PDF could not be created.",
      );
    } finally {
      setIsExporting(false);
      setProgressText("");
    }
  }

  async function downloadEditedPdf() {
    if (!outputBlob) return;

    try {
      setSaveStatus("saving");
      const result = await savePdfBlob(
        outputBlob,
        `${safeFilename(filename)}.pdf`,
      );
      setSaveStatus(result === "completed" ? "completed" : "idle");
    } catch (caught) {
      setSaveStatus("idle");
      setError(
        caught instanceof Error
          ? caught.message
          : "The PDF could not be saved.",
      );
    }
  }

  function renderElement(element: EditorElement) {
    const selected = element.id === selectedElementId;

    if (element.type === "ink") {
      const points = element.points
        .map((point) => `${point.x * zoom},${point.y * zoom}`)
        .join(" ");

      return (
        <svg
          key={element.id}
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        >
          <polyline
            points={points}
            fill="none"
            stroke={element.color}
            strokeWidth={element.width * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    }

    const commonStyle = {
      left: element.x * zoom,
      top: element.y * zoom,
      width: element.width * zoom,
      height: element.height * zoom,
    };

    if (element.type === "highlight" || element.type === "whiteout") {
      return (
        <div
          key={element.id}
          onPointerDown={(event) => {
            event.stopPropagation();
            setSelectedElementId(element.id);
          }}
          className={["absolute", selected ? "ring-2 ring-blue-500" : ""].join(
            " ",
          )}
          style={{
            ...commonStyle,
            backgroundColor: element.color,
            opacity: element.opacity,
          }}
        >
          {selected && (
            <>
              <button
                type="button"
                aria-label="Move annotation"
                onPointerDown={(event) => startMove(event, element)}
                className="absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow"
              >
                ↕
              </button>
              <button
                type="button"
                aria-label="Resize annotation"
                onPointerDown={(event) => startResize(event, element)}
                className="absolute -bottom-3 -right-3 h-6 w-6 rounded-md border-2 border-white bg-blue-600 shadow"
              />
            </>
          )}
        </div>
      );
    }

    if (element.type === "image") {
      return (
        <div
          key={element.id}
          onPointerDown={(event) => {
            event.stopPropagation();
            setSelectedElementId(element.id);
          }}
          className={[
            "absolute select-none",
            selected ? "ring-2 ring-blue-500" : "",
          ].join(" ")}
          style={commonStyle}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={element.dataUrl}
            alt={element.kind === "signature" ? "Signature" : "Inserted"}
            draggable={false}
            className="h-full w-full object-contain"
          />
          {selected && (
            <>
              <button
                type="button"
                aria-label="Move image"
                onPointerDown={(event) => startMove(event, element)}
                className="absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow"
              >
                ↕
              </button>
              <button
                type="button"
                aria-label="Resize image"
                onPointerDown={(event) => startResize(event, element)}
                className="absolute -bottom-3 -right-3 h-6 w-6 rounded-md border-2 border-white bg-blue-600 shadow"
              />
            </>
          )}
        </div>
      );
    }

    if (element.type !== "text") {
      return null;
    }

    const visible = element.source === "added" || element.modified || selected;

    return (
      <div
        key={element.id}
        onPointerDown={(event) => {
          event.stopPropagation();
          setSelectedElementId(element.id);
        }}
        className={[
          "absolute",
          selected
            ? "z-20 ring-2 ring-blue-500"
            : "z-10 hover:ring-1 hover:ring-blue-300",
        ].join(" ")}
        style={commonStyle}
      >
        {selected ? (
          <textarea
            value={element.text}
            autoFocus
            onFocus={() => {
              if (textEditHistoryRef.current !== element.id) {
                recordHistory();
                textEditHistoryRef.current = element.id;
              }
            }}
            onBlur={() => {
              textEditHistoryRef.current = null;
            }}
            onChange={(event) =>
              updateElement(element.id, {
                text: event.target.value,
                modified: true,
              } as Partial<TextElement>)
            }
            className="h-full w-full resize-none border-0 bg-white/95 p-0 outline-none"
            style={{
              fontFamily: getCssFontFamily(element.fontFamily),
              fontSize: `${element.fontSize * zoom}px`,
              fontWeight: element.bold ? 700 : 400,
              fontStyle: element.italic ? "italic" : "normal",
              color: element.color,
              textAlign: element.align,
              lineHeight: 1.18,
            }}
          />
        ) : (
          <div
            className="h-full w-full overflow-hidden whitespace-pre-wrap"
            style={{
              background:
                visible && element.source === "existing"
                  ? "white"
                  : "transparent",
              color: visible ? element.color : "transparent",
              fontFamily: getCssFontFamily(element.fontFamily),
              fontSize: `${element.fontSize * zoom}px`,
              fontWeight: element.bold ? 700 : 400,
              fontStyle: element.italic ? "italic" : "normal",
              textAlign: element.align,
              lineHeight: 1.18,
            }}
          >
            {element.text}
          </div>
        )}

        {selected && (
          <>
            <button
              type="button"
              aria-label="Move text"
              onPointerDown={(event) => startMove(event, element)}
              className="absolute -left-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow"
            >
              ↕
            </button>
            <button
              type="button"
              aria-label="Resize text"
              onPointerDown={(event) => startResize(event, element)}
              className="absolute -bottom-3 -right-3 h-6 w-6 rounded-md border-2 border-white bg-blue-600 shadow"
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handlePdfInput}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected) void addImageFromFile(selected, "image");
        }}
      />
      <input
        ref={signatureInputRef}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        className="hidden"
        onChange={(event) => {
          const selected = event.target.files?.[0];
          event.target.value = "";
          if (selected) void addImageFromFile(selected, "signature");
        }}
      />

      {!file ? (
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDraggingFile(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setIsDraggingFile(false);
            }
          }}
          onDrop={handleDrop}
          className={[
            "rounded-3xl border-2 border-dashed bg-white px-6 py-16 text-center transition",
            isDraggingFile ? "border-blue-500 bg-blue-50" : "border-gray-300",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-lg font-black text-blue-700">
            PDF
          </div>
          <h2 className="mt-5 text-2xl font-bold text-gray-950">Edit PDF</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-gray-500">
            Click existing text to edit it, add text, highlights, whiteout,
            drawings, images and signatures, then export your edited PDF.
          </p>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded-xl bg-blue-600 px-7 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? "Opening PDF..." : "Select PDF"}
          </button>
          <p className="mt-4 text-xs text-gray-400">
            PDF up to 100 MB · Browser-based editor · No watermark
          </p>
          {isLoading && progressText && (
            <p className="mt-4 text-sm font-medium text-blue-700">
              {progressText}
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-gray-100 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white p-3">
            <button
              type="button"
              onClick={undo}
              disabled={undoCount === 0}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-35"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={redoCount === 0}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-35"
            >
              Redo
            </button>

            <div className="mx-1 h-7 w-px bg-gray-200" />

            {(
              [
                ["select", "Edit Text"],
                ["text", "Add Text"],
                ["highlight", "Highlight"],
                ["whiteout", "Whiteout"],
                ["draw", "Draw"],
              ] as Array<[Tool, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className={[
                  "rounded-lg border px-3 py-2 text-sm font-semibold transition",
                  tool === id
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Image
            </button>
            <button
              type="button"
              onClick={() => signatureInputRef.current?.click()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Sign
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setZoom((value) =>
                    Math.max(0.6, Number((value - 0.1).toFixed(1))),
                  )
                }
                className="rounded-lg border border-gray-200 px-3 py-2 font-bold text-gray-700"
              >
                −
              </button>
              <span className="min-w-14 text-center text-sm font-semibold text-gray-600">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() =>
                  setZoom((value) =>
                    Math.min(2, Number((value + 0.1).toFixed(1))),
                  )
                }
                className="rounded-lg border border-gray-200 px-3 py-2 font-bold text-gray-700"
              >
                +
              </button>
            </div>
          </div>

          {selectedElement?.type === "text" && (
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
              <select
                value={selectedElement.fontFamily}
                onChange={(event) => {
                  recordHistory();
                  updateElement(selectedElement.id, {
                    fontFamily: event.target.value as FontFamily,
                    modified: true,
                  } as Partial<TextElement>);
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="Helvetica">Helvetica</option>
                <option value="Times">Times</option>
                <option value="Courier">Courier</option>
              </select>

              <input
                type="number"
                min={5}
                max={72}
                value={Math.round(selectedElement.fontSize)}
                onChange={(event) =>
                  updateElement(selectedElement.id, {
                    fontSize: Math.max(5, Number(event.target.value) || 12),
                    modified: true,
                  } as Partial<TextElement>)
                }
                className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                aria-label="Font size"
              />

              <button
                type="button"
                onClick={() => {
                  recordHistory();
                  updateElement(selectedElement.id, {
                    bold: !selectedElement.bold,
                    modified: true,
                  } as Partial<TextElement>);
                }}
                className={[
                  "rounded-lg border px-3 py-2 font-bold",
                  selectedElement.bold
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-300",
                ].join(" ")}
              >
                B
              </button>
              <button
                type="button"
                onClick={() => {
                  recordHistory();
                  updateElement(selectedElement.id, {
                    italic: !selectedElement.italic,
                    modified: true,
                  } as Partial<TextElement>);
                }}
                className={[
                  "rounded-lg border px-3 py-2 italic",
                  selectedElement.italic
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-gray-300",
                ].join(" ")}
              >
                I
              </button>

              <input
                type="color"
                value={selectedElement.color}
                onChange={(event) =>
                  updateElement(selectedElement.id, {
                    color: event.target.value,
                    modified: true,
                  } as Partial<TextElement>)
                }
                className="h-10 w-12 rounded-lg border border-gray-300 bg-white p-1"
                aria-label="Text color"
              />

              <select
                value={selectedElement.align}
                onChange={(event) => {
                  recordHistory();
                  updateElement(selectedElement.id, {
                    align: event.target.value as TextAlign,
                    modified: true,
                  } as Partial<TextElement>);
                }}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>

              <button
                type="button"
                onClick={deleteSelected}
                className="ml-auto rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}

          {selectedElement && selectedElement.type !== "text" && (
            <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
              <p className="text-sm font-semibold text-gray-700">
                {selectedElement.type === "image"
                  ? selectedElement.kind === "signature"
                    ? "Signature selected"
                    : "Image selected"
                  : selectedElement.type === "ink"
                    ? "Drawing selected"
                    : selectedElement.type === "highlight"
                      ? "Highlight selected"
                      : "Whiteout selected"}
              </p>
              <button
                type="button"
                onClick={deleteSelected}
                className="ml-auto rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </div>
          )}

          <div className="grid min-h-[720px] lg:grid-cols-[190px_minmax(0,1fr)]">
            <aside className="border-r border-gray-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900">Pages</p>
                <span className="text-xs text-gray-400">{pages.length}</span>
              </div>

              <div className="max-h-[680px] space-y-3 overflow-y-auto pr-1">
                {pages.map((page, index) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => {
                      setActivePageId(page.id);
                      setSelectedElementId("");
                    }}
                    className={[
                      "w-full rounded-xl border p-2 text-left transition",
                      activePage?.id === page.id
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300",
                    ].join(" ")}
                  >
                    <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={page.thumbnail}
                        alt={`Page ${index + 1}`}
                        className="max-h-full max-w-full object-contain"
                        style={{
                          transform: `rotate(${page.rotationDelta}deg)`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-700">
                        Page {index + 1}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        #{page.sourcePageNumber}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          movePage(page.id, -1);
                        }}
                        className="rounded-md border border-gray-200 px-1 py-1 text-center text-xs text-gray-600"
                      >
                        ↑
                      </span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          movePage(page.id, 1);
                        }}
                        className="rounded-md border border-gray-200 px-1 py-1 text-center text-xs text-gray-600"
                      >
                        ↓
                      </span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          rotatePage(page.id);
                        }}
                        className="rounded-md border border-gray-200 px-1 py-1 text-center text-xs text-gray-600"
                      >
                        ↻
                      </span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          deletePage(page.id);
                        }}
                        className="rounded-md border border-red-200 px-1 py-1 text-center text-xs text-red-600"
                      >
                        ×
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <main className="overflow-auto bg-gray-200 p-4 sm:p-7">
              {activePage && pdfDocument && (
                <div className="mx-auto w-max">
                  <div
                    className="relative overflow-hidden bg-white shadow-xl"
                    style={{
                      width: activePage.width * zoom,
                      height: activePage.height * zoom,
                    }}
                    onPointerDown={handleCanvasPointerDown}
                    onPointerMove={handleCanvasPointerMove}
                    onPointerUp={handleCanvasPointerUp}
                    onPointerCancel={() => setGesture(null)}
                  >
                    <PdfCanvas
                      pdf={pdfDocument}
                      page={activePage}
                      zoom={zoom}
                    />

                    <div className="absolute inset-0">
                      {activeElements.map(renderElement)}

                      {gesture?.kind === "rect" && (
                        <div
                          className="pointer-events-none absolute"
                          style={{
                            left:
                              Math.min(gesture.startX, gesture.currentX) * zoom,
                            top:
                              Math.min(gesture.startY, gesture.currentY) * zoom,
                            width:
                              Math.abs(gesture.currentX - gesture.startX) *
                              zoom,
                            height:
                              Math.abs(gesture.currentY - gesture.startY) *
                              zoom,
                            backgroundColor:
                              gesture.tool === "highlight"
                                ? "#fde047"
                                : "#ffffff",
                            opacity: gesture.tool === "highlight" ? 0.38 : 1,
                            outline: "1px solid rgba(37,99,235,.7)",
                          }}
                        />
                      )}

                      {gesture?.kind === "ink" && (
                        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                          <polyline
                            points={gesture.points
                              .map(
                                (point) =>
                                  `${point.x * zoom},${point.y * zoom}`,
                              )
                              .join(" ")}
                            fill="none"
                            stroke="#dc2626"
                            strokeWidth={2.2 * zoom}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  </div>

                  {activeElements.filter(
                    (element) =>
                      element.type === "text" && element.source === "existing",
                  ).length === 0 && (
                    <div className="mt-4 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      No editable PDF text was detected on this page. It may be
                      a scanned/image-only page.
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>

          <div className="border-t border-gray-200 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="flex-1">
                <label
                  htmlFor="edit-pdf-filename"
                  className="text-xs font-bold uppercase tracking-wide text-gray-500"
                >
                  Output file name
                </label>
                <input
                  id="edit-pdf-filename"
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <button
                type="button"
                disabled={isExporting}
                onClick={() => void createEditedPdf()}
                className="rounded-xl bg-blue-600 px-6 py-3.5 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isExporting ? "Creating edited PDF..." : "Save Edited PDF"}
              </button>

              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-xl border border-gray-300 px-5 py-3.5 font-semibold text-gray-700 hover:bg-gray-50"
              >
                Open Another PDF
              </button>
            </div>

            {progressText && (
              <p className="mt-3 text-sm font-medium text-blue-700">
                {progressText}
              </p>
            )}

            {outputBlob && (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-bold text-green-950">
                      ✓ Your edited PDF is ready
                    </p>
                    <p className="mt-1 text-xs text-green-700">
                      {safeFilename(filename)}.pdf
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={saveStatus === "saving"}
                    onClick={() => void downloadEditedPdf()}
                    className="rounded-xl bg-green-600 px-5 py-3 font-bold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {saveStatus === "saving"
                      ? "Opening save options..."
                      : saveStatus === "completed"
                        ? "Download Again"
                        : "Download Edited PDF"}
                  </button>
                </div>
                {saveStatus === "completed" && (
                  <p className="mt-3 text-sm font-semibold text-green-700">
                    ✓ Download completed
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {file && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{file.name}</span>
          <span>{formatFileSize(file.size)}</span>
          <span>All editing happens in your browser.</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm font-bold text-red-800">
            Could not complete the request
          </p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        Existing digital PDF text can be edited directly. Some PDFs use
        embedded/custom fonts, outlined text, complex backgrounds or scanned
        images, so exact Word-style reflow is not always possible. Review the
        exported PDF before using it as a final document.
      </div>

      <span className="hidden">{historyTick}</span>
    </div>
  );
}

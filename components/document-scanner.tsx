"use client";

import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

type ScanMode = "original" | "auto" | "color" | "grayscale" | "bw";

type ExportFormat = "jpg" | "png";
type PdfPageSize = "auto" | "a4";
type QualityMode = "high" | "balanced" | "small";

type Point = {
  x: number;
  y: number;
};

type Corners = [Point, Point, Point, Point];

type ScannerPage = {
  id: string;
  file: File;
  previewUrl: string;
  mode: ScanMode;
  rotation: number;

  /*
   * Corner coordinates are stored as percentages
   * from 0 to 1 so they work regardless of the
   * displayed preview size.
   *
   * Order:
   * 0 = top-left
   * 1 = top-right
   * 2 = bottom-right
   * 3 = bottom-left
   */
  corners: Corners;

  detected: boolean;
  detectionAttempted: boolean;
};

type EditorState = {
  pageId: string;
  corners: Corners;
};

type OpenCv = typeof import("@techstark/opencv-js");

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"];

const SCAN_MODES: {
  id: ScanMode;
  label: string;
}[] = [
  { id: "original", label: "Original" },
  { id: "auto", label: "Auto Scan" },
  { id: "color", label: "Color" },
  {
    id: "grayscale",
    label: "Grayscale",
  },
  { id: "bw", label: "B&W" },
];

const DEFAULT_CORNERS: Corners = [
  { x: 0.04, y: 0.04 },
  { x: 0.96, y: 0.04 },
  { x: 0.96, y: 0.96 },
  { x: 0.04, y: 0.96 },
];

let openCvPromise: Promise<OpenCv> | null = null;

function cloneCorners(corners: Corners): Corners {
  return corners.map((point) => ({
    ...point,
  })) as Corners;
}

async function getOpenCv() {
  if (!openCvPromise) {
    openCvPromise = import("@techstark/opencv-js").then(async (module) => {
      const imported = module.default ?? module;

      const cv = imported instanceof Promise ? await imported : imported;

      if (cv.Mat) {
        return cv as OpenCv;
      }

      await new Promise<void>((resolve) => {
        cv.onRuntimeInitialized = () => resolve();
      });

      return cv as OpenCv;
    });
  }

  return openCvPromise;
}

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedImage(file: File) {
  return SUPPORTED_EXTENSIONS.includes(getExtension(file.name));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFilename(value: string) {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ");

  return cleaned || "Scanned-Document";
}

function getQuality(mode: QualityMode) {
  switch (mode) {
    case "high":
      return 0.95;

    case "small":
      return 0.65;

    default:
      return 0.82;
  }
}

function getPreviewFilter(mode: ScanMode) {
  switch (mode) {
    case "auto":
      return "brightness(1.06) contrast(1.18) saturate(0.92)";

    case "color":
      return "brightness(1.04) contrast(1.12) saturate(1.18)";

    case "grayscale":
      return "grayscale(1) brightness(1.05) contrast(1.18)";

    case "bw":
      return "grayscale(1) brightness(1.08) contrast(1.85)";

    default:
      return "none";
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);

    image.onerror = () =>
      reject(new Error("One of the selected images could not be read."));

    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The processed image could not be created."));

          return;
        }

        resolve(blob);
      },
      type,
      quality,
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);

  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function orderPixelPoints(points: Point[]): Corners {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));

  const topLeft = bySum[0];
  const bottomRight = bySum[bySum.length - 1];

  const remaining = points.filter(
    (point) => point !== topLeft && point !== bottomRight,
  );

  const byDifference = [...remaining].sort((a, b) => b.x - b.y - (a.x - a.y));

  const topRight = byDifference[0];

  const bottomLeft = byDifference[1];

  return [topLeft, topRight, bottomRight, bottomLeft];
}

async function detectDocument(imageUrl: string): Promise<{
  corners: Corners;
  detected: boolean;
}> {
  const image = await loadImage(imageUrl);

  const canvas = document.createElement("canvas");

  /*
   * Detection does not need the
   * full camera resolution.
   */
  const maxSide = 1400;

  const scale = Math.min(
    1,
    maxSide / Math.max(image.naturalWidth, image.naturalHeight),
  );

  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));

  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");

  if (!context) {
    return {
      corners: cloneCorners(DEFAULT_CORNERS),
      detected: false,
    };
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const cv = await getOpenCv();

  let source: InstanceType<OpenCv["Mat"]> | null = null;

  let gray: InstanceType<OpenCv["Mat"]> | null = null;

  let blurred: InstanceType<OpenCv["Mat"]> | null = null;

  let edges: InstanceType<OpenCv["Mat"]> | null = null;

  let contours: InstanceType<OpenCv["MatVector"]> | null = null;

  let hierarchy: InstanceType<OpenCv["Mat"]> | null = null;

  let kernel: InstanceType<OpenCv["Mat"]> | null = null;

  try {
    source = cv.imread(canvas);

    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);

    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    cv.Canny(blurred, edges, 60, 180);

    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));

    cv.dilate(edges, edges, kernel);

    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
    );

    const imageArea = canvas.width * canvas.height;

    let bestArea = 0;
    let bestPoints: Point[] | null = null;

    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);

      const approximation = new cv.Mat();

      try {
        const perimeter = cv.arcLength(contour, true);

        cv.approxPolyDP(contour, approximation, 0.02 * perimeter, true);

        if (approximation.rows !== 4) {
          continue;
        }

        const area = Math.abs(cv.contourArea(approximation));

        /*
         * Ignore tiny rectangular
         * objects inside the photo.
         */
        if (area < imageArea * 0.12) {
          continue;
        }

        if (area <= bestArea) {
          continue;
        }

        const data = approximation.data32S;

        const points: Point[] = [];

        for (let pointIndex = 0; pointIndex < 4; pointIndex++) {
          points.push({
            x: data[pointIndex * 2],
            y: data[pointIndex * 2 + 1],
          });
        }

        bestArea = area;
        bestPoints = points;
      } finally {
        approximation.delete();
        contour.delete();
      }
    }

    if (!bestPoints) {
      return {
        corners: cloneCorners(DEFAULT_CORNERS),
        detected: false,
      };
    }

    const ordered = orderPixelPoints(bestPoints);

    const normalized = ordered.map((point) => ({
      x: Math.min(1, Math.max(0, point.x / canvas.width)),
      y: Math.min(1, Math.max(0, point.y / canvas.height)),
    })) as Corners;

    return {
      corners: normalized,
      detected: true,
    };
  } finally {
    source?.delete();
    gray?.delete();
    blurred?.delete();
    edges?.delete();
    contours?.delete();
    hierarchy?.delete();
    kernel?.delete();
  }
}

async function createPerspectiveCanvas(
  page: ScannerPage,
  qualityMode: QualityMode,
) {
  const image = await loadImage(page.previewUrl);

  const maxDimension =
    qualityMode === "high" ? 3200 : qualityMode === "balanced" ? 2400 : 1800;

  const scale = Math.min(
    1,
    maxDimension / Math.max(image.naturalWidth, image.naturalHeight),
  );

  const width = Math.max(1, Math.round(image.naturalWidth * scale));

  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const sourceCanvas = document.createElement("canvas");

  sourceCanvas.width = width;
  sourceCanvas.height = height;

  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    throw new Error("Your browser could not process this image.");
  }

  sourceContext.drawImage(image, 0, 0, width, height);

  /*
   * Original mode intentionally
   * preserves the full photo.
   */
  if (page.mode === "original") {
    return sourceCanvas;
  }

  const pixelCorners = page.corners.map((point) => ({
    x: point.x * width,
    y: point.y * height,
  })) as Corners;

  const [topLeft, topRight, bottomRight, bottomLeft] = pixelCorners;

  const topWidth = distance(topLeft, topRight);

  const bottomWidth = distance(bottomLeft, bottomRight);

  const leftHeight = distance(topLeft, bottomLeft);

  const rightHeight = distance(topRight, bottomRight);

  const outputWidth = Math.max(2, Math.round(Math.max(topWidth, bottomWidth)));

  const outputHeight = Math.max(
    2,
    Math.round(Math.max(leftHeight, rightHeight)),
  );

  const cv = await getOpenCv();

  let source: InstanceType<OpenCv["Mat"]> | null = null;

  let destination: InstanceType<OpenCv["Mat"]> | null = null;

  let sourcePoints: InstanceType<OpenCv["Mat"]> | null = null;

  let destinationPoints: InstanceType<OpenCv["Mat"]> | null = null;

  let transform: InstanceType<OpenCv["Mat"]> | null = null;

  try {
    source = cv.imread(sourceCanvas);

    destination = new cv.Mat();

    sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      topLeft.x,
      topLeft.y,

      topRight.x,
      topRight.y,

      bottomRight.x,
      bottomRight.y,

      bottomLeft.x,
      bottomLeft.y,
    ]);

    destinationPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,

      outputWidth - 1,
      0,

      outputWidth - 1,
      outputHeight - 1,

      0,
      outputHeight - 1,
    ]);

    transform = cv.getPerspectiveTransform(sourcePoints, destinationPoints);

    cv.warpPerspective(
      source,
      destination,
      transform,
      new cv.Size(outputWidth, outputHeight),
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255, 255, 255, 255),
    );

    const outputCanvas = document.createElement("canvas");

    outputCanvas.width = outputWidth;

    outputCanvas.height = outputHeight;

    cv.imshow(outputCanvas, destination);

    return outputCanvas;
  } finally {
    source?.delete();
    destination?.delete();
    sourcePoints?.delete();
    destinationPoints?.delete();
    transform?.delete();
  }
}

function applyScanStyle(sourceCanvas: HTMLCanvasElement, mode: ScanMode) {
  if (mode === "original") {
    return sourceCanvas;
  }

  const canvas = document.createElement("canvas");

  canvas.width = sourceCanvas.width;

  canvas.height = sourceCanvas.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser could not enhance this image.");
  }

  context.fillStyle = "#ffffff";

  context.fillRect(0, 0, canvas.width, canvas.height);

  if (mode === "auto") {
    context.filter = "brightness(1.08) contrast(1.22) saturate(0.92)";
  }

  if (mode === "color") {
    context.filter = "brightness(1.05) contrast(1.16) saturate(1.2)";
  }

  if (mode === "grayscale") {
    context.filter = "grayscale(1) brightness(1.06) contrast(1.2)";
  }

  if (mode === "bw") {
    context.filter = "grayscale(1) brightness(1.08) contrast(1.45)";
  }

  context.drawImage(sourceCanvas, 0, 0);

  context.filter = "none";

  if (mode === "bw") {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    const data = imageData.data;

    /*
     * Calculate an average luminance
     * first. This adapts better than
     * one fixed threshold.
     */
    let total = 0;
    let pixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      total +=
        0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

      pixels++;
    }

    const average = total / Math.max(1, pixels);

    const threshold = Math.min(190, Math.max(120, average * 0.92));

    for (let index = 0; index < data.length; index += 4) {
      const luminance =
        0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

      const value = luminance > threshold ? 255 : 0;

      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
    }

    context.putImageData(imageData, 0, 0);
  }

  return canvas;
}

function rotateCanvas(sourceCanvas: HTMLCanvasElement, rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360;

  if (normalized === 0) {
    return sourceCanvas;
  }

  const sideways = normalized === 90 || normalized === 270;

  const canvas = document.createElement("canvas");

  canvas.width = sideways ? sourceCanvas.height : sourceCanvas.width;

  canvas.height = sideways ? sourceCanvas.width : sourceCanvas.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser could not rotate this image.");
  }

  context.fillStyle = "#ffffff";

  context.fillRect(0, 0, canvas.width, canvas.height);

  context.translate(canvas.width / 2, canvas.height / 2);

  context.rotate((normalized * Math.PI) / 180);

  context.drawImage(
    sourceCanvas,
    -sourceCanvas.width / 2,
    -sourceCanvas.height / 2,
  );

  return canvas;
}

async function renderPage(
  page: ScannerPage,
  format: ExportFormat,
  qualityMode: QualityMode,
) {
  const perspective = await createPerspectiveCanvas(page, qualityMode);

  const enhanced = applyScanStyle(perspective, page.mode);

  const finalCanvas = rotateCanvas(enhanced, page.rotation);

  /*
   * Ensure JPG gets a white
   * background.
   */
  let exportCanvas = finalCanvas;

  if (format === "jpg") {
    const whiteCanvas = document.createElement("canvas");

    whiteCanvas.width = finalCanvas.width;

    whiteCanvas.height = finalCanvas.height;

    const context = whiteCanvas.getContext("2d");

    if (!context) {
      throw new Error("Your browser could not export this image.");
    }

    context.fillStyle = "#ffffff";

    context.fillRect(0, 0, whiteCanvas.width, whiteCanvas.height);

    context.drawImage(finalCanvas, 0, 0);

    exportCanvas = whiteCanvas;
  }

  const mime = format === "png" ? "image/png" : "image/jpeg";

  const blob = await canvasToBlob(
    exportCanvas,
    mime,
    format === "jpg" ? getQuality(qualityMode) : undefined,
  );

  return {
    blob,
    width: exportCanvas.width,
    height: exportCanvas.height,
  };
}

function CornerEditor({
  page,
  corners,
  onChange,
  onCancel,
  onApply,
  onAutoDetect,
  detecting,
}: {
  page: ScannerPage;
  corners: Corners;
  onChange: (corners: Corners) => void;
  onCancel: () => void;
  onApply: () => void;
  onAutoDetect: () => void;
  detecting: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const draggingCorner = useRef<number | null>(null);

  const [activeCorner, setActiveCorner] = useState<number | null>(null);

  const [loupePosition, setLoupePosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  function updatePointer(index: number, clientX: number, clientY: number) {
    const container = containerRef.current;

    if (!container) return;

    const rect = container.getBoundingClientRect();

    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));

    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));

    const next = cloneCorners(corners);

    next[index] = { x, y };

    onChange(next);

    setLoupePosition({
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    index: number,
  ) {
    event.preventDefault();
    event.stopPropagation();

    draggingCorner.current = index;
    setActiveCorner(index);

    const container = containerRef.current;

    if (container) {
      const rect = container.getBoundingClientRect();

      setLoupePosition({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (draggingCorner.current !== index) return;

    event.preventDefault();

    updatePointer(index, event.clientX, event.clientY);
  }

  function finishDragging(event: ReactPointerEvent<HTMLButtonElement>) {
    draggingCorner.current = null;

    setActiveCorner(null);
    setLoupePosition(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const polygonPoints = corners
    .map((point) => `${point.x * 100},${point.y * 100}`)
    .join(" ");

  /*
   * Creates four surrounding polygons so the area
   * outside the selected document is darkened.
   */
  const [tl, tr, br, bl] = corners;

  const topMask = `
    0,0
    100,0
    ${tr.x * 100},${tr.y * 100}
    ${tl.x * 100},${tl.y * 100}
  `;

  const rightMask = `
    100,0
    100,100
    ${br.x * 100},${br.y * 100}
    ${tr.x * 100},${tr.y * 100}
  `;

  const bottomMask = `
    100,100
    0,100
    ${bl.x * 100},${bl.y * 100}
    ${br.x * 100},${br.y * 100}
  `;

  const leftMask = `
    0,100
    0,0
    ${tl.x * 100},${tl.y * 100}
    ${bl.x * 100},${bl.y * 100}
  `;

  const cornerNames = ["Top left", "Top right", "Bottom right", "Bottom left"];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* Top toolbar */}
      <div className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-black/90 px-4 backdrop-blur-xl sm:px-6">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-2 text-[15px] font-medium text-white/90 transition hover:bg-white/10"
        >
          Cancel
        </button>

        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center">
          <p className="text-[15px] font-semibold text-white">Adjust Corners</p>

          <p className="hidden text-[11px] text-white/50 sm:block">
            Drag corners to match the document
          </p>
        </div>

        <button
          type="button"
          disabled={detecting}
          onClick={onAutoDetect}
          className="rounded-full px-3 py-2 text-[15px] font-semibold text-blue-400 transition hover:bg-white/10 disabled:opacity-40"
        >
          {detecting ? "Detecting..." : "Auto"}
        </button>
      </div>

      {/* Image workspace */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#111] p-3 sm:p-6">
        <div
          ref={containerRef}
          className="relative max-h-full max-w-full select-none touch-none shadow-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={page.previewUrl}
            alt="Adjust document crop"
            draggable={false}
            className="block max-h-[calc(100vh-150px)] max-w-[calc(100vw-24px)] object-contain sm:max-h-[calc(100vh-180px)] sm:max-w-[calc(100vw-48px)]"
          />

          {/* Darkened outside area */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            <polygon points={topMask} fill="rgba(0,0,0,0.58)" />
            <polygon points={rightMask} fill="rgba(0,0,0,0.58)" />
            <polygon points={bottomMask} fill="rgba(0,0,0,0.58)" />
            <polygon points={leftMask} fill="rgba(0,0,0,0.58)" />

            {/* Selected document border */}
            <polygon
              points={polygonPoints}
              fill="rgba(255,255,255,0.025)"
              stroke="rgba(255,255,255,0.98)"
              strokeWidth="0.7"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />

            {/* Subtle rule-of-thirds guides */}
            <line
              x1={(tl.x + (tr.x - tl.x) / 3) * 100}
              y1={(tl.y + (tr.y - tl.y) / 3) * 100}
              x2={(bl.x + (br.x - bl.x) / 3) * 100}
              y2={(bl.y + (br.y - bl.y) / 3) * 100}
              stroke="rgba(255,255,255,0.24)"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />

            <line
              x1={(tl.x + ((tr.x - tl.x) * 2) / 3) * 100}
              y1={(tl.y + ((tr.y - tl.y) * 2) / 3) * 100}
              x2={(bl.x + ((br.x - bl.x) * 2) / 3) * 100}
              y2={(bl.y + ((br.y - bl.y) * 2) / 3) * 100}
              stroke="rgba(255,255,255,0.24)"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />

            <line
              x1={(tl.x + (bl.x - tl.x) / 3) * 100}
              y1={(tl.y + (bl.y - tl.y) / 3) * 100}
              x2={(tr.x + (br.x - tr.x) / 3) * 100}
              y2={(tr.y + (br.y - tr.y) / 3) * 100}
              stroke="rgba(255,255,255,0.24)"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />

            <line
              x1={(tl.x + ((bl.x - tl.x) * 2) / 3) * 100}
              y1={(tl.y + ((bl.y - tl.y) * 2) / 3) * 100}
              x2={(tr.x + ((br.x - tr.x) * 2) / 3) * 100}
              y2={(tr.y + ((br.y - tr.y) * 2) / 3) * 100}
              stroke="rgba(255,255,255,0.24)"
              strokeWidth="0.35"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Corner handles */}
          {corners.map((point, index) => (
            <button
              key={index}
              type="button"
              aria-label={cornerNames[index]}
              onPointerDown={(event) => handlePointerDown(event, index)}
              onPointerMove={(event) => handlePointerMove(event, index)}
              onPointerUp={finishDragging}
              onPointerCancel={finishDragging}
              className="group absolute z-20 h-12 w-12 -translate-x-1/2 -translate-y-1/2 touch-none outline-none"
              style={{
                left: `${point.x * 100}%`,
                top: `${point.y * 100}%`,
              }}
            >
              <span
                className={[
                  "absolute left-1/2 top-1/2 block h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_1px_6px_rgba(0,0,0,0.8)] transition-transform",
                  activeCorner === index
                    ? "scale-125 bg-white"
                    : "bg-transparent group-hover:scale-110",
                ].join(" ")}
              />
            </button>
          ))}

          {/* Magnifying loupe */}
          {activeCorner !== null && loupePosition && (
            <div
              className="pointer-events-none absolute z-40 h-24 w-24 overflow-hidden rounded-full border-[3px] border-white bg-black shadow-[0_5px_25px_rgba(0,0,0,0.7)] sm:h-28 sm:w-28"
              style={{
                left: `${loupePosition.x}px`,
                top: `${loupePosition.y}px`,
                transform: "translate(-50%, -125%)",
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url("${page.previewUrl}")`,
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "300% 300%",
                  backgroundPosition: `${
                    corners[activeCorner].x * 100
                  }% ${corners[activeCorner].y * 100}%`,
                }}
              />

              <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/80" />
              <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/80" />

              <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-black/20" />
            </div>
          )}
        </div>

        {/* Instruction bubble */}
        {activeCorner === null && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-4 py-2 text-xs font-medium text-white/80 shadow-lg backdrop-blur-md sm:bottom-6">
            Drag a corner to adjust the document
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="relative z-20 shrink-0 border-t border-white/10 bg-black/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <button
            type="button"
            disabled={detecting}
            onClick={onAutoDetect}
            className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-[14px] font-semibold text-white transition hover:bg-white/15 disabled:opacity-40"
          >
            {detecting ? "Detecting..." : "Reset to Auto"}
          </button>

          <button
            type="button"
            onClick={onApply}
            className="flex-1 rounded-xl bg-blue-500 px-5 py-3 text-[14px] font-bold text-white transition hover:bg-blue-400 active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function DocumentScanner() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const cameraRef = useRef<HTMLInputElement | null>(null);

  const pagesRef = useRef<ScannerPage[]>([]);

  const dragPageId = useRef<string | null>(null);

  const [pages, setPages] = useState<ScannerPage[]>([]);

  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const [draggingPage, setDraggingPage] = useState<string | null>(null);

  const [editor, setEditor] = useState<EditorState | null>(null);

  const [detectingPageId, setDetectingPageId] = useState<string | null>(null);

  const [filename, setFilename] = useState("Scanned-Document");

  const [imageFormat, setImageFormat] = useState<ExportFormat>("jpg");

  const [pdfPageSize, setPdfPageSize] = useState<PdfPageSize>("auto");

  const [quality, setQuality] = useState<QualityMode>("balanced");

  const [isProcessing, setIsProcessing] = useState(false);

  const [processingText, setProcessingText] = useState("");

  const [error, setError] = useState("");

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    return () => {
      pagesRef.current.forEach((page) => {
        URL.revokeObjectURL(page.previewUrl);
      });
    };
  }, []);

  function updatePage(id: string, changes: Partial<ScannerPage>) {
    setPages((current) =>
      current.map((page) =>
        page.id === id
          ? {
              ...page,
              ...changes,
            }
          : page,
      ),
    );
  }

  async function runDetection(page: ScannerPage, openEditor = false) {
    try {
      setDetectingPageId(page.id);

      setError("");

      const result = await detectDocument(page.previewUrl);

      updatePage(page.id, {
        corners: result.corners,
        detected: result.detected,
        detectionAttempted: true,
      });

      if (openEditor) {
        setEditor({
          pageId: page.id,
          corners: cloneCorners(result.corners),
        });
      }

      return result;
    } catch (caught) {
      console.error("Document detection error:", caught);

      const fallback = cloneCorners(DEFAULT_CORNERS);

      updatePage(page.id, {
        corners: fallback,
        detected: false,
        detectionAttempted: true,
      });

      if (openEditor) {
        setEditor({
          pageId: page.id,
          corners: fallback,
        });
      }

      setError(
        "Automatic edge detection could not find the document clearly. You can adjust the four corners manually.",
      );

      return {
        corners: fallback,
        detected: false,
      };
    } finally {
      setDetectingPageId(null);
    }
  }

  function addFiles(files: FileList | File[]) {
    const selected = Array.from(files);

    if (selected.length === 0) {
      return;
    }

    const valid: File[] = [];
    let skipped = 0;

    selected.forEach((file) => {
      if (
        !isSupportedImage(file) ||
        file.size === 0 ||
        file.size > MAX_FILE_SIZE
      ) {
        skipped++;
        return;
      }

      valid.push(file);
    });

    if (skipped > 0) {
      setError(
        `${skipped} ${
          skipped === 1 ? "file was" : "files were"
        } skipped. Use JPG, PNG or WebP images up to 25 MB each.`,
      );
    } else {
      setError("");
    }

    if (valid.length === 0) {
      return;
    }

    const newPages = valid.map<ScannerPage>((file) => ({
      id: createId(),
      file,
      previewUrl: URL.createObjectURL(file),
      mode: "original",
      rotation: 0,
      corners: cloneCorners(DEFAULT_CORNERS),
      detected: false,
      detectionAttempted: false,
    }));

    setPages((current) => [...current, ...newPages]);
  }

  function deletePage(id: string) {
    setPages((current) => {
      const target = current.find((page) => page.id === id);

      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((page) => page.id !== id);
    });
  }

  function clearAll() {
    if (isProcessing) return;

    pages.forEach((page) => {
      URL.revokeObjectURL(page.previewUrl);
    });

    setPages([]);
    setEditor(null);
    setError("");
  }

  function resetPage(id: string) {
    updatePage(id, {
      mode: "original",
      rotation: 0,
      corners: cloneCorners(DEFAULT_CORNERS),
      detected: false,
      detectionAttempted: false,
    });
  }

  function movePage(draggedId: string, targetId: string) {
    if (draggedId === targetId) {
      return;
    }

    setPages((current) => {
      const oldIndex = current.findIndex((page) => page.id === draggedId);

      const newIndex = current.findIndex((page) => page.id === targetId);

      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }

      const next = [...current];

      const [moved] = next.splice(oldIndex, 1);

      next.splice(newIndex, 0, moved);

      return next;
    });
  }

  async function selectScanMode(page: ScannerPage, mode: ScanMode) {
    if (mode === "original") {
      updatePage(page.id, {
        mode,
      });

      return;
    }

    /*
     * The first time a real scan
     * mode is selected, detect the
     * document automatically.
     */
    if (!page.detectionAttempted) {
      const result = await runDetection(page);

      updatePage(page.id, {
        mode,
        corners: result.corners,
        detected: result.detected,
        detectionAttempted: true,
      });

      return;
    }

    updatePage(page.id, {
      mode,
    });
  }

  function openCornerEditor(page: ScannerPage) {
    if (!page.detectionAttempted) {
      void runDetection(page, true);

      return;
    }

    setEditor({
      pageId: page.id,
      corners: cloneCorners(page.corners),
    });
  }

  async function downloadSinglePage(page: ScannerPage, index: number) {
    try {
      setIsProcessing(true);
      setError("");

      setProcessingText(`Preparing page ${index + 1}...`);

      const result = await renderPage(page, imageFormat, quality);

      const extension = imageFormat === "png" ? "png" : "jpg";

      downloadBlob(
        result.blob,
        `${safeFilename(filename)}-page-${index + 1}.${extension}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The image could not be downloaded.",
      );
    } finally {
      setIsProcessing(false);
      setProcessingText("");
    }
  }

  async function exportPhotos() {
    if (pages.length === 0) {
      return;
    }

    try {
      setIsProcessing(true);
      setError("");

      const extension = imageFormat === "png" ? "png" : "jpg";

      if (pages.length === 1) {
        setProcessingText("Preparing your photo...");

        const result = await renderPage(pages[0], imageFormat, quality);

        downloadBlob(result.blob, `${safeFilename(filename)}.${extension}`);

        return;
      }

      const zip = new JSZip();

      for (let index = 0; index < pages.length; index++) {
        setProcessingText(`Processing page ${index + 1} of ${pages.length}...`);

        const result = await renderPage(pages[index], imageFormat, quality);

        const number = String(index + 1).padStart(2, "0");

        zip.file(
          `${safeFilename(filename)}-page-${number}.${extension}`,
          result.blob,
        );
      }

      setProcessingText("Creating photo package...");

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: {
          level: 6,
        },
      });

      downloadBlob(zipBlob, `${safeFilename(filename)}-photos.zip`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The photos could not be exported.",
      );
    } finally {
      setIsProcessing(false);
      setProcessingText("");
    }
  }

  async function exportPdf() {
    if (pages.length === 0) {
      return;
    }

    try {
      setIsProcessing(true);
      setError("");

      const pdf = await PDFDocument.create();

      for (let index = 0; index < pages.length; index++) {
        setProcessingText(
          `Creating PDF page ${index + 1} of ${pages.length}...`,
        );

        const processed = await renderPage(pages[index], "jpg", quality);

        const bytes = await processed.blob.arrayBuffer();

        const image = await pdf.embedJpg(bytes);

        if (pdfPageSize === "a4") {
          const A4_WIDTH = 595.28;

          const A4_HEIGHT = 841.89;

          const landscape = processed.width > processed.height;

          const pageWidth = landscape ? A4_HEIGHT : A4_WIDTH;

          const pageHeight = landscape ? A4_WIDTH : A4_HEIGHT;

          const margin = 18;

          const availableWidth = pageWidth - margin * 2;

          const availableHeight = pageHeight - margin * 2;

          const scale = Math.min(
            availableWidth / processed.width,
            availableHeight / processed.height,
          );

          const drawWidth = processed.width * scale;

          const drawHeight = processed.height * scale;

          const pdfPage = pdf.addPage([pageWidth, pageHeight]);

          pdfPage.drawImage(image, {
            x: (pageWidth - drawWidth) / 2,
            y: (pageHeight - drawHeight) / 2,
            width: drawWidth,
            height: drawHeight,
          });
        } else {
          const maxPdfSide = 1000;

          const scale = Math.min(
            1,
            maxPdfSide / Math.max(processed.width, processed.height),
          );

          const pageWidth = processed.width * scale;

          const pageHeight = processed.height * scale;

          const pdfPage = pdf.addPage([pageWidth, pageHeight]);

          pdfPage.drawImage(image, {
            x: 0,
            y: 0,
            width: pageWidth,
            height: pageHeight,
          });
        }
      }

      setProcessingText("Finishing your PDF...");

      const pdfBytes = await pdf.save();

      const output = new Uint8Array(pdfBytes.length);

      output.set(pdfBytes);

      const blob = new Blob([output.buffer], {
        type: "application/pdf",
      });

      downloadBlob(blob, `${safeFilename(filename)}.pdf`);
    } catch (caught) {
      console.error("PDF export error:", caught);

      setError(
        caught instanceof Error
          ? caught.message
          : "The PDF could not be created.",
      );
    } finally {
      setIsProcessing(false);
      setProcessingText("");
    }
  }

  const editorPage = editor
    ? pages.find((page) => page.id === editor.pageId)
    : undefined;

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            addFiles(event.target.files);
          }

          event.target.value = "";
        }}
      />

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            addFiles(event.target.files);
          }

          event.target.value = "";
        }}
      />

      {pages.length === 0 ? (
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDraggingFiles(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDraggingFiles(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();

            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              return;
            }

            setIsDraggingFiles(false);
          }}
          onDrop={(event) => {
            event.preventDefault();

            setIsDraggingFiles(false);

            if (event.dataTransfer.files.length) {
              addFiles(event.dataTransfer.files);
            }
          }}
          className={[
            "rounded-3xl border-2 border-dashed px-5 py-14 text-center transition sm:px-8 sm:py-16",
            isDraggingFiles
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl font-bold text-blue-700">
            +
          </div>

          <h2 className="mt-5 text-xl font-semibold text-gray-950">
            Scan Document
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            Select multiple document photos or take a new photo with your
            camera.
          </p>

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Select Photos
            </button>

            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="rounded-xl border border-blue-200 bg-white px-6 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              Take Photo
            </button>
          </div>

          <p className="mt-4 text-xs text-gray-400">
            JPG, PNG or WebP · Multiple pages · 25 MB each
          </p>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-950">
                Your pages
              </h2>

              <p className="mt-1 text-sm text-gray-500">
                {pages.length} {pages.length === 1 ? "page" : "pages"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => inputRef.current?.click()}
                className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                + Add Photos
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => cameraRef.current?.click()}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Camera
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={clearAll}
                className="rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((page, index) => (
              <div
                key={page.id}
                draggable={!isProcessing}
                onDragStart={() => {
                  dragPageId.current = page.id;

                  setDraggingPage(page.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();

                  const dragged = dragPageId.current;

                  if (dragged && dragged !== page.id) {
                    movePage(dragged, page.id);
                  }
                }}
                onDragEnd={() => {
                  dragPageId.current = null;

                  setDraggingPage(null);
                }}
                className={[
                  "overflow-hidden rounded-2xl border bg-white shadow-sm transition",
                  draggingPage === page.id
                    ? "scale-[0.98] border-blue-400 opacity-60"
                    : "border-gray-200",
                  !isProcessing ? "cursor-grab active:cursor-grabbing" : "",
                ].join(" ")}
              >
                <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-gray-100 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={`Page ${index + 1}`}
                    draggable={false}
                    className="max-h-full max-w-full object-contain transition duration-200"
                    style={{
                      filter: getPreviewFilter(page.mode),
                      transform: `rotate(${page.rotation}deg)`,
                    }}
                  />

                  <div className="absolute left-3 top-3 rounded-lg bg-gray-950/80 px-3 py-1 text-xs font-semibold text-white">
                    Page {index + 1}
                  </div>

                  {page.detectionAttempted && (
                    <div
                      className={[
                        "absolute right-3 top-3 rounded-lg px-3 py-1 text-xs font-semibold text-white",
                        page.detected ? "bg-green-600" : "bg-amber-600",
                      ].join(" ")}
                    >
                      {page.detected ? "Document detected" : "Manual crop"}
                    </div>
                  )}

                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-950/70 px-3 py-1 text-[11px] font-medium text-white">
                    Drag to reorder
                  </div>
                </div>

                <div className="p-4">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {page.file.name}
                  </p>

                  <p className="mt-1 text-xs text-gray-400">
                    {formatFileSize(page.file.size)}
                  </p>

                  <button
                    type="button"
                    disabled={isProcessing || detectingPageId === page.id}
                    onClick={() => openCornerEditor(page)}
                    className="mt-4 w-full rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                  >
                    {detectingPageId === page.id
                      ? "Detecting Document..."
                      : page.detectionAttempted
                        ? "Adjust Crop / Corners"
                        : "Detect & Crop Document"}
                  </button>

                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Page Style
                  </p>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {SCAN_MODES.map((mode) => {
                      const active = page.mode === mode.id;

                      return (
                        <button
                          key={mode.id}
                          type="button"
                          disabled={isProcessing || detectingPageId === page.id}
                          onClick={() => void selectScanMode(page, mode.id)}
                          className={[
                            "rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:opacity-50",
                            active
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50",
                          ].join(" ")}
                        >
                          {mode.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        updatePage(page.id, {
                          rotation: (page.rotation + 90) % 360,
                        })
                      }
                      className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      ↻ Rotate
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => resetPage(page.id)}
                      className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reset
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => void downloadSinglePage(page, index)}
                      className="rounded-xl border border-blue-200 px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Save Photo
                    </button>

                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={() => deletePage(page.id)}
                      className="rounded-xl border border-red-200 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-xl font-bold text-gray-950">Export Document</h2>

            <p className="mt-1 text-sm text-gray-500">
              Your crop, enhancement, rotation and page order will be preserved.
            </p>

            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div>
                <label
                  htmlFor="scanner-filename"
                  className="text-sm font-semibold text-gray-800"
                >
                  File name
                </label>

                <input
                  id="scanner-filename"
                  value={filename}
                  disabled={isProcessing}
                  onChange={(event) => setFilename(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-800">Quality</p>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["high", "balanced", "small"] as QualityMode[]).map(
                    (option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={isProcessing}
                        onClick={() => setQuality(option)}
                        className={[
                          "rounded-xl border px-3 py-3 text-xs font-semibold capitalize",
                          quality === option
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-gray-200 text-gray-700 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {option === "small" ? "Small File" : option}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-800">
                  PDF Page Size
                </p>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["auto", "a4"] as PdfPageSize[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => setPdfPageSize(option)}
                      className={[
                        "rounded-xl border px-4 py-3 text-sm font-semibold",
                        pdfPageSize === option
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 text-gray-700 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {option === "a4" ? "A4" : "Auto"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Photo Format
                </p>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["jpg", "png"] as ExportFormat[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={isProcessing}
                      onClick={() => setImageFormat(option)}
                      className={[
                        "rounded-xl border px-4 py-3 text-sm font-semibold uppercase",
                        imageFormat === option
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 text-gray-700 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isProcessing && (
              <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                  <div>
                    <p className="text-sm font-semibold text-blue-950">
                      Processing
                    </p>

                    <p className="mt-0.5 text-xs text-blue-700">
                      {processingText}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => void exportPdf()}
                className="rounded-xl bg-blue-600 px-6 py-4 font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Save as PDF
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={() => void exportPhotos()}
                className="rounded-xl bg-green-600 px-6 py-4 font-bold text-white hover:bg-green-700 disabled:opacity-50"
              >
                Save as Photos
              </button>
            </div>

            <p className="mt-4 text-center text-xs text-gray-400">
              Document processing happens in your browser. Selected images are
              not uploaded to the ConvertFlow server.
            </p>
          </div>
        </>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm font-semibold text-red-800">Notice</p>

          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}

      {editor && editorPage && (
        <CornerEditor
          page={editorPage}
          corners={editor.corners}
          detecting={detectingPageId === editorPage.id}
          onChange={(corners) =>
            setEditor((current) =>
              current
                ? {
                    ...current,
                    corners,
                  }
                : current,
            )
          }
          onCancel={() => setEditor(null)}
          onApply={() => {
            updatePage(editorPage.id, {
              corners: cloneCorners(editor.corners),
              detectionAttempted: true,
            });

            setEditor(null);
          }}
          onAutoDetect={() => {
            void (async () => {
              const result = await runDetection(editorPage);

              setEditor((current) =>
                current
                  ? {
                      ...current,
                      corners: cloneCorners(result.corners),
                    }
                  : current,
              );
            })();
          }}
        />
      )}
    </div>
  );
}

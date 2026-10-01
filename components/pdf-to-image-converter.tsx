"use client";

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import JSZip from "jszip";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist";

type ExportFormat = "jpg" | "png";
type QualityMode = "high" | "balanced" | "small";

type PageItem = {
  pageNumber: number;
  thumbnail: string;
  width: number;
  height: number;
  selected: boolean;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_RENDER_SIDE = 5000;

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

function isPdf(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
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
    .replace(/\.pdf$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ");

  return cleaned || "converted-pages";
}

function padPageNumber(pageNumber: number, totalPages: number) {
  const width = Math.max(2, String(totalPages).length);
  return String(pageNumber).padStart(width, "0");
}

function getRenderSettings(mode: QualityMode) {
  switch (mode) {
    case "high":
      return {
        scale: 3,
        jpgQuality: 0.94,
      };

    case "small":
      return {
        scale: 1.25,
        jpgQuality: 0.72,
      };

    default:
      return {
        scale: 2,
        jpgQuality: 0.86,
      };
  }
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
          reject(new Error("The image could not be created."));
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

  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function makeThumbnail(page: PDFPageProxy) {
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = 260;
  const scale = Math.min(0.5, targetWidth / Math.max(1, baseViewport.width));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Your browser could not create the PDF preview.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    background: "rgb(255,255,255)",
  }).promise;

  return {
    thumbnail: canvas.toDataURL("image/jpeg", 0.76),
    width: Math.round(baseViewport.width),
    height: Math.round(baseViewport.height),
  };
}

async function renderPdfPage(
  page: PDFPageProxy,
  format: ExportFormat,
  quality: QualityMode,
) {
  const baseViewport = page.getViewport({ scale: 1 });
  const settings = getRenderSettings(quality);
  const sideLimitScale =
    MAX_RENDER_SIDE / Math.max(baseViewport.width, baseViewport.height, 1);
  const finalScale = Math.min(settings.scale, sideLimitScale);
  const viewport = page.getViewport({ scale: finalScale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));

  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Your browser could not render this PDF page.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
    background: "rgb(255,255,255)",
  }).promise;

  const mime = format === "png" ? "image/png" : "image/jpeg";
  const blob = await canvasToBlob(
    canvas,
    mime,
    format === "jpg" ? settings.jpgQuality : undefined,
  );

  return {
    blob,
    width: canvas.width,
    height: canvas.height,
  };
}

export function PdfToImageConverter() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [format, setFormat] = useState<ExportFormat>("jpg");
  const [quality, setQuality] = useState<QualityMode>("balanced");
  const [filename, setFilename] = useState("converted-pages");
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const selectedPages = useMemo(
    () => pages.filter((page) => page.selected),
    [pages],
  );

  useEffect(() => {
    return () => {
      const loadingTask = loadingTaskRef.current;

      loadingTaskRef.current = null;
      pdfRef.current = null;

      if (loadingTask) {
        void loadingTask.destroy();
      }
    };
  }, []);

  async function clearCurrentPdf() {
    const currentLoadingTask = loadingTaskRef.current;

    loadingTaskRef.current = null;
    pdfRef.current = null;

    if (currentLoadingTask) {
      try {
        await currentLoadingTask.destroy();
      } catch {
        // Nothing else is required during cleanup.
      }
    }

    setFile(null);
    setPages([]);
    setProgress(0);
    setProgressText("");
  }

  async function loadPdf(nextFile: File) {
    if (!isPdf(nextFile)) {
      setError("Please select a PDF file.");
      return;
    }

    if (nextFile.size === 0) {
      setError("This PDF is empty.");
      return;
    }

    if (nextFile.size > MAX_FILE_SIZE) {
      setError("Please use a PDF smaller than 100 MB for browser conversion.");
      return;
    }

    try {
      setIsLoading(true);
      setError("");
      setProgress(0);
      setProgressText("Opening PDF...");

      await clearCurrentPdf();

      const pdfjs = await getPdfJs();
      const buffer = await nextFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
      });

      loadingTaskRef.current = loadingTask;

      const pdf = await loadingTask.promise;

      pdfRef.current = pdf;
      setFile(nextFile);
      setFilename(safeFilename(nextFile.name));

      const nextPages: PageItem[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        setProgressText(`Creating preview ${pageNumber} of ${pdf.numPages}...`);
        setProgress(Math.round((pageNumber / pdf.numPages) * 100));

        const pdfPage = await pdf.getPage(pageNumber);
        const preview = await makeThumbnail(pdfPage);

        nextPages.push({
          pageNumber,
          thumbnail: preview.thumbnail,
          width: preview.width,
          height: preview.height,
          selected: true,
        });

        setPages([...nextPages]);
        pdfPage.cleanup();
      }

      setProgressText("");
      setProgress(100);
    } catch (caught) {
      console.error("PDF open error:", caught);

      const message =
        caught instanceof Error ? caught.message.toLowerCase() : "";

      if (message.includes("password")) {
        setError(
          "This PDF is password protected. Remove the password first, then try again.",
        );
      } else {
        setError(
          caught instanceof Error
            ? caught.message
            : "The PDF could not be opened. It may be damaged or unsupported.",
        );
      }

      await clearCurrentPdf();
    } finally {
      setIsLoading(false);
      setProgressText("");
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";

    if (selected) {
      void loadPdf(selected);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const dropped = Array.from(event.dataTransfer.files).find(isPdf);

    if (!dropped) {
      setError("Drop a PDF file here.");
      return;
    }

    void loadPdf(dropped);
  }

  function togglePage(pageNumber: number) {
    if (isExporting) return;

    setPages((current) =>
      current.map((page) =>
        page.pageNumber === pageNumber
          ? {
              ...page,
              selected: !page.selected,
            }
          : page,
      ),
    );
  }

  function setAllPages(selected: boolean) {
    if (isExporting) return;

    setPages((current) =>
      current.map((page) => ({
        ...page,
        selected,
      })),
    );
  }

  async function exportOne(pageNumber: number) {
    const pdf = pdfRef.current;

    if (!pdf) return;

    try {
      setIsExporting(true);
      setError("");
      setProgress(0);
      setProgressText(`Rendering page ${pageNumber}...`);

      const pdfPage = await pdf.getPage(pageNumber);
      const rendered = await renderPdfPage(pdfPage, format, quality);
      pdfPage.cleanup();

      const extension = format === "png" ? "png" : "jpg";
      const pageLabel = padPageNumber(pageNumber, pdf.numPages);

      downloadBlob(
        rendered.blob,
        `${safeFilename(filename)}-page-${pageLabel}.${extension}`,
      );

      setProgress(100);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "This PDF page could not be converted.",
      );
    } finally {
      setIsExporting(false);
      setProgressText("");
    }
  }

  async function exportSelected() {
    const pdf = pdfRef.current;

    if (!pdf || selectedPages.length === 0) {
      setError("Select at least one page to convert.");
      return;
    }

    try {
      setIsExporting(true);
      setError("");
      setProgress(0);

      const extension = format === "png" ? "png" : "jpg";
      const outputName = safeFilename(filename);

      if (selectedPages.length === 1) {
        const item = selectedPages[0];
        setProgressText(`Rendering page ${item.pageNumber}...`);

        const pdfPage = await pdf.getPage(item.pageNumber);
        const rendered = await renderPdfPage(pdfPage, format, quality);
        pdfPage.cleanup();

        const pageLabel = padPageNumber(item.pageNumber, pdf.numPages);
        downloadBlob(
          rendered.blob,
          `${outputName}-page-${pageLabel}.${extension}`,
        );

        setProgress(100);
        return;
      }

      const zip = new JSZip();

      for (let index = 0; index < selectedPages.length; index++) {
        const item = selectedPages[index];
        setProgressText(
          `Converting page ${index + 1} of ${selectedPages.length}...`,
        );
        setProgress(Math.round((index / selectedPages.length) * 90));

        const pdfPage = await pdf.getPage(item.pageNumber);
        const rendered = await renderPdfPage(pdfPage, format, quality);
        pdfPage.cleanup();

        const pageLabel = padPageNumber(item.pageNumber, pdf.numPages);
        zip.file(`${outputName}-page-${pageLabel}.${extension}`, rendered.blob);
      }

      setProgressText("Creating ZIP file...");
      setProgress(94);

      const zipBlob = await zip.generateAsync(
        {
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: {
            level: 6,
          },
        },
        (metadata) => {
          setProgress(94 + Math.round(metadata.percent * 0.06));
        },
      );

      downloadBlob(zipBlob, `${outputName}-${extension}-images.zip`);
      setProgress(100);
    } catch (caught) {
      console.error("PDF image export error:", caught);
      setError(
        caught instanceof Error
          ? caught.message
          : "The PDF pages could not be converted.",
      );
    } finally {
      setIsExporting(false);
      setProgressText("");
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={handleFileInput}
      />

      {!file ? (
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();

            if (
              event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              return;
            }

            setIsDragging(false);
          }}
          onDrop={handleDrop}
          className={[
            "rounded-3xl border-2 border-dashed px-5 py-14 text-center transition sm:px-8 sm:py-16",
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-bold text-blue-700">
            PDF
          </div>

          <h2 className="mt-5 text-xl font-semibold text-gray-950">
            Drop your PDF here
          </h2>

          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">
            Convert every PDF page into a clean JPG or PNG image directly in
            your browser.
          </p>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? "Opening PDF..." : "Select PDF"}
          </button>

          <p className="mt-4 text-xs text-gray-400">
            PDF up to 100 MB · No watermark · Browser-based processing
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-gray-950">
                  {file.name}
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  {pages.length} {pages.length === 1 ? "page" : "pages"} ·{" "}
                  {formatFileSize(file.size)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isLoading || isExporting}
                  onClick={() => inputRef.current?.click()}
                  className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  Replace PDF
                </button>

                <button
                  type="button"
                  disabled={isLoading || isExporting}
                  onClick={() => void clearCurrentPdf()}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="grid gap-5 md:grid-cols-3">
              <div>
                <label
                  htmlFor="pdf-image-filename"
                  className="text-sm font-semibold text-gray-800"
                >
                  Output name
                </label>

                <input
                  id="pdf-image-filename"
                  value={filename}
                  disabled={isExporting}
                  onChange={(event) => setFilename(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                />
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-800">
                  Image format
                </p>

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["jpg", "png"] as ExportFormat[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={isExporting}
                      onClick={() => setFormat(option)}
                      className={[
                        "rounded-xl border px-4 py-3 text-sm font-semibold uppercase transition disabled:opacity-50",
                        format === option
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-800">Quality</p>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["high", "balanced", "small"] as QualityMode[]).map(
                    (option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={isExporting}
                        onClick={() => setQuality(option)}
                        className={[
                          "rounded-xl border px-2 py-3 text-xs font-semibold capitalize transition disabled:opacity-50",
                          quality === option
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        {option === "small" ? "Small file" : option}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 border-t border-gray-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => setAllPages(true)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Select All
                </button>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => setAllPages(false)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Clear Selection
                </button>

                <span className="text-xs font-medium text-gray-500">
                  {selectedPages.length} of {pages.length} selected
                </span>
              </div>

              <button
                type="button"
                disabled={
                  isExporting || isLoading || selectedPages.length === 0
                }
                onClick={() => void exportSelected()}
                className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isExporting
                  ? "Converting..."
                  : selectedPages.length > 1
                    ? `Convert ${selectedPages.length} Pages`
                    : "Convert Selected Page"}
              </button>
            </div>
          </div>

          {(isLoading || isExporting) && (
            <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-blue-950">
                      {isLoading ? "Loading PDF" : "Converting"}
                    </p>
                    <p className="text-xs font-semibold text-blue-700">
                      {progress}%
                    </p>
                  </div>

                  <p className="mt-0.5 truncate text-xs text-blue-700">
                    {progressText}
                  </p>

                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-[width] duration-200"
                      style={{
                        width: `${Math.max(0, Math.min(100, progress))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pages.map((page) => (
              <div
                key={page.pageNumber}
                onClick={() => togglePage(page.pageNumber)}
                className={[
                  "group overflow-hidden rounded-2xl border bg-white shadow-sm transition",
                  page.selected
                    ? "border-blue-500 ring-2 ring-blue-100"
                    : "border-gray-200 hover:border-gray-300",
                  isExporting ? "cursor-default" : "cursor-pointer",
                ].join(" ")}
              >
                <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-gray-100 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.thumbnail}
                    alt={`PDF page ${page.pageNumber}`}
                    draggable={false}
                    className="max-h-full max-w-full object-contain shadow-sm"
                  />

                  <div className="absolute left-3 top-3 rounded-lg bg-gray-950/80 px-2.5 py-1 text-xs font-semibold text-white">
                    Page {page.pageNumber}
                  </div>

                  <div
                    className={[
                      "absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold shadow-sm",
                      page.selected
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-white bg-white text-transparent",
                    ].join(" ")}
                    aria-hidden="true"
                  >
                    ✓
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Page {page.pageNumber}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {page.width} × {page.height} PDF points
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isExporting || isLoading}
                      onClick={(event) => {
                        event.stopPropagation();
                        void exportOne(page.pageNumber);
                      }}
                      className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Download
                    </button>
                  </div>
                </div>
              </div>
            ))}
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

      <div className="mt-6 rounded-2xl border border-green-100 bg-green-50 p-4">
        <p className="text-sm font-semibold text-green-900">
          Private browser conversion
        </p>
        <p className="mt-1 text-sm text-green-800/80">
          Your PDF is rendered into images in your browser. ConvertFlow does not
          add a watermark to the exported JPG or PNG files.
        </p>
      </div>
    </div>
  );
}

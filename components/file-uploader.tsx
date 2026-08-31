"use client";

import { useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";

import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

type UploadedFile = {
  id: string;
  file: File;
};

type FileUploaderProps = {
  multiple?: boolean;
  accept?: string;
  maxFiles?: number;
};

type SortableFileProps = {
  item: UploadedFile;
  index: number;
  onRemove: (id: string) => void;
};

type FlowStage =
  | "idle"
  | "selected"
  | "processing"
  | "ready"
  | "download-started";

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";

  const units = ["Bytes", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function SortableFile({ item, index, onRemove }: SortableFileProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        "flex cursor-grab touch-none select-none items-center gap-4",
        "rounded-2xl border bg-white p-4",
        "transition-[box-shadow,border-color]",
        "active:cursor-grabbing",
        isDragging
          ? "z-20 border-blue-400 shadow-xl"
          : "border-gray-200 hover:border-blue-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div
        aria-hidden="true"
        className="flex h-11 w-7 shrink-0 items-center justify-center text-xl text-gray-300"
      >
        ⠿
      </div>

      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xs font-bold text-red-600">
        PDF
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-400">
            {index + 1}.
          </span>

          <p className="truncate font-medium text-gray-900">{item.file.name}</p>
        </div>

        <p className="mt-1 text-xs text-gray-500">
          {formatFileSize(item.file.size)}
        </p>
      </div>

      <button
        type="button"
        aria-label={`Remove ${item.file.name}`}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item.id);
        }}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-xl text-gray-400 transition hover:bg-red-50 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

function FileFlow({ stage, progress }: { stage: FlowStage; progress: number }) {
  const stageOrder: FlowStage[] = [
    "selected",
    "processing",
    "ready",
    "download-started",
  ];

  const activeIndex = stageOrder.indexOf(stage);

  const steps = [
    {
      id: "selected" as FlowStage,
      title: "Files selected",
      description: "Your PDFs are ready and arranged.",
    },
    {
      id: "processing" as FlowStage,
      title: "Processing",
      description: "ConvertFlow is combining the PDF pages.",
    },
    {
      id: "ready" as FlowStage,
      title: "Ready",
      description: "Your merged PDF has been created.",
    },
    {
      id: "download-started" as FlowStage,
      title: "Download",
      description: "Your browser has started the download.",
    },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-950">File flow</h3>

          <p className="mt-1 text-sm text-gray-500">
            Follow your file through each stage.
          </p>
        </div>

        {stage === "processing" && (
          <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-600">
            {progress}%
          </span>
        )}
      </div>

      <div className="relative">
        <div className="absolute bottom-5 left-[19px] top-5 w-0.5 bg-gray-200" />

        <div
          className="absolute left-[19px] top-5 w-0.5 bg-blue-600 transition-all duration-500"
          style={{
            height:
              activeIndex <= 0
                ? "0%"
                : activeIndex === 1
                  ? `${Math.max(10, progress * 0.33)}%`
                  : activeIndex === 2
                    ? "67%"
                    : "100%",
          }}
        />

        <div className="relative space-y-7">
          {steps.map((step, index) => {
            const isCompleted = activeIndex > index;
            const isActive = activeIndex === index;

            return (
              <div key={step.id} className="flex items-start gap-4">
                <div
                  className={[
                    "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 bg-white text-sm font-bold transition-all duration-300",
                    isCompleted
                      ? "border-green-500 bg-green-500 text-white"
                      : isActive
                        ? "border-blue-600 bg-blue-600 text-white shadow-md"
                        : "border-gray-300 text-gray-400",
                  ].join(" ")}
                >
                  {isCompleted ? "✓" : index + 1}
                </div>

                <div className="min-w-0 pt-1">
                  <p
                    className={[
                      "font-semibold transition",
                      isCompleted || isActive
                        ? "text-gray-950"
                        : "text-gray-400",
                    ].join(" ")}
                  >
                    {step.title}
                  </p>

                  <p
                    className={[
                      "mt-1 text-sm",
                      isCompleted || isActive
                        ? "text-gray-500"
                        : "text-gray-400",
                    ].join(" ")}
                  >
                    {step.description}
                  </p>

                  {step.id === "processing" && stage === "processing" && (
                    <div className="mt-3 w-full max-w-md">
                      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all duration-300"
                          style={{
                            width: `${progress}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function FileUploader({
  multiple = true,
  accept,
  maxFiles = 20,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<UploadedFile[]>([]);

  const [isDraggingOverUploader, setIsDraggingOverUploader] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);

  const [progress, setProgress] = useState(0);

  const [error, setError] = useState("");

  const [downloadUrl, setDownloadUrl] = useState("");

  const [flowStage, setFlowStage] = useState<FlowStage>("idle");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),

    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  function clearResult() {
    setError("");
    setProgress(0);

    if (files.length > 0) {
      setFlowStage("selected");
    } else {
      setFlowStage("idle");
    }

    setDownloadUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }

      return "";
    });
  }

  function addFiles(selectedFiles: FileList | File[]) {
    const incoming = Array.from(selectedFiles);

    if (incoming.length === 0) {
      return;
    }

    setError("");
    setProgress(0);

    setDownloadUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }

      return "";
    });

    setFiles((current) => {
      const availableSlots = maxFiles - current.length;

      if (availableSlots <= 0) {
        return current;
      }

      const limitedFiles = incoming.slice(0, availableSlots);

      const pdfFiles = limitedFiles.filter(
        (file) =>
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf"),
      );

      if (pdfFiles.length !== limitedFiles.length) {
        setError("Only PDF files can be added to this tool.");
      }

      const newFiles = pdfFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
      }));

      if (newFiles.length > 0) {
        setFlowStage("selected");
      }

      return [...current, ...newFiles];
    });
  }

  function removeFile(id: string) {
    setFiles((current) => {
      const updated = current.filter((item) => item.id !== id);

      if (updated.length === 0) {
        setFlowStage("idle");
      } else {
        setFlowStage("selected");
      }

      return updated;
    });

    setError("");
    setProgress(0);

    setDownloadUrl((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }

      return "";
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    setFiles((current) => {
      const oldIndex = current.findIndex((item) => item.id === active.id);

      const newIndex = current.findIndex((item) => item.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex);
    });

    clearResult();
    setFlowStage("selected");
  }

  async function mergePdfs() {
    if (files.length < 2) {
      setError("Please select at least two PDF files.");
      return;
    }

    try {
      setError("");
      setIsProcessing(true);
      setProgress(0);
      setFlowStage("processing");

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
        setDownloadUrl("");
      }

      const mergedPdf = await PDFDocument.create();

      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        const currentFile = files[fileIndex].file;

        const fileBuffer = await currentFile.arrayBuffer();

        const sourcePdf = await PDFDocument.load(fileBuffer);

        const pages = await mergedPdf.copyPages(
          sourcePdf,
          sourcePdf.getPageIndices(),
        );

        pages.forEach((page) => {
          mergedPdf.addPage(page);
        });

        const currentProgress = Math.round(
          ((fileIndex + 1) / files.length) * 90,
        );

        setProgress(currentProgress);

        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      setProgress(95);

      const mergedBytes = await mergedPdf.save();

      const pdfBuffer = new ArrayBuffer(mergedBytes.byteLength);

      new Uint8Array(pdfBuffer).set(mergedBytes);

      const blob = new Blob([pdfBuffer], {
        type: "application/pdf",
      });

      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);

      setProgress(100);

      setFlowStage("ready");
    } catch (err) {
      console.error(err);

      setProgress(0);

      setFlowStage("selected");

      setError(
        err instanceof Error ? err.message : "Unable to merge these PDF files.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function handleDownloadStarted() {
    setFlowStage("download-started");
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple={multiple}
        accept={accept}
        onChange={(event) => {
          if (event.target.files) {
            addFiles(event.target.files);
          }

          event.target.value = "";
        }}
      />

      {/* UPLOAD / FILE SELECTION */}

      <div
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();

          setIsDraggingOverUploader(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();

          setIsDraggingOverUploader(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();

          if (
            event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            return;
          }

          setIsDraggingOverUploader(false);
        }}
        onDrop={(event) => {
          event.preventDefault();

          setIsDraggingOverUploader(false);

          if (event.dataTransfer.files.length > 0) {
            addFiles(event.dataTransfer.files);
          }
        }}
        className={[
          "cursor-pointer rounded-3xl border-2 border-dashed px-6 py-14 text-center transition-all duration-300",
          isDraggingOverUploader
            ? "scale-[1.01] border-blue-500 bg-blue-50"
            : "border-gray-300 bg-white hover:border-blue-400",
        ].join(" ")}
      >
        <div className="mx-auto max-w-md">
          <div
            className={[
              "mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-3xl transition-all duration-300",
              isDraggingOverUploader
                ? "translate-y-1 bg-blue-100 text-blue-700"
                : "bg-blue-50 text-blue-600",
            ].join(" ")}
          >
            ↓
          </div>

          <h3 className="mt-5 text-xl font-semibold text-gray-950">
            Drop your PDFs here
          </h3>

          <p className="mt-2 text-sm text-gray-500">
            Drag multiple PDF files here or choose them from your computer.
          </p>

          <button
            type="button"
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Select PDF Files
          </button>

          <p className="mt-4 text-xs text-gray-400">Maximum {maxFiles} files</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-8 space-y-8">
          {/* FILE FLOW */}

          <FileFlow stage={flowStage} progress={progress} />

          {/* FILE ARRANGEMENT */}

          <div>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-950">
                  Arrange your PDFs
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  Grab any part of a file card and move it to the position you
                  want.
                </p>
              </div>

              <span className="shrink-0 text-sm text-gray-500">
                {files.length}/{maxFiles}
              </span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={files.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {files.map((item, index) => (
                    <SortableFile
                      key={item.id}
                      item={item}
                      index={index}
                      onRemove={removeFile}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="mt-5 text-center">
              <button
                type="button"
                disabled={files.length >= maxFiles || isProcessing}
                onClick={() => inputRef.current?.click()}
                className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Add More PDFs
              </button>
            </div>
          </div>

          {/* ACTION */}

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            {!downloadUrl && (
              <button
                type="button"
                onClick={mergePdfs}
                disabled={files.length < 2 || isProcessing}
                className="w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {isProcessing
                  ? `Merging PDFs — ${progress}%`
                  : files.length < 2
                    ? "Add at least 2 PDFs to merge"
                    : `Merge ${files.length} PDFs`}
              </button>
            )}

            {files.length >= 2 && !isProcessing && !downloadUrl && (
              <p className="mt-3 text-center text-xs text-gray-500">
                PDFs will be merged in exactly the order shown above.
              </p>
            )}

            {error && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            {downloadUrl && (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-2xl font-bold text-green-700">
                  ✓
                </div>

                <h3 className="mt-3 text-xl font-bold text-gray-950">
                  Your merged PDF is ready
                </h3>

                <p className="mt-2 text-sm text-gray-600">
                  {files.length} PDF files were successfully combined.
                </p>

                <a
                  href={downloadUrl}
                  download="ConvertFlow-Merged.pdf"
                  onClick={handleDownloadStarted}
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-4 font-bold text-white transition hover:bg-green-700 sm:w-auto"
                >
                  ↓ Download Merged PDF
                </a>

                {flowStage === "download-started" && (
                  <p
                    role="status"
                    className="mt-4 text-sm font-medium text-green-700"
                  >
                    Download started.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

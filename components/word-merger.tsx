"use client";

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
import { useMemo, useRef, useState } from "react";

type WordFileItem = {
  id: string;
  file: File;
};

type SortableWordCardProps = {
  item: WordFileItem;
  index: number;
  onRemove: (id: string) => void;
};

const MAX_FILES = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes === 0) {
    return "0 Bytes";
  }

  const units = ["Bytes", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function isDocxFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function SortableWordCard({ item, index, onRemove }: SortableWordCardProps) {
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
        "flex cursor-grab touch-none select-none items-center gap-4 rounded-2xl border bg-white p-4 transition",
        "active:cursor-grabbing",
        isDragging
          ? "z-20 border-blue-400 shadow-xl"
          : "border-gray-200 hover:border-blue-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">
        DOCX
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-400">
            {index + 1}.
          </span>

          <p className="truncate font-medium text-gray-950">{item.file.name}</p>
        </div>

        <p className="mt-1 text-xs text-gray-500">
          {formatFileSize(item.file.size)}
        </p>
      </div>

      <div className="shrink-0 text-xl text-gray-300">⠿</div>

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
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl text-gray-400 transition hover:bg-red-50 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

export function WordMerger() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<WordFileItem[]>([]);

  const [isDraggingOverUploader, setIsDraggingOverUploader] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);

  const [error, setError] = useState("");

  const [downloadUrl, setDownloadUrl] = useState("");

  const [downloadSize, setDownloadSize] = useState<number | null>(null);

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

  const totalSize = useMemo(
    () => files.reduce((sum, item) => sum + item.file.size, 0),
    [files],
  );

  function clearDownload() {
    setDownloadUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });

    setDownloadSize(null);
  }

  function addFiles(selectedFiles: FileList | File[]) {
    const incoming = Array.from(selectedFiles);

    if (incoming.length === 0) {
      return;
    }

    setError("");
    clearDownload();

    const availableSlots = MAX_FILES - files.length;

    if (availableSlots <= 0) {
      setError(`You can merge up to ${MAX_FILES} Word documents.`);

      return;
    }

    const limited = incoming.slice(0, availableSlots);

    const accepted: File[] = [];
    const skippedNames: string[] = [];

    for (const file of limited) {
      if (!isDocxFile(file) || file.size > MAX_FILE_SIZE) {
        skippedNames.push(file.name);
        continue;
      }

      accepted.push(file);
    }

    const currentSize = files.reduce((sum, item) => sum + item.file.size, 0);

    let runningSize = currentSize;

    const sizeSafeFiles: File[] = [];

    for (const file of accepted) {
      if (runningSize + file.size > MAX_TOTAL_SIZE) {
        skippedNames.push(file.name);
        continue;
      }

      runningSize += file.size;
      sizeSafeFiles.push(file);
    }

    if (sizeSafeFiles.length > 0) {
      const mapped = sizeSafeFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
      }));

      setFiles((current) => [...current, ...mapped]);
    }

    if (skippedNames.length > 0) {
      setError(
        "Some files were skipped. Only .docx files up to 25 MB each are supported, with a 100 MB total limit.",
      );
    }

    if (incoming.length > availableSlots) {
      setError(
        `Only the first ${availableSlots} files were considered because the limit is ${MAX_FILES} documents.`,
      );
    }
  }

  function removeFile(id: string) {
    setError("");
    clearDownload();

    setFiles((current) => current.filter((item) => item.id !== id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    setError("");
    clearDownload();

    setFiles((current) => {
      const oldIndex = current.findIndex((item) => item.id === active.id);

      const newIndex = current.findIndex((item) => item.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex);
    });
  }

  async function mergeWordFiles() {
    if (files.length < 2) {
      setError("Please select at least two Word documents.");

      return;
    }

    try {
      setError("");
      clearDownload();
      setIsProcessing(true);

      const formData = new FormData();

      for (const item of files) {
        formData.append("files", item.file);
      }

      const response = await fetch("/api/merge-word", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let message = "Unable to merge the Word documents.";

        try {
          const data = await response.json();

          if (typeof data?.error === "string") {
            message = data.error;
          }
        } catch {
          // Use fallback message.
        }

        throw new Error(message);
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error("The server returned an empty Word document.");
      }

      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);
      setDownloadSize(blob.size);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while merging the Word documents.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function clearAll() {
    clearDownload();
    setFiles([]);
    setError("");
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            addFiles(event.target.files);
          }

          event.target.value = "";
        }}
      />

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
          "cursor-pointer rounded-3xl border-2 border-dashed px-6 py-14 text-center transition",
          isDraggingOverUploader
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-white hover:border-blue-400",
        ].join(" ")}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl text-blue-600">
          ↑
        </div>

        <h3 className="mt-5 text-xl font-semibold text-gray-950">
          Drop your Word documents here
        </h3>

        <p className="mt-2 text-sm text-gray-500">
          Upload multiple .docx files and merge them into one Word document.
        </p>

        <button
          type="button"
          className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Select Word Files
        </button>

        <p className="mt-4 text-xs text-gray-400">
          Up to {MAX_FILES} documents · 25 MB each · 100 MB total
        </p>
      </div>

      {files.length > 0 && (
        <div className="mt-8 space-y-8">
          <div>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-950">
                  Arrange your documents
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  Drag any card to change the final document order.
                </p>
              </div>

              <span className="shrink-0 text-sm text-gray-500">
                {files.length}/{MAX_FILES}
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
                    <SortableWordCard
                      key={item.id}
                      item={item}
                      index={index}
                      onRemove={removeFile}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                disabled={files.length >= MAX_FILES || isProcessing}
                onClick={() => inputRef.current?.click()}
                className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Add More
              </button>

              <button
                type="button"
                disabled={isProcessing}
                onClick={clearAll}
                className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-950">
              Merge summary
            </h3>

            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <div className="flex justify-between gap-4">
                <span>Documents</span>

                <span className="font-semibold text-gray-900">
                  {files.length}
                </span>
              </div>

              <div className="mt-2 flex justify-between gap-4">
                <span>Total upload size</span>

                <span className="font-semibold text-gray-900">
                  {formatFileSize(totalSize)}
                </span>
              </div>
            </div>

            {isProcessing && (
              <div
                role="status"
                aria-live="polite"
                className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                  <div>
                    <p className="text-sm font-semibold text-blue-900">
                      Merging documents...
                    </p>

                    <p className="mt-1 text-xs text-blue-700">
                      Please keep this page open while your Word documents are
                      being processed.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={mergeWordFiles}
              disabled={files.length < 2 || isProcessing}
              className="mt-7 w-full rounded-xl bg-blue-600 px-6 py-4 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isProcessing
                ? "Merging Documents..."
                : files.length < 2
                  ? "Add at least 2 documents"
                  : `Merge ${files.length} Word Documents`}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {downloadUrl && !isProcessing && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl font-bold text-green-700">
                ✓
              </div>

              <h3 className="mt-3 text-xl font-bold text-gray-950">
                Your merged Word document is ready
              </h3>

              {downloadSize !== null && (
                <p className="mt-2 text-sm text-gray-600">
                  Output size:{" "}
                  <span className="font-semibold text-gray-950">
                    {formatFileSize(downloadSize)}
                  </span>
                </p>
              )}

              <a
                href={downloadUrl}
                download="ConvertFlow-Merged-Word.docx"
                className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-4 font-bold text-white transition hover:bg-green-700 sm:w-auto"
              >
                ↓ Download Merged Word
              </a>
            </div>
          )}
        </div>
      )}

      <p className="mt-5 text-center text-xs text-gray-400">
        Your Word documents are sent to our server only for merging and are not
        stored permanently.
      </p>
    </div>
  );
}

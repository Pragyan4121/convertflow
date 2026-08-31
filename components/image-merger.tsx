"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

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

type UploadedImage = {
  id: string;
  file: File;
  previewUrl: string;
  width: number;
  height: number;
};

type MergeDirection = "vertical" | "horizontal";

type OutputFormat = "image/png" | "image/jpeg" | "image/webp";

type SortableImageCardProps = {
  item: UploadedImage;
  index: number;
  onRemove: (id: string) => void;
};

const MAX_FILES = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

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

function getExtension(outputFormat: OutputFormat) {
  if (outputFormat === "image/png") {
    return "png";
  }

  if (outputFormat === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function SortableImageCard({ item, index, onRemove }: SortableImageCardProps) {
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
        "active:cursor-grabbing",
        isDragging
          ? "z-20 border-blue-400 shadow-xl"
          : "border-gray-200 hover:border-blue-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="flex h-10 w-7 shrink-0 items-center justify-center text-xl text-gray-300">
        ⠿
      </div>

      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-100">
        <Image
          src={item.previewUrl}
          alt={item.file.name}
          fill
          unoptimized
          className="object-cover"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-400">
            {index + 1}.
          </span>

          <p className="truncate font-medium text-gray-950">{item.file.name}</p>
        </div>

        <p className="mt-1 text-xs text-gray-500">
          {item.width} × {item.height} px
        </p>

        <p className="mt-1 text-xs text-gray-400">
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
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl text-gray-400 transition hover:bg-red-50 hover:text-red-600"
      >
        ×
      </button>
    </div>
  );
}

async function readImageDimensions(file: File) {
  const bitmap = await createImageBitmap(file);

  const dimensions = {
    width: bitmap.width,
    height: bitmap.height,
  };

  bitmap.close();

  return dimensions;
}

async function createDrawableImage(file: File) {
  return await createImageBitmap(file);
}

export function ImageMerger() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [isDraggingOverUploader, setIsDraggingOverUploader] = useState(false);

  const [direction, setDirection] = useState<MergeDirection>("vertical");

  const [spacing, setSpacing] = useState(0);

  const [background, setBackground] = useState("#ffffff");

  const [outputFormat, setOutputFormat] = useState<OutputFormat>("image/png");

  const [quality, setQuality] = useState(90);

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultSize, setResultSize] = useState<number | null>(null);
  const [isReadyToDownload, setIsReadyToDownload] = useState(false);

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

  const totalInputSize = useMemo(() => {
    return images.reduce((sum, item) => sum + item.file.size, 0);
  }, [images]);

  useEffect(() => {
    return () => {
      images.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
      });

      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
      }
    };
  }, [images, resultUrl]);

  function clearResult() {
    setError("");
    setResultSize(null);
    setIsReadyToDownload(false);

    setResultUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });
  }

  async function addFiles(selectedFiles: FileList | File[]) {
    const incoming = Array.from(selectedFiles);

    if (incoming.length === 0) {
      return;
    }

    clearResult();

    const availableSlots = MAX_FILES - images.length;

    if (availableSlots <= 0) {
      setError(`You can merge up to ${MAX_FILES} images.`);
      return;
    }

    const limitedFiles = incoming.slice(0, availableSlots);

    const validFiles = limitedFiles.filter((file) => {
      const validType =
        file.type === "image/jpeg" ||
        file.type === "image/png" ||
        file.type === "image/webp";

      return validType && file.size <= MAX_FILE_SIZE;
    });

    if (validFiles.length !== limitedFiles.length) {
      setError(
        "Some files were skipped. Only JPG, PNG and WebP images under 25 MB are supported.",
      );
    }

    try {
      const mappedImages: UploadedImage[] = [];

      for (const file of validFiles) {
        const dimensions = await readImageDimensions(file);

        mappedImages.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          width: dimensions.width,
          height: dimensions.height,
        });
      }

      setImages((current) => [...current, ...mappedImages]);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to read one or more images.",
      );
    }
  }

  function removeImage(id: string) {
    clearResult();

    setImages((current) => {
      const item = current.find((image) => image.id === id);

      if (item) {
        URL.revokeObjectURL(item.previewUrl);
      }

      return current.filter((image) => image.id !== id);
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    clearResult();

    setImages((current) => {
      const oldIndex = current.findIndex((item) => item.id === active.id);

      const newIndex = current.findIndex((item) => item.id === over.id);

      if (oldIndex === -1 || newIndex === -1) {
        return current;
      }

      return arrayMove(current, oldIndex, newIndex);
    });
  }

  async function mergeImages() {
    if (images.length < 2) {
      setError("Please select at least two images.");
      return;
    }

    try {
      setError("");
      setIsProcessing(true);
      setIsReadyToDownload(false);

      if (resultUrl) {
        URL.revokeObjectURL(resultUrl);
        setResultUrl("");
      }

      const bitmaps = [];

      for (const item of images) {
        const bitmap = await createDrawableImage(item.file);
        bitmaps.push(bitmap);
      }

      const canvas = document.createElement("canvas");

      const totalSpacing = spacing * Math.max(0, images.length - 1);

      if (direction === "vertical") {
        canvas.width = Math.max(...bitmaps.map((bitmap) => bitmap.width));

        canvas.height =
          bitmaps.reduce((sum, bitmap) => sum + bitmap.height, 0) +
          totalSpacing;
      } else {
        canvas.width =
          bitmaps.reduce((sum, bitmap) => sum + bitmap.width, 0) + totalSpacing;

        canvas.height = Math.max(...bitmaps.map((bitmap) => bitmap.height));
      }

      const context = canvas.getContext("2d");

      if (!context) {
        bitmaps.forEach((bitmap) => bitmap.close());

        throw new Error("Your browser could not create the merged image.");
      }

      if (outputFormat !== "image/png") {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      } else if (background !== "transparent") {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      let offsetX = 0;
      let offsetY = 0;

      for (const bitmap of bitmaps) {
        context.drawImage(bitmap, offsetX, offsetY);

        if (direction === "vertical") {
          offsetY += bitmap.height + spacing;
        } else {
          offsetX += bitmap.width + spacing;
        }
      }

      bitmaps.forEach((bitmap) => bitmap.close());

      const outputQuality =
        outputFormat === "image/png" ? undefined : quality / 100;

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, outputFormat, outputQuality);
      });

      if (!blob) {
        throw new Error("Unable to create the merged image.");
      }

      const url = URL.createObjectURL(blob);

      setResultUrl(url);
      setResultSize(blob.size);
      setIsReadyToDownload(true);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while merging the images.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) {
            void addFiles(event.target.files);
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
            void addFiles(event.dataTransfer.files);
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
          Drop your images here
        </h3>

        <p className="mt-2 text-sm text-gray-500">
          Upload JPG, PNG or WebP images and combine them into one image.
        </p>

        <button
          type="button"
          className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Select Images
        </button>

        <p className="mt-4 text-xs text-gray-400">
          Up to {MAX_FILES} images · 25 MB each
        </p>
      </div>

      {images.length > 0 && (
        <div className="mt-8 space-y-8">
          <div>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-950">
                  Arrange your images
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  Drag any image card to change the merge order.
                </p>
              </div>

              <span className="shrink-0 text-sm text-gray-500">
                {images.length}/{MAX_FILES}
              </span>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={images.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {images.map((item, index) => (
                    <SortableImageCard
                      key={item.id}
                      item={item}
                      index={index}
                      onRemove={removeImage}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <div className="mt-5 text-center">
              <button
                type="button"
                disabled={images.length >= MAX_FILES || isProcessing}
                onClick={() => inputRef.current?.click()}
                className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                + Add More Images
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-950">
              Merge settings
            </h3>

            <div className="mt-5">
              <p className="text-sm font-semibold text-gray-700">Direction</p>

              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDirection("vertical");
                    clearResult();
                  }}
                  className={[
                    "rounded-xl border px-4 py-3 text-sm font-semibold transition",
                    direction === "vertical"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-300",
                  ].join(" ")}
                >
                  Vertical
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDirection("horizontal");
                    clearResult();
                  }}
                  className={[
                    "rounded-xl border px-4 py-3 text-sm font-semibold transition",
                    direction === "horizontal"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-300",
                  ].join(" ")}
                >
                  Horizontal
                </button>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="spacing"
                  className="text-sm font-semibold text-gray-700"
                >
                  Space between images
                </label>

                <span className="text-sm font-semibold text-blue-600">
                  {spacing}px
                </span>
              </div>

              <input
                id="spacing"
                type="range"
                min="0"
                max="100"
                step="5"
                value={spacing}
                disabled={isProcessing}
                onChange={(event) => {
                  setSpacing(Number(event.target.value));
                  clearResult();
                }}
                className="mt-3 w-full"
              />
            </div>

            <div className="mt-6">
              <label
                htmlFor="background"
                className="text-sm font-semibold text-gray-700"
              >
                Background
              </label>

              <div className="mt-2 flex items-center gap-3">
                <input
                  id="background"
                  type="color"
                  value={background}
                  disabled={isProcessing}
                  onChange={(event) => {
                    setBackground(event.target.value);
                    clearResult();
                  }}
                  className="h-12 w-16 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
                />

                <span className="text-sm text-gray-500">
                  Used for empty space and JPEG/WebP backgrounds.
                </span>
              </div>
            </div>

            <div className="mt-6">
              <label
                htmlFor="output-format"
                className="text-sm font-semibold text-gray-700"
              >
                Output format
              </label>

              <select
                id="output-format"
                value={outputFormat}
                disabled={isProcessing}
                onChange={(event) => {
                  setOutputFormat(event.target.value as OutputFormat);
                  clearResult();
                }}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-blue-500"
              >
                <option value="image/png">
                  PNG — Best for quality/transparency
                </option>

                <option value="image/jpeg">JPEG — Smaller for photos</option>

                <option value="image/webp">WebP — Modern compact format</option>
              </select>
            </div>

            {outputFormat !== "image/png" && (
              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="quality"
                    className="text-sm font-semibold text-gray-700"
                  >
                    Output quality
                  </label>

                  <span className="text-sm font-semibold text-blue-600">
                    {quality}%
                  </span>
                </div>

                <input
                  id="quality"
                  type="range"
                  min="40"
                  max="100"
                  step="5"
                  value={quality}
                  disabled={isProcessing}
                  onChange={(event) => {
                    setQuality(Number(event.target.value));
                    clearResult();
                  }}
                  className="mt-3 w-full"
                />
              </div>
            )}

            <div className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <div className="flex justify-between gap-4">
                <span>Images</span>
                <span className="font-semibold text-gray-900">
                  {images.length}
                </span>
              </div>

              <div className="mt-2 flex justify-between gap-4">
                <span>Total input size</span>
                <span className="font-semibold text-gray-900">
                  {formatFileSize(totalInputSize)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={mergeImages}
              disabled={images.length < 2 || isProcessing}
              className="mt-7 w-full rounded-xl bg-blue-600 px-6 py-4 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isProcessing
                ? "Merging images..."
                : images.length < 2
                  ? "Add at least 2 images"
                  : `Merge ${images.length} Images`}
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

          {resultUrl && isReadyToDownload && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl font-bold text-green-700">
                ✓
              </div>

              <h3 className="mt-3 text-xl font-bold text-gray-950">
                Your merged image is ready
              </h3>

              {resultSize !== null && (
                <p className="mt-2 text-sm text-gray-600">
                  Output size:{" "}
                  <span className="font-semibold text-gray-950">
                    {formatFileSize(resultSize)}
                  </span>
                </p>
              )}

              <div className="mt-6 overflow-hidden rounded-2xl border border-green-200 bg-white p-4">
                <Image
                  src={resultUrl}
                  alt="Merged image preview"
                  width={1400}
                  height={1000}
                  unoptimized
                  className="mx-auto h-auto max-h-[600px] w-auto max-w-full object-contain"
                />
              </div>

              <a
                href={resultUrl}
                download={`ConvertFlow-Merged-Image.${getExtension(
                  outputFormat,
                )}`}
                className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-4 font-bold text-white transition hover:bg-green-700 sm:w-auto"
              >
                ↓ Download Merged Image
              </a>
            </div>
          )}
        </div>
      )}

      <p className="mt-5 text-center text-xs text-gray-400">
        Images are processed locally in your browser and are not uploaded to our
        server.
      </p>
    </div>
  );
}

"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type CompressionPreview = {
  blob: Blob;
  url: string;
  fileName: string;
  originalSize: number;
  compressedSize: number;
};

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";

  const units = ["Bytes", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function getOutputFileName(fileName: string, mimeType: string) {
  const baseName =
    fileName.lastIndexOf(".") > 0
      ? fileName.slice(0, fileName.lastIndexOf("."))
      : fileName;

  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : "jpg";

  return `${baseName}-compressed.${extension}`;
}

export function ImageCompressor() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);

  const [previewUrl, setPreviewUrl] = useState("");

  const [compressedPreview, setCompressedPreview] =
    useState<CompressionPreview | null>(null);

  const [quality, setQuality] = useState(75);

  const [outputType, setOutputType] = useState("image/jpeg");

  const [isDragging, setIsDragging] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);

  const [isEstimating, setIsEstimating] = useState(false);

  const [isReadyToDownload, setIsReadyToDownload] = useState(false);

  const [error, setError] = useState("");

  const clearCompressedPreview = useCallback(() => {
    setCompressedPreview((current) => {
      if (current?.url) {
        URL.revokeObjectURL(current.url);
      }

      return null;
    });
  }, []);

  const cleanupPreviewUrl = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }

      if (compressedPreview?.url) {
        URL.revokeObjectURL(compressedPreview.url);
      }
    };
  }, [previewUrl, compressedPreview]);

  function selectFile(selectedFile: File) {
    setError("");
    setIsReadyToDownload(false);

    clearCompressedPreview();

    if (!selectedFile.type.startsWith("image/")) {
      setError("Please select a valid image file.");

      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("The image must be smaller than 25 MB.");

      return;
    }

    cleanupPreviewUrl();

    setFile(selectedFile);

    setPreviewUrl(URL.createObjectURL(selectedFile));

    if (selectedFile.type === "image/png") {
      setOutputType("image/webp");
    } else {
      setOutputType("image/jpeg");
    }
  }

  function removeFile() {
    cleanupPreviewUrl();
    clearCompressedPreview();

    setFile(null);
    setError("");
    setIsEstimating(false);
    setIsReadyToDownload(false);
  }

  const createCompressedBlob = useCallback(
    async (sourceFile: File): Promise<Blob> => {
      const imageBitmap = await createImageBitmap(sourceFile);

      const canvas = document.createElement("canvas");

      canvas.width = imageBitmap.width;

      canvas.height = imageBitmap.height;

      const context = canvas.getContext("2d");

      if (!context) {
        imageBitmap.close();

        throw new Error("Your browser could not process this image.");
      }

      context.drawImage(imageBitmap, 0, 0);

      imageBitmap.close();

      const compressionQuality =
        outputType === "image/png" ? undefined : quality / 100;

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, outputType, compressionQuality);
      });

      if (!blob) {
        throw new Error("Image compression failed.");
      }

      return blob;
    },
    [outputType, quality],
  );

  useEffect(() => {
    if (!file) {
      return;
    }

    let cancelled = false;

    const timer = window.setTimeout(async () => {
      try {
        setIsEstimating(true);
        setIsReadyToDownload(false);

        const blob = await createCompressedBlob(file);

        if (cancelled) {
          return;
        }

        const url = URL.createObjectURL(blob);

        setCompressedPreview((current) => {
          if (current?.url) {
            URL.revokeObjectURL(current.url);
          }

          return {
            blob,
            url,
            fileName: getOutputFileName(file.name, outputType),
            originalSize: file.size,
            compressedSize: blob.size,
          };
        });

        setError("");
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "Unable to estimate the compressed image size.",
        );
      } finally {
        if (!cancelled) {
          setIsEstimating(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;

      window.clearTimeout(timer);
    };
  }, [file, createCompressedBlob, outputType]);

  async function compressImage() {
    if (!file) {
      setError("Please select an image first.");

      return;
    }

    try {
      setError("");
      setIsProcessing(true);

      let result = compressedPreview;

      if (!result) {
        const blob = await createCompressedBlob(file);

        const url = URL.createObjectURL(blob);

        result = {
          blob,
          url,
          fileName: getOutputFileName(file.name, outputType),
          originalSize: file.size,
          compressedSize: blob.size,
        };

        setCompressedPreview(result);
      }

      setIsReadyToDownload(true);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while compressing the image.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  const reductionPercentage =
    compressedPreview && compressedPreview.originalSize > 0
      ? Math.max(
          0,
          Math.round(
            ((compressedPreview.originalSize -
              compressedPreview.compressedSize) /
              compressedPreview.originalSize) *
              100,
          ),
        )
      : 0;

  const savedBytes = compressedPreview
    ? Math.max(
        0,
        compressedPreview.originalSize - compressedPreview.compressedSize,
      )
    : 0;

  const isActuallySmaller = compressedPreview
    ? compressedPreview.compressedSize < compressedPreview.originalSize
    : false;

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const selectedFile = event.target.files?.[0];

          if (selectedFile) {
            selectFile(selectedFile);
          }

          event.target.value = "";
        }}
      />

      {!file && (
        <div
          onClick={() => inputRef.current?.click()}
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
          onDrop={(event) => {
            event.preventDefault();

            setIsDragging(false);

            const droppedFile = event.dataTransfer.files?.[0];

            if (droppedFile) {
              selectFile(droppedFile);
            }
          }}
          className={[
            "cursor-pointer rounded-3xl border-2 border-dashed px-6 py-14 text-center transition",
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl text-blue-600">
            ↑
          </div>

          <h3 className="mt-5 text-xl font-semibold text-gray-950">
            Drop your image here
          </h3>

          <p className="mt-2 text-sm text-gray-500">
            Upload JPG, PNG or WebP images up to 25 MB.
          </p>

          <button
            type="button"
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Select Image
          </button>
        </div>
      )}

      {file && (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex min-h-64 items-center justify-center bg-gray-50 p-6">
              {previewUrl && (
                <Image
                  src={previewUrl}
                  alt="Selected image preview"
                  width={1200}
                  height={800}
                  unoptimized
                  className="h-auto max-h-96 w-auto max-w-full object-contain"
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-gray-200 p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-950">
                  {file.name}
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  Original size:{" "}
                  <span className="font-semibold text-gray-700">
                    {formatFileSize(file.size)}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={removeFile}
                disabled={isProcessing}
                className="shrink-0 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-950">
              Compression settings
            </h3>

            <div className="mt-5">
              <label
                htmlFor="output-format"
                className="text-sm font-semibold text-gray-700"
              >
                Output format
              </label>

              <select
                id="output-format"
                value={outputType}
                disabled={isProcessing}
                onChange={(event) => {
                  setOutputType(event.target.value);

                  setIsReadyToDownload(false);
                }}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-blue-500"
              >
                <option value="image/jpeg">JPEG — Best for photos</option>

                <option value="image/webp">WebP — Usually smaller</option>

                <option value="image/png">PNG — Lossless format</option>
              </select>
            </div>

            {outputType !== "image/png" && (
              <div className="mt-6">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="quality"
                    className="text-sm font-semibold text-gray-700"
                  >
                    Image quality
                  </label>

                  <span className="text-sm font-semibold text-blue-600">
                    {quality}%
                  </span>
                </div>

                <input
                  id="quality"
                  type="range"
                  min="20"
                  max="95"
                  step="5"
                  value={quality}
                  disabled={isProcessing}
                  onChange={(event) => {
                    setQuality(Number(event.target.value));

                    setIsReadyToDownload(false);
                  }}
                  className="mt-3 w-full"
                />

                <div className="mt-2 flex justify-between text-xs text-gray-400">
                  <span>Smaller file</span>

                  <span>Higher quality</span>
                </div>
              </div>
            )}

            <div className="mt-7 rounded-2xl border border-blue-100 bg-blue-50 p-5">
              <div className="flex items-center justify-between gap-4">
                <h4 className="font-semibold text-gray-950">Expected result</h4>

                {isEstimating && (
                  <span className="text-sm font-medium text-blue-600">
                    Calculating...
                  </span>
                )}
              </div>

              {!isEstimating && compressedPreview && (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-white p-4">
                      <p className="text-xs font-medium text-gray-500">
                        Original size
                      </p>

                      <p className="mt-1 text-lg font-bold text-gray-950">
                        {formatFileSize(compressedPreview.originalSize)}
                      </p>
                    </div>

                    <div className="rounded-xl bg-white p-4">
                      <p className="text-xs font-medium text-gray-500">
                        Expected size
                      </p>

                      <p className="mt-1 text-lg font-bold text-gray-950">
                        {formatFileSize(compressedPreview.compressedSize)}
                      </p>
                    </div>
                  </div>

                  {isActuallySmaller ? (
                    <div className="mt-4 rounded-xl bg-white p-4 text-center">
                      <p className="text-sm text-gray-600">
                        You will save approximately
                      </p>

                      <p className="mt-1 text-xl font-bold text-green-700">
                        {formatFileSize(savedBytes)} ({reductionPercentage}%
                        smaller)
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      These settings do not make the image smaller. Try WebP,
                      JPEG, or lower the quality.
                    </div>
                  )}
                </>
              )}

              {isEstimating && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="h-20 animate-pulse rounded-xl bg-white" />

                  <div className="h-20 animate-pulse rounded-xl bg-white" />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={compressImage}
              disabled={isProcessing || isEstimating || !compressedPreview}
              className="mt-7 w-full rounded-xl bg-blue-600 px-6 py-4 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isProcessing ? "Preparing image..." : "Reduce Image Size"}
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

          {compressedPreview && isReadyToDownload && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-6">
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl font-bold text-green-700">
                  ✓
                </div>

                <h3 className="mt-3 text-xl font-bold text-gray-950">
                  Your reduced image is ready
                </h3>

                <p className="mt-2 text-sm text-gray-600">
                  Final size:{" "}
                  <span className="font-bold text-gray-950">
                    {formatFileSize(compressedPreview.compressedSize)}
                  </span>
                </p>

                {isActuallySmaller && (
                  <p className="mt-1 text-sm font-semibold text-green-700">
                    {reductionPercentage}% smaller than the original
                  </p>
                )}

                <a
                  href={compressedPreview.url}
                  download={compressedPreview.fileName}
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-4 font-bold text-white transition hover:bg-green-700 sm:w-auto"
                >
                  ↓ Download Reduced Image
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {!file && error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <p className="mt-5 text-center text-xs text-gray-400">
        Your image is processed locally in your browser and is not uploaded to
        our server.
      </p>
    </div>
  );
}

"use client";

import Image from "next/image";
import { useRef, useState } from "react";

const MAX_FILE_SIZE = 15 * 1024 * 1024;

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";

  const units = ["Bytes", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function isSupportedImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

export function BackgroundRemover() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [resultUrl, setResultUrl] = useState("");
  const [resultSize, setResultSize] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");

  function clearResult() {
    setResultUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });

    setResultSize(null);
  }

  function clearAll() {
    clearResult();

    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });

    setFile(null);
    setError("");
  }

  function selectFile(selectedFile: File) {
    setError("");
    clearResult();

    if (!isSupportedImage(selectedFile)) {
      setError("Please select a JPG, PNG, or WebP image.");
      return;
    }

    if (selectedFile.size === 0) {
      setError("The selected image is empty.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("The image must be smaller than 15 MB.");
      return;
    }

    setPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return URL.createObjectURL(selectedFile);
    });

    setFile(selectedFile);
  }

  async function removeBackground() {
    if (!file) {
      setError("Please select an image first.");
      return;
    }

    try {
      setError("");
      clearResult();
      setIsProcessing(true);

      const { removeBackground } = await import("@imgly/background-removal");

      const outputBlob = await removeBackground(file, {
        output: {
          format: "image/png",
          quality: 1,
        },
      });

      if (!outputBlob || outputBlob.size === 0) {
        throw new Error("The background removal result was empty.");
      }

      const url = URL.createObjectURL(outputBlob);

      setResultUrl(url);
      setResultSize(outputBlob.size);
    } catch (err) {
      console.error("Background removal error:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while removing the background.",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  function getOutputName() {
    if (!file) {
      return "background-removed.png";
    }

    return `${file.name.replace(/\.[^/.]+$/, "")}-no-background.png`;
  }

  function downloadResult() {
    if (!resultUrl) return;

    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = getOutputName();

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

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
            "cursor-pointer rounded-3xl border-2 border-dashed px-6 py-16 text-center transition",
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-gray-300 bg-white hover:border-blue-400",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-sm font-bold text-blue-700">
            BG
          </div>

          <h3 className="mt-5 text-xl font-semibold text-gray-950">
            Drop your image here
          </h3>

          <p className="mt-2 text-sm text-gray-500">
            Automatically remove the background and create a transparent PNG.
          </p>

          <button
            type="button"
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Select Image
          </button>

          <p className="mt-4 text-xs text-gray-400">
            JPG, PNG, WebP · Maximum 15 MB
          </p>
        </div>
      )}

      {file && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">
                IMG
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-950">
                  {file.name}
                </p>

                <p className="mt-1 text-sm text-gray-500">
                  {formatFileSize(file.size)}
                </p>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={clearAll}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="font-semibold text-gray-950">Original</p>

              <div className="relative mt-4 aspect-square overflow-hidden rounded-xl bg-gray-100">
                {previewUrl && (
                  <Image
                    src={previewUrl}
                    alt="Original uploaded image"
                    fill
                    unoptimized
                    className="object-contain"
                  />
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="font-semibold text-gray-950">Background removed</p>

              <div
                className="relative mt-4 aspect-square overflow-hidden rounded-xl"
                style={{
                  backgroundImage:
                    "linear-gradient(45deg,#e5e7eb 25%,transparent 25%),linear-gradient(-45deg,#e5e7eb 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e7eb 75%),linear-gradient(-45deg,transparent 75%,#e5e7eb 75%)",
                  backgroundSize: "20px 20px",
                  backgroundPosition: "0 0,0 10px,10px -10px,-10px 0px",
                }}
              >
                {resultUrl ? (
                  <Image
                    src={resultUrl}
                    alt="Background removed result"
                    fill
                    unoptimized
                    className="object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-400">
                    Your transparent result will appear here.
                  </div>
                )}
              </div>
            </div>
          </div>

          {isProcessing && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-blue-100 bg-blue-50 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                <div>
                  <p className="text-sm font-semibold text-blue-900">
                    Removing background...
                  </p>

                  <p className="mt-1 text-xs text-blue-700">
                    The AI model may take longer the first time it loads.
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {!resultUrl && (
            <button
              type="button"
              onClick={removeBackground}
              disabled={isProcessing}
              className="w-full rounded-xl bg-blue-600 px-6 py-4 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isProcessing ? "Removing Background..." : "Remove Background"}
            </button>
          )}

          {resultUrl && !isProcessing && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl font-bold text-green-700">
                ✓
              </div>

              <h3 className="mt-3 text-xl font-bold text-gray-950">
                Background removed
              </h3>

              {resultSize !== null && (
                <p className="mt-2 text-sm text-gray-600">
                  PNG size:{" "}
                  <span className="font-semibold text-gray-950">
                    {formatFileSize(resultSize)}
                  </span>
                </p>
              )}

              <button
                type="button"
                onClick={downloadResult}
                className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-4 font-bold text-white transition hover:bg-green-700 sm:w-auto"
              >
                ↓ Download Transparent PNG
              </button>

              <div className="mt-4 flex flex-wrap justify-center gap-4">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Choose another image
                </button>

                <button
                  type="button"
                  onClick={removeBackground}
                  className="text-sm font-semibold text-gray-600 hover:text-gray-900"
                >
                  Process again
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-gray-900">
              Runs in your browser
            </p>

            <p className="mt-1 text-xs leading-5 text-gray-500">
              The AI model processes the image on your device. The image does
              not need to be uploaded to the ConvertFlow server for background
              removal.
            </p>
          </div>
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
    </div>
  );
}

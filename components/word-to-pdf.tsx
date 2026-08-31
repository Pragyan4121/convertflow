"use client";

import { useRef, useState } from "react";

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

function isDocxFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function getPdfName(fileName: string) {
  return fileName.replace(/\.docx$/i, "") + ".pdf";
}

export function WordToPdf() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadSize, setDownloadSize] = useState<number | null>(null);

  function clearResult() {
    setDownloadUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });

    setDownloadSize(null);
  }

  function selectFile(selectedFile: File) {
    setError("");
    clearResult();

    if (!isDocxFile(selectedFile)) {
      setFile(null);
      setError("Please select a valid .docx Word document.");
      return;
    }

    if (selectedFile.size === 0) {
      setFile(null);
      setError("The selected Word document is empty.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setError("The Word document must be smaller than 25 MB.");
      return;
    }

    setFile(selectedFile);
  }

  function removeFile() {
    clearResult();
    setFile(null);
    setError("");
  }

  async function convertToPdf() {
    if (!file) {
      setError("Please select a Word document first.");
      return;
    }

    try {
      setError("");
      clearResult();
      setIsProcessing(true);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/word-to-pdf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let message = "Unable to convert the Word document.";

        try {
          const data = await response.json();

          if (typeof data?.error === "string") {
            message = data.error;
          }
        } catch {
          // Keep fallback message.
        }

        throw new Error(message);
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error("The server returned an empty PDF.");
      }

      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);
      setDownloadSize(blob.size);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while converting the Word document.",
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
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
            DOCX
          </div>

          <h3 className="mt-5 text-xl font-semibold text-gray-950">
            Drop your Word document here
          </h3>

          <p className="mt-2 text-sm text-gray-500">
            Convert DOCX to PDF while preserving layout, images, tables,
            headers, footers, and document structure as closely as possible.
          </p>

          <button
            type="button"
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Select Word File
          </button>

          <p className="mt-4 text-xs text-gray-400">
            DOCX only · Maximum 25 MB
          </p>
        </div>
      )}

      {file && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">
                DOCX
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
                onClick={removeFile}
                disabled={isProcessing}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-950">Conversion</h3>

            <div className="mt-5 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
              <div className="flex justify-between gap-4">
                <span>Input</span>
                <span className="font-semibold text-gray-900">
                  Microsoft Word (.docx)
                </span>
              </div>

              <div className="mt-2 flex justify-between gap-4">
                <span>Output</span>
                <span className="font-semibold text-gray-900">
                  PDF document
                </span>
              </div>

              <div className="mt-2 flex justify-between gap-4">
                <span>Output filename</span>
                <span className="max-w-[65%] truncate font-semibold text-gray-900">
                  {getPdfName(file.name)}
                </span>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-green-100 bg-green-50 p-4">
              <p className="text-sm font-semibold text-green-900">
                High-quality document conversion
              </p>

              <p className="mt-1 text-xs leading-5 text-green-700">
                The document is rendered through a full office document engine
                rather than being rebuilt as plain text.
              </p>
            </div>

            {isProcessing && (
              <div
                role="status"
                aria-live="polite"
                className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />

                  <div>
                    <p className="text-sm font-semibold text-blue-900">
                      Converting Word to PDF...
                    </p>

                    <p className="mt-1 text-xs text-blue-700">
                      Complex documents may take a little longer to render.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={convertToPdf}
              disabled={isProcessing}
              className="mt-6 w-full rounded-xl bg-blue-600 px-6 py-4 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isProcessing ? "Converting..." : "Convert Word to PDF"}
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
                Your PDF is ready
              </h3>

              {downloadSize !== null && (
                <p className="mt-2 text-sm text-gray-600">
                  PDF size:{" "}
                  <span className="font-semibold text-gray-950">
                    {formatFileSize(downloadSize)}
                  </span>
                </p>
              )}

              <a
                href={downloadUrl}
                download={getPdfName(file.name)}
                className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-4 font-bold text-white transition hover:bg-green-700 sm:w-auto"
              >
                ↓ Download PDF
              </a>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    clearResult();
                    setFile(null);
                    setError("");
                  }}
                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                >
                  Convert another Word document
                </button>
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

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-sm font-semibold text-gray-900">High fidelity</p>

          <p className="mt-1 text-xs text-gray-500">
            Designed to preserve Word formatting and layout.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-sm font-semibold text-gray-900">
            Private processing
          </p>

          <p className="mt-1 text-xs text-gray-500">
            Temporary files are removed after conversion.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <p className="text-sm font-semibold text-gray-900">No watermark</p>

          <p className="mt-1 text-xs text-gray-500">
            The generated PDF does not add ConvertFlow branding.
          </p>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-gray-400">
        Your document is sent to the conversion server temporarily and is not
        stored permanently.
      </p>
    </div>
  );
}

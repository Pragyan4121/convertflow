"use client";

import { useEffect, useRef, useState } from "react";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac"];

type VocalResult = {
  instrumentalUrl: string;
  vocalsUrl?: string | null;
};

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 Bytes";

  const units = ["Bytes", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );

  return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--:--";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function isSupportedAudio(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  return SUPPORTED_EXTENSIONS.includes(extension);
}

export function VocalRemover() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [duration, setDuration] = useState<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [processingStage, setProcessingStage] = useState("");
  const [error, setError] = useState("");

  const [result, setResult] = useState<VocalResult | null>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  function clearFile() {
    if (isProcessing) return;

    setAudioUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return "";
    });

    setFile(null);
    setDuration(null);
    setError("");
    setResult(null);
    setProcessingStage("");

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function selectFile(selectedFile: File) {
    setError("");
    setResult(null);
    setProcessingStage("");

    if (!isSupportedAudio(selectedFile)) {
      setError(
        "Unsupported audio file. Please upload an MP3, WAV, M4A, AAC or FLAC file.",
      );
      return;
    }

    if (selectedFile.size === 0) {
      setError("The selected audio file is empty.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE) {
      setError("The audio file must be smaller than 50 MB.");
      return;
    }

    setAudioUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }

      return URL.createObjectURL(selectedFile);
    });

    setFile(selectedFile);
    setDuration(null);
  }

  async function removeVocals() {
    if (!file || isProcessing) return;

    try {
      setIsProcessing(true);
      setError("");
      setResult(null);

      setProcessingStage("Uploading your audio...");

      const formData = new FormData();

      formData.append("audio", file);

      setProcessingStage("AI is separating vocals from the music...");

      const response = await fetch("/api/vocal-remover", {
        method: "POST",
        body: formData,
      });

      let data: {
        success?: boolean;
        instrumentalUrl?: string;
        vocalsUrl?: string | null;
        error?: string;
      };

      try {
        data = await response.json();
      } catch {
        throw new Error("The server returned an invalid response.");
      }

      if (!response.ok) {
        throw new Error(data.error || "The AI could not process this audio.");
      }

      if (!data.instrumentalUrl) {
        throw new Error(
          "The AI finished processing but no instrumental track was returned.",
        );
      }

      setProcessingStage("Separation complete.");

      setResult({
        instrumentalUrl: data.instrumentalUrl,
        vocalsUrl: data.vocalsUrl ?? null,
      });
    } catch (err) {
      console.error(err);

      setProcessingStage("");

      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while removing the vocals.",
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
        accept=".mp3,.wav,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/flac"
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
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-2xl font-bold text-blue-700">
            ♪
          </div>

          <h3 className="mt-5 text-xl font-semibold text-gray-950">
            Drop your audio here
          </h3>

          <p className="mt-2 text-sm text-gray-500">
            Upload a song and AI will separate the vocals from the music.
          </p>

          <button
            type="button"
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Select Audio
          </button>

          <p className="mt-4 text-xs text-gray-400">
            MP3, WAV, M4A, AAC, FLAC · Maximum 50 MB
          </p>
        </div>
      )}

      {file && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl font-bold text-blue-700">
                ♪
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-gray-950">
                  {file.name}
                </p>

                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                  <span>{formatFileSize(file.size)}</span>

                  <span>
                    Duration:{" "}
                    {duration !== null
                      ? formatDuration(duration)
                      : "Loading..."}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={clearFile}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>

          {audioUrl && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="font-semibold text-gray-950">Original Audio</p>

              <audio
                controls
                preload="metadata"
                src={audioUrl}
                className="mt-4 w-full"
                onLoadedMetadata={(event) => {
                  const audio = event.currentTarget;

                  if (Number.isFinite(audio.duration)) {
                    setDuration(audio.duration);
                  }
                }}
              />
            </div>
          )}

          {!result && (
            <>
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900">
                  AI Vocal Separation
                </p>

                <p className="mt-1 text-xs leading-5 text-blue-700">
                  Your song will be processed using AI source separation to
                  create separate instrumental and vocal tracks.
                </p>
              </div>

              <button
                type="button"
                disabled={isProcessing}
                onClick={removeVocals}
                className="w-full rounded-xl bg-blue-600 px-6 py-4 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
              >
                {isProcessing
                  ? "Processing Audio..."
                  : "Remove Lyrics / Create Instrumental"}
              </button>
            </>
          )}

          {isProcessing && (
            <div className="rounded-2xl border border-blue-200 bg-white p-6">
              <div className="flex items-center gap-4">
                <div className="h-8 w-8 shrink-0 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />

                <div>
                  <p className="font-semibold text-gray-950">
                    Creating your instrumental
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    {processingStage || "AI is processing your song..."}
                  </p>
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-blue-100">
                <div className="h-full w-full animate-pulse bg-blue-600" />
              </div>

              <p className="mt-3 text-xs text-gray-400">
                AI separation can take several minutes for longer songs. Please
                keep this page open.
              </p>
            </div>
          )}

          {result && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-green-200 bg-green-50 p-5">
                <p className="font-semibold text-green-800">
                  ✓ Instrumental created successfully
                </p>

                <p className="mt-1 text-sm text-green-700">
                  The vocals have been separated from your song.
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div>
                  <p className="text-lg font-semibold text-gray-950">
                    Music Only
                  </p>

                  <p className="mt-1 text-sm text-gray-500">
                    Instrumental version with vocals removed.
                  </p>
                </div>

                <audio
                  controls
                  preload="metadata"
                  src={result.instrumentalUrl}
                  className="mt-5 w-full"
                />

                <a
                  href={result.instrumentalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 flex w-full items-center justify-center rounded-xl bg-green-600 px-6 py-3 font-semibold text-white transition hover:bg-green-700"
                >
                  Download Music Only
                </a>
              </div>

              {result.vocalsUrl && (
                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div>
                    <p className="text-lg font-semibold text-gray-950">
                      Vocals Only
                    </p>

                    <p className="mt-1 text-sm text-gray-500">
                      Isolated vocal track.
                    </p>
                  </div>

                  <audio
                    controls
                    preload="metadata"
                    src={result.vocalsUrl}
                    className="mt-5 w-full"
                  />

                  <a
                    href={result.vocalsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 flex w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-800 transition hover:bg-gray-50"
                  >
                    Download Vocals Only
                  </a>
                </div>
              )}

              <button
                type="button"
                onClick={clearFile}
                className="w-full rounded-xl border border-gray-300 bg-white px-6 py-3 font-semibold text-gray-800 transition hover:bg-gray-50"
              >
                Process Another Song
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"
        >
          <p className="text-sm font-semibold text-red-800">
            Processing failed
          </p>

          <p className="mt-1 text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}

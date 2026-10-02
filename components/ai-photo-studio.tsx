"use client";

import {
  ChangeEvent,
  DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Purpose =
  | "professional"
  | "linkedin"
  | "cv"
  | "passport"
  | "formal"
  | "studio";

type Outfit =
  | "unchanged"
  | "black-suit"
  | "navy-suit"
  | "charcoal-suit"
  | "blazer-shirt"
  | "shirt-tie"
  | "business-casual"
  | "womens-suit"
  | "womens-blazer";

type Background =
  | "unchanged"
  | "white"
  | "light-gray"
  | "soft-blue"
  | "dark-gray"
  | "office"
  | "office-blur"
  | "warm-studio";

type Quality = "standard" | "premium";

type SizePreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  note?: string;
};

type ResultItem = {
  id: string;
  url: string;
  createdAt: number;
};

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const PURPOSES: Array<{ id: Purpose; label: string; description: string }> = [
  {
    id: "professional",
    label: "Professional Headshot",
    description: "Balanced studio portrait for work profiles and business use.",
  },
  {
    id: "linkedin",
    label: "LinkedIn Photo",
    description: "Clean square headshot with professional framing.",
  },
  {
    id: "cv",
    label: "CV / Resume Photo",
    description: "Formal portrait with a neutral, job-ready presentation.",
  },
  {
    id: "passport",
    label: "Passport-style Photo",
    description:
      "Neutral studio presentation. Check your country's official rules before use.",
  },
  {
    id: "formal",
    label: "Formal Outfit",
    description:
      "Keep the person and face, but change clothing professionally.",
  },
  {
    id: "studio",
    label: "Studio Background",
    description: "Keep the person while creating a polished studio background.",
  },
];

const OUTFITS: Array<{ id: Outfit; label: string }> = [
  { id: "unchanged", label: "Keep original outfit" },
  { id: "black-suit", label: "Black business suit" },
  { id: "navy-suit", label: "Navy business suit" },
  { id: "charcoal-suit", label: "Charcoal business suit" },
  { id: "blazer-shirt", label: "Blazer + white shirt" },
  { id: "shirt-tie", label: "White shirt + tie" },
  { id: "business-casual", label: "Business casual" },
  { id: "womens-suit", label: "Women's business suit" },
  { id: "womens-blazer", label: "Women's blazer" },
];

const BACKGROUNDS: Array<{ id: Background; label: string }> = [
  { id: "unchanged", label: "Keep original background" },
  { id: "white", label: "Pure white" },
  { id: "light-gray", label: "Light gray studio" },
  { id: "soft-blue", label: "Soft blue studio" },
  { id: "dark-gray", label: "Dark gray studio" },
  { id: "office", label: "Professional office" },
  { id: "office-blur", label: "Blurred corporate office" },
  { id: "warm-studio", label: "Warm neutral studio" },
];

const SIZE_PRESETS: SizePreset[] = [
  { id: "square", label: "Square 1:1", width: 1200, height: 1200 },
  { id: "linkedin", label: "LinkedIn", width: 800, height: 800 },
  { id: "cv", label: "CV 4:5", width: 1200, height: 1500 },
  {
    id: "passport-style",
    label: "Passport-style 35:45",
    width: 700,
    height: 900,
    note: "Requirements vary by country.",
  },
  { id: "portrait", label: "Portrait 3:4", width: 1200, height: 1600 },
  { id: "custom", label: "Custom", width: 1200, height: 1500 },
];

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function safeFileName(value: string) {
  const cleaned = value
    .trim()
    .replace(/\.(jpg|jpeg|png|webp)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ");

  return cleaned || "ConvertFlow-Professional-Photo";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The generated photo could not be loaded."));
    image.src = url;
  });
}

async function exportToExactSize(
  url: string,
  width: number,
  height: number,
  filename: string,
) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Your browser could not prepare the download.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const scale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;

  context.drawImage(image, x, y, drawWidth, drawHeight);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (nextBlob) => {
        if (!nextBlob) {
          reject(new Error("The photo could not be exported."));
          return;
        }
        resolve(nextBlob);
      },
      "image/jpeg",
      0.94,
    );
  });

  downloadBlob(blob, `${safeFileName(filename)}-${width}x${height}.jpg`);
}

export function AiPhotoStudio() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [purpose, setPurpose] = useState<Purpose>("professional");
  const [outfit, setOutfit] = useState<Outfit>("unchanged");
  const [background, setBackground] = useState<Background>("unchanged");
  const [quality, setQuality] = useState<Quality>("standard");
  const [sizePreset, setSizePreset] = useState("cv");
  const [customWidth, setCustomWidth] = useState(1200);
  const [customHeight, setCustomHeight] = useState(1500);
  const [filename, setFilename] = useState("ConvertFlow-Professional-Photo");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [activeResultId, setActiveResultId] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const [progressText, setProgressText] = useState("");

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectedSize = useMemo(() => {
    if (sizePreset === "custom") {
      return {
        width: Math.max(256, Math.min(3000, customWidth || 1200)),
        height: Math.max(256, Math.min(3000, customHeight || 1500)),
      };
    }

    const preset =
      SIZE_PRESETS.find((item) => item.id === sizePreset) ?? SIZE_PRESETS[0];
    return { width: preset.width, height: preset.height };
  }, [sizePreset, customWidth, customHeight]);

  const activeResult = useMemo(
    () => results.find((item) => item.id === activeResultId) ?? results[0],
    [results, activeResultId],
  );

  function resetResults() {
    setResults([]);
    setActiveResultId("");
  }

  function selectFile(nextFile: File) {
    setError("");

    if (!SUPPORTED_TYPES.includes(nextFile.type)) {
      setError("Use a JPG, PNG or WebP portrait photo.");
      return;
    }

    if (nextFile.size === 0 || nextFile.size > MAX_FILE_SIZE) {
      setError("Use an image up to 15 MB.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setFilename(safeFileName(nextFile.name));

    setOutfit("unchanged");
    setBackground("unchanged");

    resetResults();
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (selected) selectFile(selected);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const selected = event.dataTransfer.files?.[0];
    if (selected) selectFile(selected);
  }

  function removePhoto() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl("");
    setError("");
    resetResults();
  }

  async function generatePhoto() {
    if (!file) {
      setError("Upload a portrait photo first.");
      return;
    }

    try {
      setIsGenerating(true);
      setError("");
      setProgressText(
        "Creating your professional photo while preserving your face...",
      );

      const formData = new FormData();
      formData.append("image", file);
      formData.append("purpose", purpose);
      formData.append("outfit", outfit);
      formData.append("background", background);
      formData.append("quality", quality);
      formData.append("targetWidth", String(selectedSize.width));
      formData.append("targetHeight", String(selectedSize.height));

      const response = await fetch("/api/ai-photo-studio", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as {
        image?: string;
        error?: string;
      };

      if (!response.ok || !payload.image) {
        throw new Error(
          payload.error || "The professional photo could not be generated.",
        );
      }

      const result: ResultItem = {
        id: crypto.randomUUID(),
        url: payload.image,
        createdAt: Date.now(),
      };

      setResults((current) => [result, ...current].slice(0, 3));
      setActiveResultId(result.id);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The professional photo could not be generated.",
      );
    } finally {
      setIsGenerating(false);
      setProgressText("");
    }
  }

  async function downloadResult() {
    if (!activeResult) return;

    try {
      setIsDownloading(true);
      setError("");
      await exportToExactSize(
        activeResult.url,
        selectedSize.width,
        selectedSize.height,
        filename,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The photo could not be downloaded.",
      );
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={handleInput}
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
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setIsDragging(false);
            }
          }}
          onDrop={handleDrop}
          className={[
            "rounded-3xl border-2 border-dashed bg-white px-6 py-14 text-center transition",
            isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300",
          ].join(" ")}
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl text-blue-600">
            +
          </div>
          <h2 className="mt-5 text-xl font-bold text-gray-950">
            Upload your portrait
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
            Use a clear front-facing photo with the full head and shoulders
            visible. Better source photos produce more natural professional
            results.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Select Photo
          </button>
          <p className="mt-4 text-xs text-gray-400">
            JPG, PNG or WebP · Maximum 15 MB
          </p>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="aspect-[4/5] bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Original portrait"
                  className="h-full w-full object-contain"
                />
              </div>
              <div className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-900">
                    {file.name}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isGenerating}
                  onClick={removePhoto}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  Replace
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-green-200 bg-green-50 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-sm font-bold text-white">
                  ✓
                </span>
                <div>
                  <p className="text-sm font-bold text-green-950">
                    Face preservation is locked on
                  </p>
                  <p className="mt-1 text-xs leading-5 text-green-800">
                    ConvertFlow instructs the AI not to reshape, beautify, age
                    or change facial identity, skin tone, hairstyle or
                    expression.
                  </p>
                </div>
              </div>
            </div>
          </aside>

          <div className="space-y-6">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
              <h3 className="text-lg font-bold text-gray-950">
                1. Choose purpose
              </h3>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {PURPOSES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setPurpose(item.id)}
                    className={[
                      "rounded-xl border p-4 text-left transition",
                      purpose === item.id
                        ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600"
                        : "border-gray-200 hover:border-blue-300",
                    ].join(" ")}
                  >
                    <p className="text-sm font-bold text-gray-950">
                      {item.label}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      {item.description}
                    </p>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="studio-outfit"
                    className="text-sm font-bold text-gray-900"
                  >
                    2. Outfit
                  </label>
                  <select
                    id="studio-outfit"
                    value={outfit}
                    disabled={isGenerating}
                    onChange={(event) =>
                      setOutfit(event.target.value as Outfit)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    {OUTFITS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="studio-background"
                    className="text-sm font-bold text-gray-900"
                  >
                    3. Background
                  </label>
                  <select
                    id="studio-background"
                    value={background}
                    disabled={isGenerating}
                    onChange={(event) =>
                      setBackground(event.target.value as Background)
                    }
                    className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  >
                    {BACKGROUNDS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-gray-950">
                  4. Output size
                </h3>
                <div className="inline-flex rounded-xl border border-gray-200 p-1">
                  {(["standard", "premium"] as Quality[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => setQuality(item)}
                      className={[
                        "rounded-lg px-3 py-2 text-xs font-bold capitalize",
                        quality === item
                          ? "bg-gray-950 text-white"
                          : "text-gray-600 hover:bg-gray-50",
                      ].join(" ")}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {SIZE_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setSizePreset(item.id)}
                    className={[
                      "rounded-xl border px-4 py-3 text-left",
                      sizePreset === item.id
                        ? "border-blue-600 bg-blue-50 text-blue-950"
                        : "border-gray-200 text-gray-700 hover:border-blue-300",
                    ].join(" ")}
                  >
                    <p className="text-sm font-bold">{item.label}</p>
                    {item.id !== "custom" && (
                      <p className="mt-1 text-xs opacity-70">
                        {item.width} × {item.height}px
                      </p>
                    )}
                    {item.note && (
                      <p className="mt-1 text-[11px] text-amber-700">
                        {item.note}
                      </p>
                    )}
                  </button>
                ))}
              </div>

              {sizePreset === "custom" && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Width (px)
                    <input
                      type="number"
                      min={256}
                      max={3000}
                      value={customWidth}
                      onChange={(event) =>
                        setCustomWidth(Number(event.target.value))
                      }
                      className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                  <label className="text-sm font-semibold text-gray-700">
                    Height (px)
                    <input
                      type="number"
                      min={256}
                      max={3000}
                      value={customHeight}
                      onChange={(event) =>
                        setCustomHeight(Number(event.target.value))
                      }
                      className="mt-2 w-full rounded-xl border border-gray-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </label>
                </div>
              )}
            </section>

            <button
              type="button"
              disabled={isGenerating}
              onClick={() => void generatePhoto()}
              className="w-full rounded-xl bg-blue-600 px-6 py-4 text-base font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating
                ? "Creating professional photo..."
                : results.length
                  ? "Generate Another Version"
                  : "Generate Professional Photo"}
            </button>

            {isGenerating && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  <p className="text-sm font-semibold text-blue-900">
                    {progressText}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-2xl border border-red-200 bg-red-50 p-4"
              >
                <p className="text-sm font-bold text-red-800">
                  Could not complete the request
                </p>
                <p className="mt-1 text-sm text-red-700">{error}</p>
              </div>
            )}

            {results.length > 0 && activeResult && (
              <section className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-gray-950">
                      Your results
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Compare the original with your latest professional
                      version.
                    </p>
                  </div>
                  <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                    Face preservation requested
                  </span>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-sm font-bold text-gray-700">
                      Original
                    </p>
                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl}
                        alt="Original portrait"
                        className="aspect-[4/5] h-full w-full object-contain"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-sm font-bold text-gray-700">
                      Professional result
                    </p>
                    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeResult.url}
                        alt="Generated professional portrait"
                        className="aspect-[4/5] h-full w-full object-cover"
                      />
                    </div>
                  </div>
                </div>

                {results.length > 1 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {results.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveResultId(item.id)}
                        className={[
                          "rounded-lg border px-3 py-2 text-xs font-bold",
                          activeResult.id === item.id
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-gray-200 text-gray-600 hover:bg-gray-50",
                        ].join(" ")}
                      >
                        Version {results.length - index}
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    value={filename}
                    onChange={(event) => setFilename(event.target.value)}
                    className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    aria-label="Download filename"
                  />
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => void downloadResult()}
                    className="rounded-xl bg-green-600 px-6 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {isDownloading
                      ? "Preparing..."
                      : `Download ${selectedSize.width}×${selectedSize.height}`}
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
        AI edits can occasionally alter small visual details even with
        face-preservation instructions. Review the result before using it for
        official identification. Passport and visa rules differ by country.
      </div>
    </div>
  );
}

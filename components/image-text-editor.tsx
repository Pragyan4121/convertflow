"use client";

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createWorker } from "tesseract.js";

type Tool = "select" | "replace" | "text" | "blur" | "pixelate" | "cover";

type ExportFormat = "png" | "jpg" | "webp";

type Selection = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TextItem = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  bold: boolean;
};

type EditorSnapshot = {
  baseImage: string;
  texts: TextItem[];
  width: number;
  height: number;
};

type DetectedStyle = {
  textColor: string;
  backgroundColor: string;
  fontSize: number;
  bold: boolean;
  alignment: "left" | "center" | "right";
  fontFamily: string;
  letterSpacing: number;
  textBounds: Selection;
};

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image."));

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
          reject(new Error("Could not create the image."));
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

function safeFilename(value: string) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ") || "edited-image"
  );
}

function cloneTexts(texts: TextItem[]) {
  return texts.map((item) => ({ ...item }));
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((value) =>
      clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"),
    )
    .join("")}`;
}

function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function luminance(color: { r: number; g: number; b: number }) {
  return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

function averageColors(colors: { r: number; g: number; b: number }[]) {
  if (colors.length === 0) {
    return {
      r: 255,
      g: 255,
      b: 255,
    };
  }

  let r = 0;
  let g = 0;
  let b = 0;

  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
  }

  return {
    r: r / colors.length,
    g: g / colors.length,
    b: b / colors.length,
  };
}

function sampleRegionStyle(
  context: CanvasRenderingContext2D,
  selection: Selection,
): DetectedStyle {
  const x = Math.max(0, Math.round(selection.x));
  const y = Math.max(0, Math.round(selection.y));

  const width = Math.max(1, Math.round(selection.width));

  const height = Math.max(1, Math.round(selection.height));

  const data = context.getImageData(x, y, width, height);

  const pixels: {
    r: number;
    g: number;
    b: number;
  }[] = [];

  /*
   * Sample pixels instead of processing every single
   * pixel on large selections.
   */
  const pixelCount = width * height;

  const step = Math.max(1, Math.floor(pixelCount / 12000));

  for (let index = 0; index < data.data.length; index += 4 * step) {
    const alpha = data.data[index + 3];

    if (alpha < 200) continue;

    pixels.push({
      r: data.data[index],
      g: data.data[index + 1],
      b: data.data[index + 2],
    });
  }

  if (pixels.length === 0) {
    return {
      textColor: "#111111",
      backgroundColor: "#ffffff",
      fontSize: Math.max(12, Math.round(height * 0.65)),
      bold: false,
      alignment: "left",
      fontFamily: "Arial",
      letterSpacing: 0,
      textBounds: { x, y, width, height },
    };
  }

  /*
   * Background is usually represented by many pixels.
   * Edge pixels are especially useful because text tends
   * to occupy the center of the selected region.
   */
  const edgeColors: {
    r: number;
    g: number;
    b: number;
  }[] = [];

  const edgeThickness = Math.max(1, Math.round(Math.min(width, height) * 0.12));

  for (let py = 0; py < height; py += Math.max(1, Math.floor(height / 40))) {
    for (let px = 0; px < width; px += Math.max(1, Math.floor(width / 40))) {
      const isEdge =
        px < edgeThickness ||
        px >= width - edgeThickness ||
        py < edgeThickness ||
        py >= height - edgeThickness;

      if (!isEdge) continue;

      const index = (py * width + px) * 4;

      if (data.data[index + 3] < 200) continue;

      edgeColors.push({
        r: data.data[index],
        g: data.data[index + 1],
        b: data.data[index + 2],
      });
    }
  }

  const background =
    edgeColors.length > 0 ? averageColors(edgeColors) : averageColors(pixels);

  /*
   * Text pixels should normally differ considerably
   * from the estimated background.
   */
  const foregroundCandidates = pixels.filter(
    (pixel) => colorDistance(pixel, background) > 55,
  );

  let foreground: {
    r: number;
    g: number;
    b: number;
  };

  if (foregroundCandidates.length > 0) {
    /*
     * Favor the darker group on light backgrounds and
     * lighter group on dark backgrounds.
     */
    const backgroundLight = luminance(background) >= 128;

    const sorted = [...foregroundCandidates].sort((a, b) =>
      backgroundLight
        ? luminance(a) - luminance(b)
        : luminance(b) - luminance(a),
    );

    const amount = Math.max(1, Math.round(sorted.length * 0.35));

    foreground = averageColors(sorted.slice(0, amount));
  } else {
    foreground =
      luminance(background) > 128
        ? { r: 20, g: 20, b: 20 }
        : { r: 245, g: 245, b: 245 };
  }

  /*
   * Selection height gives us a useful first font-size
   * estimate. Actual fitting happens later.
   */
  const estimatedFontSize = clamp(Math.round(height * 0.65), 10, 220);

  /*
   * We cannot truly recover font weight from pixels.
   * Strong foreground coverage is a reasonable visual
   * estimate for document/screenshot text.
   */
  const foregroundRatio =
    foregroundCandidates.length / Math.max(1, pixels.length);

  const basicStyle = {
    textColor: rgbToHex(foreground.r, foreground.g, foreground.b),
    backgroundColor: rgbToHex(background.r, background.g, background.b),
    fontSize: estimatedFontSize,
    bold: foregroundRatio > 0.22,
    alignment: "left" as const,
  };
  const geometry = analyzeTextGeometry(context, selection, basicStyle);
  return {
    ...basicStyle,
    fontSize: geometry.fontSize,
    alignment: geometry.alignment,
    fontFamily: "Arial",
    letterSpacing: 0,
    textBounds: geometry.textBounds,
  };
}

function analyzeTextGeometry(
  context: CanvasRenderingContext2D,
  selection: Selection,
  style: Omit<DetectedStyle, "fontFamily" | "letterSpacing" | "textBounds">,
) {
  const x = Math.max(0, Math.round(selection.x));
  const y = Math.max(0, Math.round(selection.y));
  const width = Math.max(1, Math.round(selection.width));
  const height = Math.max(1, Math.round(selection.height));
  const data = context.getImageData(x, y, width, height);

  const bgHex = style.backgroundColor.replace("#", "");
  const bg = {
    r: Number.parseInt(bgHex.slice(0, 2), 16),
    g: Number.parseInt(bgHex.slice(2, 4), 16),
    b: Number.parseInt(bgHex.slice(4, 6), 16),
  };

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const threshold = 48;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const i = (py * width + px) * 4;
      if (data.data[i + 3] < 160) continue;
      const pixel = {
        r: data.data[i],
        g: data.data[i + 1],
        b: data.data[i + 2],
      };
      if (colorDistance(pixel, bg) < threshold) continue;
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
  }

  const hasForeground = maxX >= minX && maxY >= minY;
  const localBounds = hasForeground
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width, height };

  const leftGap = localBounds.x;
  const rightGap = width - (localBounds.x + localBounds.width);
  let alignment: "left" | "center" | "right" = "left";
  if (Math.abs(leftGap - rightGap) <= Math.max(3, width * 0.08))
    alignment = "center";
  else if (rightGap < leftGap * 0.45) alignment = "right";

  const visibleHeight = Math.max(1, localBounds.height);
  const fontSize = clamp(Math.round(visibleHeight / 0.76), 8, 240);

  return {
    alignment,
    fontSize,
    textBounds: {
      x: x + localBounds.x,
      y: y + localBounds.y,
      width: localBounds.width,
      height: localBounds.height,
    },
  };
}

function chooseClosestFont(
  context: CanvasRenderingContext2D,
  text: string,
  targetWidth: number,
  fontSize: number,
  bold: boolean,
) {
  const candidates = [
    "Arial",
    "Helvetica",
    "Inter",
    "Roboto",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Georgia",
    "Times New Roman",
  ];
  const sample = text.replace(/\\s+/g, " ").trim() || "Text";
  let best = candidates[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const family of candidates) {
    context.font = `${bold ? "700" : "400"} ${fontSize}px "${family}", sans-serif`;
    const diff = Math.abs(context.measureText(sample).width - targetWidth);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = family;
    }
  }
  return best;
}

function drawTextWithSpacing(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
) {
  let cursor = x;
  for (const character of text) {
    context.fillText(character, cursor, y);
    cursor += context.measureText(character).width + letterSpacing;
  }
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const paragraphs = text.split("\n");

  const lines: string[] = [];

  paragraphs.forEach((paragraph) => {
    if (!paragraph.trim()) {
      lines.push("");
      return;
    }

    const words = paragraph.split(/\s+/);

    let currentLine = "";

    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;

      if (context.measureText(candidate).width <= maxWidth || !currentLine) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) {
      lines.push(currentLine);
    }
  });

  return lines;
}

function findFittingTextLayout({
  context,
  text,
  width,
  height,
  startingFontSize,
  bold,
  fontFamily = "Arial",
}: {
  context: CanvasRenderingContext2D;
  text: string;
  width: number;
  height: number;
  startingFontSize: number;
  bold: boolean;
  fontFamily?: string;
}) {
  const paddingX = Math.max(2, Math.round(width * 0.025));

  const paddingY = Math.max(1, Math.round(height * 0.05));

  const availableWidth = Math.max(1, width - paddingX * 2);

  const availableHeight = Math.max(1, height - paddingY * 2);

  let fontSize = clamp(startingFontSize, 8, 240);

  let lines: string[] = [];

  while (fontSize >= 8) {
    context.font = `${bold ? "700" : "400"} ${fontSize}px "${fontFamily}", Arial, sans-serif`;

    lines = wrapText(context, text, availableWidth);

    const lineHeight = fontSize * 1.15;

    const totalHeight = lines.length * lineHeight;

    const widest = Math.max(
      0,
      ...lines.map((line) => context.measureText(line).width),
    );

    if (widest <= availableWidth && totalHeight <= availableHeight) {
      return {
        fontSize,
        lines,
        lineHeight,
        paddingX,
        paddingY,
      };
    }

    fontSize -= 1;
  }

  context.font = `${bold ? "700" : "400"} 8px "${fontFamily}", Arial, sans-serif`;

  lines = wrapText(context, text, availableWidth);

  return {
    fontSize: 8,
    lines,
    lineHeight: 9.2,
    paddingX,
    paddingY,
  };
}

export function ImageTextEditor() {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const baseImageRef = useRef<HTMLImageElement | null>(null);

  const selectionStartRef = useRef<{
    x: number;
    y: number;
  } | null>(null);

  const [hasImage, setHasImage] = useState(false);

  const [canvasSize, setCanvasSize] = useState({
    width: 1,
    height: 1,
  });

  const [filename, setFilename] = useState("edited-image");

  const [tool, setTool] = useState<Tool>("select");

  const [selection, setSelection] = useState<Selection | null>(null);

  const [texts, setTexts] = useState<TextItem[]>([]);

  const [activeTextId, setActiveTextId] = useState<string | null>(null);

  const [textValue, setTextValue] = useState("");

  const [fontSize, setFontSize] = useState(36);

  const [textColor, setTextColor] = useState("#111111");

  const [bold, setBold] = useState(false);

  const [coverColor, setCoverColor] = useState("#ffffff");

  const [format, setFormat] = useState<ExportFormat>("png");

  const [zoom, setZoom] = useState(1);

  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);

  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);

  const [ocrRunning, setOcrRunning] = useState(false);

  const [ocrText, setOcrText] = useState("");

  const [replacementText, setReplacementText] = useState("");

  const [detectedStyle, setDetectedStyle] = useState<DetectedStyle | null>(
    null,
  );

  const [processing, setProcessing] = useState(false);

  const [error, setError] = useState("");

  const redrawCanvas = useCallback(
    (image = baseImageRef.current, currentTexts = texts) => {
      const canvas = canvasRef.current;

      if (!canvas || !image) return;

      const context = canvas.getContext("2d");

      if (!context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      currentTexts.forEach((item) => {
        context.save();

        context.fillStyle = item.color;

        context.font = `${
          item.bold ? "700" : "400"
        } ${item.fontSize}px Arial, Helvetica, sans-serif`;

        context.textBaseline = "top";

        const lines = item.text.split("\n");

        lines.forEach((line, index) => {
          context.fillText(line, item.x, item.y + index * item.fontSize * 1.2);
        });

        context.restore();
      });
    },
    [texts],
  );

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas, canvasSize.width, canvasSize.height]);

  async function createSnapshot(): Promise<EditorSnapshot | null> {
    const canvas = canvasRef.current;

    const baseImage = baseImageRef.current;

    if (!canvas || !baseImage) {
      return null;
    }

    const temp = document.createElement("canvas");

    temp.width = canvas.width;
    temp.height = canvas.height;

    const context = temp.getContext("2d");

    if (!context) return null;

    context.drawImage(baseImage, 0, 0, temp.width, temp.height);

    return {
      baseImage: temp.toDataURL("image/png"),

      texts: cloneTexts(texts),

      width: canvas.width,
      height: canvas.height,
    };
  }

  async function pushUndoSnapshot() {
    const snapshot = await createSnapshot();

    if (!snapshot) return;

    setUndoStack((current) => [...current.slice(-29), snapshot]);

    setRedoStack([]);
  }

  async function restoreSnapshot(snapshot: EditorSnapshot) {
    const image = await loadImage(snapshot.baseImage);

    baseImageRef.current = image;

    setCanvasSize({
      width: snapshot.width,
      height: snapshot.height,
    });

    setTexts(cloneTexts(snapshot.texts));

    setSelection(null);
    setActiveTextId(null);
    setDetectedStyle(null);
    setOcrText("");
    setReplacementText("");

    window.requestAnimationFrame(() => {
      redrawCanvas(image, snapshot.texts);
    });
  }

  async function undo() {
    if (undoStack.length === 0) {
      return;
    }

    const current = await createSnapshot();

    if (!current) return;

    const previous = undoStack[undoStack.length - 1];

    setUndoStack((stack) => stack.slice(0, -1));

    setRedoStack((stack) => [...stack.slice(-29), current]);

    await restoreSnapshot(previous);
  }

  async function redo() {
    if (redoStack.length === 0) {
      return;
    }

    const current = await createSnapshot();

    if (!current) return;

    const next = redoStack[redoStack.length - 1];

    setRedoStack((stack) => stack.slice(0, -1));

    setUndoStack((stack) => [...stack.slice(-29), current]);

    await restoreSnapshot(next);
  }

  async function loadFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setError("Please use an image smaller than 25 MB.");
      return;
    }

    try {
      setError("");

      const objectUrl = URL.createObjectURL(file);

      const sourceImage = await loadImage(objectUrl);

      const maxSide = 3000;

      const scale = Math.min(
        1,
        maxSide / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight),
      );

      const width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));

      const height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));

      const temp = document.createElement("canvas");

      temp.width = width;
      temp.height = height;

      const context = temp.getContext("2d");

      if (!context) {
        URL.revokeObjectURL(objectUrl);

        throw new Error("Your browser could not process this image.");
      }

      context.drawImage(sourceImage, 0, 0, width, height);

      const workingImage = await loadImage(temp.toDataURL("image/png"));

      URL.revokeObjectURL(objectUrl);

      baseImageRef.current = workingImage;

      setCanvasSize({
        width,
        height,
      });

      setHasImage(true);

      setTexts([]);
      setSelection(null);

      setActiveTextId(null);

      setUndoStack([]);
      setRedoStack([]);

      setOcrText("");
      setReplacementText("");
      setDetectedStyle(null);

      setZoom(1);
      setTool("select");

      setFilename(`${file.name.replace(/\.[^.]+$/, "")}-edited`);

      window.requestAnimationFrame(() => {
        redrawCanvas(workingImage, []);
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not load image.",
      );
    }
  }

  function getCanvasPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current;

    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    return {
      x: clamp(
        ((clientX - rect.left) / rect.width) * canvas.width,
        0,
        canvas.width,
      ),

      y: clamp(
        ((clientY - rect.top) / rect.height) * canvas.height,
        0,
        canvas.height,
      ),
    };
  }

  async function handlePointerDown(
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) {
    const point = getCanvasPoint(event.clientX, event.clientY);

    if (!point) return;

    if (tool === "text") {
      await pushUndoSnapshot();

      const item: TextItem = {
        id: createId(),

        text: textValue.trim() || "Text",

        x: point.x,
        y: point.y,

        fontSize,

        color: textColor,

        bold,
      };

      setTexts((current) => [...current, item]);

      setActiveTextId(item.id);

      return;
    }

    selectionStartRef.current = point;

    setSelection({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });

    /*
     * New selection invalidates previous
     * OCR/style analysis.
     */
    setDetectedStyle(null);
    setOcrText("");
    setReplacementText("");

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const start = selectionStartRef.current;

    if (!start) return;

    const point = getCanvasPoint(event.clientX, event.clientY);

    if (!point) return;

    setSelection({
      x: Math.min(start.x, point.x),

      y: Math.min(start.y, point.y),

      width: Math.abs(point.x - start.x),

      height: Math.abs(point.y - start.y),
    });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    selectionStartRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function flattenCanvas() {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const image = await loadImage(canvas.toDataURL("image/png"));

    baseImageRef.current = image;

    setTexts([]);
    setActiveTextId(null);

    window.requestAnimationFrame(() => {
      redrawCanvas(image, []);
    });
  }

  async function analyzeAndExtractText() {
    const canvas = canvasRef.current;

    if (!canvas || !selection) {
      setError("Select the existing text first.");
      return;
    }

    if (selection.width < 5 || selection.height < 5) {
      setError("Select a larger text area.");
      return;
    }

    try {
      setError("");
      setOcrRunning(true);

      /*
       * Ensure the canvas contains the
       * latest image state.
       */
      redrawCanvas();

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not analyze the image.");
      }

      const style = sampleRegionStyle(context, selection);

      const selectedCanvas = document.createElement("canvas");

      selectedCanvas.width = Math.max(1, Math.round(selection.width));

      selectedCanvas.height = Math.max(1, Math.round(selection.height));

      const selectedContext = selectedCanvas.getContext("2d");

      if (!selectedContext) {
        throw new Error("Could not prepare the selected area.");
      }

      selectedContext.drawImage(
        canvas,

        selection.x,
        selection.y,
        selection.width,
        selection.height,

        0,
        0,
        selectedCanvas.width,
        selectedCanvas.height,
      );

      const worker = await createWorker("eng");

      try {
        const result = await worker.recognize(selectedCanvas);

        const detected = result.data.text.trim();
        const matchedStyle = { ...style };
        if (detected) {
          matchedStyle.fontFamily = chooseClosestFont(
            context,
            detected,
            Math.max(1, style.textBounds.width),
            style.fontSize,
            style.bold,
          );
          context.font = `${style.bold ? "700" : "400"} ${style.fontSize}px "${matchedStyle.fontFamily}", sans-serif`;
          const naturalWidth = context.measureText(
            detected.replace(/\s+/g, " "),
          ).width;
          const gaps = Math.max(1, detected.replace(/\s/g, "").length - 1);
          matchedStyle.letterSpacing = clamp(
            (style.textBounds.width - naturalWidth) / gaps,
            -2,
            4,
          );
        }
        setDetectedStyle(matchedStyle);

        setOcrText(detected);

        setReplacementText(detected);

        setTool("replace");

        if (!detected) {
          setError(
            "No clear text was detected. You can still type replacement text manually.",
          );
        }
      } finally {
        await worker.terminate();
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Text recognition failed.",
      );
    } finally {
      setOcrRunning(false);
    }
  }

  async function replaceSelectedText() {
    const canvas = canvasRef.current;

    if (!canvas || !selection) {
      setError("Select the text area first.");
      return;
    }

    if (!replacementText.trim()) {
      setError("Enter the replacement text.");
      return;
    }

    try {
      setError("");

      await pushUndoSnapshot();

      redrawCanvas();

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Could not edit the image.");
      }

      /*
       * Analyze again if the user has not
       * already run Detect Text.
       */
      const style = detectedStyle ?? sampleRegionStyle(context, selection);

      const x = Math.round(selection.x);

      const y = Math.round(selection.y);

      const width = Math.max(1, Math.round(selection.width));

      const height = Math.max(1, Math.round(selection.height));

      /*
       * V1 background reconstruction:
       * fill the selected region using the
       * estimated surrounding background.
       *
       * This works very well for documents,
       * forms and plain UI backgrounds.
       */
      context.save();

      context.fillStyle = style.backgroundColor;
      const erasePad = Math.max(1, Math.round(style.fontSize * 0.08));
      const eraseX = Math.max(x, Math.round(style.textBounds.x - erasePad));
      const eraseY = Math.max(y, Math.round(style.textBounds.y - erasePad));
      const eraseRight = Math.min(
        x + width,
        Math.round(style.textBounds.x + style.textBounds.width + erasePad),
      );
      const eraseBottom = Math.min(
        y + height,
        Math.round(style.textBounds.y + style.textBounds.height + erasePad),
      );
      context.fillRect(
        eraseX,
        eraseY,
        Math.max(1, eraseRight - eraseX),
        Math.max(1, eraseBottom - eraseY),
      );

      context.restore();

      /*
       * Fit replacement text automatically
       * inside the SAME selected rectangle.
       */
      const layout = findFittingTextLayout({
        context,

        text: replacementText.trim(),

        width,
        height,

        startingFontSize: style.fontSize,

        bold: style.bold,
        fontFamily: style.fontFamily,
      });

      context.save();

      context.fillStyle = style.textColor;

      context.font = `${style.bold ? "700" : "400"} ${layout.fontSize}px "${style.fontFamily}", Arial, sans-serif`;
      context.textBaseline = "top";

      const totalHeight = layout.lines.length * layout.lineHeight;

      /*
       * Vertically center text inside
       * the original selection.
       */
      const originalTop = style.textBounds.y;
      const startY = clamp(
        originalTop - Math.max(0, (layout.fontSize - style.fontSize) * 0.18),
        y,
        y + height - totalHeight,
      );

      layout.lines.forEach((line, index) => {
        const measured = context.measureText(line).width;

        let lineX = Math.max(x, style.textBounds.x);

        if (style.alignment === "center") {
          lineX = style.textBounds.x + (style.textBounds.width - measured) / 2;
        }

        if (style.alignment === "right") {
          lineX = style.textBounds.x + style.textBounds.width - measured;
        }

        drawTextWithSpacing(
          context,
          line,
          lineX,
          startY + index * layout.lineHeight,
          style.letterSpacing,
        );
      });

      context.restore();

      /*
       * Make the replacement part of
       * the actual working image.
       */
      await flattenCanvas();

      setSelection(null);
      setDetectedStyle(null);
      setOcrText("");
      setReplacementText("");
      setTool("select");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not replace the selected text.",
      );
    }
  }

  async function applySelectionEffect(effect: "blur" | "pixelate" | "cover") {
    const canvas = canvasRef.current;

    if (!canvas || !selection) {
      setError("Select an area first.");
      return;
    }

    if (selection.width < 2 || selection.height < 2) {
      setError("Select a larger area.");
      return;
    }

    try {
      setError("");

      await pushUndoSnapshot();

      redrawCanvas();

      const context = canvas.getContext("2d");

      if (!context) return;

      const x = Math.round(selection.x);

      const y = Math.round(selection.y);

      const width = Math.max(1, Math.round(selection.width));

      const height = Math.max(1, Math.round(selection.height));

      if (effect === "cover") {
        context.save();

        context.fillStyle = coverColor;

        context.fillRect(x, y, width, height);

        context.restore();
      }

      if (effect === "blur") {
        const temp = document.createElement("canvas");

        temp.width = width;
        temp.height = height;

        const tempContext = temp.getContext("2d");

        if (!tempContext) return;

        tempContext.drawImage(
          canvas,

          x,
          y,
          width,
          height,

          0,
          0,
          width,
          height,
        );

        context.save();

        context.beginPath();

        context.rect(x, y, width, height);

        context.clip();

        context.filter = "blur(14px)";

        context.drawImage(
          temp,
          -12,
          -12,
          width + 24,
          height + 24,

          x - 12,
          y - 12,
          width + 24,
          height + 24,
        );

        context.restore();
      }

      if (effect === "pixelate") {
        const pixelSize = Math.max(8, Math.round(Math.min(width, height) / 20));

        const smallWidth = Math.max(1, Math.ceil(width / pixelSize));

        const smallHeight = Math.max(1, Math.ceil(height / pixelSize));

        const temp = document.createElement("canvas");

        temp.width = smallWidth;
        temp.height = smallHeight;

        const tempContext = temp.getContext("2d");

        if (!tempContext) return;

        tempContext.imageSmoothingEnabled = false;

        tempContext.drawImage(
          canvas,

          x,
          y,
          width,
          height,

          0,
          0,
          smallWidth,
          smallHeight,
        );

        context.save();

        context.imageSmoothingEnabled = false;

        context.drawImage(
          temp,

          0,
          0,
          smallWidth,
          smallHeight,

          x,
          y,
          width,
          height,
        );

        context.restore();
      }

      await flattenCanvas();

      setSelection(null);
      setDetectedStyle(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not apply this edit.",
      );
    }
  }

  async function cropSelection() {
    const canvas = canvasRef.current;

    if (!canvas || !selection) {
      setError("Select the area you want to crop.");
      return;
    }

    if (selection.width < 5 || selection.height < 5) {
      setError("The selected area is too small.");
      return;
    }

    try {
      setError("");

      await pushUndoSnapshot();

      redrawCanvas();

      const crop = document.createElement("canvas");

      crop.width = Math.max(1, Math.round(selection.width));

      crop.height = Math.max(1, Math.round(selection.height));

      const context = crop.getContext("2d");

      if (!context) return;

      context.drawImage(
        canvas,

        selection.x,
        selection.y,
        selection.width,
        selection.height,

        0,
        0,
        crop.width,
        crop.height,
      );

      const image = await loadImage(crop.toDataURL("image/png"));

      baseImageRef.current = image;

      setCanvasSize({
        width: crop.width,
        height: crop.height,
      });

      setTexts([]);
      setActiveTextId(null);
      setSelection(null);

      setDetectedStyle(null);
      setOcrText("");
      setReplacementText("");

      window.requestAnimationFrame(() => {
        redrawCanvas(image, []);
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not crop the image.",
      );
    }
  }

  async function beginTextEdit() {
    await pushUndoSnapshot();
  }

  function updateActiveText(changes: Partial<TextItem>) {
    if (!activeTextId) return;

    setTexts((current) =>
      current.map((item) =>
        item.id === activeTextId
          ? {
              ...item,
              ...changes,
            }
          : item,
      ),
    );
  }

  async function deleteActiveText() {
    if (!activeTextId) return;

    await pushUndoSnapshot();

    setTexts((current) => current.filter((item) => item.id !== activeTextId));

    setActiveTextId(null);
  }

  async function exportImage() {
    const canvas = canvasRef.current;

    if (!canvas) return;

    try {
      setProcessing(true);
      setError("");

      redrawCanvas();

      if (format === "jpg") {
        const exportCanvas = document.createElement("canvas");

        exportCanvas.width = canvas.width;

        exportCanvas.height = canvas.height;

        const context = exportCanvas.getContext("2d");

        if (!context) {
          throw new Error("Could not export the image.");
        }

        context.fillStyle = "#ffffff";

        context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

        context.drawImage(canvas, 0, 0);

        const blob = await canvasToBlob(exportCanvas, "image/jpeg", 0.92);

        downloadBlob(blob, `${safeFilename(filename)}.jpg`);

        return;
      }

      const mime = format === "webp" ? "image/webp" : "image/png";

      const blob = await canvasToBlob(
        canvas,
        mime,
        format === "webp" ? 0.92 : undefined,
      );

      downloadBlob(blob, `${safeFilename(filename)}.${format}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not export the image.",
      );
    } finally {
      setProcessing(false);
    }
  }

  function removeImage() {
    baseImageRef.current = null;

    setHasImage(false);

    setCanvasSize({
      width: 1,
      height: 1,
    });

    setTexts([]);

    setSelection(null);

    setActiveTextId(null);

    setUndoStack([]);
    setRedoStack([]);

    setOcrText("");
    setReplacementText("");
    setDetectedStyle(null);

    setError("");

    setZoom(1);

    setTool("select");
  }

  /*
   * React render uses state dimensions,
   * not canvasRef.current.
   */
  const selectionStyle = selection
    ? {
        left: `${(selection.x / canvasSize.width) * 100}%`,

        top: `${(selection.y / canvasSize.height) * 100}%`,

        width: `${(selection.width / canvasSize.width) * 100}%`,

        height: `${(selection.height / canvasSize.height) * 100}%`,
      }
    : undefined;

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            void loadFile(file);
          }

          event.target.value = "";
        }}
      />

      {!hasImage ? (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();

            const file = event.dataTransfer.files?.[0];

            if (file) {
              void loadFile(file);
            }
          }}
          className="rounded-3xl border-2 border-dashed border-gray-300 bg-white px-6 py-16 text-center"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-3xl font-bold text-blue-600">
            +
          </div>

          <h2 className="mt-5 text-xl font-bold text-gray-950">
            Upload an image
          </h2>

          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500">
            Select existing text, detect it, replace it in the same position,
            blur, pixelate, crop or add new text.
          </p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-6 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Select Image
          </button>

          <p className="mt-4 text-xs text-gray-400">
            JPG, PNG or WebP · Up to 25 MB
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3 sm:p-4">
            {(
              [
                ["select", "Select"],
                ["replace", "Replace Text"],
                ["text", "Add Text"],
                ["blur", "Blur"],
                ["pixelate", "Pixelate"],
                ["cover", "Cover"],
              ] as [Tool, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTool(id);

                  /*
                   * Keep the selection
                   * when entering Replace,
                   * Blur, Pixelate or Cover.
                   */
                  if (id === "text") {
                    setSelection(null);
                  }
                }}
                className={[
                  "rounded-xl border px-3 py-2 text-sm font-semibold transition",

                  tool === id
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                {label}
              </button>
            ))}

            <div className="ml-auto flex gap-2">
              <button
                type="button"
                disabled={undoStack.length === 0}
                onClick={() => void undo()}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↶ Undo
              </button>

              <button
                type="button"
                disabled={redoStack.length === 0}
                onClick={() => void redo()}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↷ Redo
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1fr_330px]">
            {/* Workspace */}
            <div className="min-w-0 bg-gray-950 p-3 sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-medium text-gray-400">
                  {tool === "text"
                    ? "Click on the image where you want to add new text."
                    : "Drag tightly around the text or area you want to edit."}
                </p>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setZoom((current) =>
                        Math.max(0.5, Number((current - 0.1).toFixed(1))),
                      )
                    }
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                  >
                    −
                  </button>

                  <span className="min-w-14 text-center text-xs font-semibold text-white">
                    {Math.round(zoom * 100)}%
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setZoom((current) =>
                        Math.min(2, Number((current + 0.1).toFixed(1))),
                      )
                    }
                    className="rounded-lg bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="overflow-auto">
                <div
                  className="relative mx-auto w-fit select-none"
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "top left",
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    onPointerDown={(event) => {
                      void handlePointerDown(event);
                    }}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className={[
                      "block max-h-[70vh] max-w-full touch-none bg-white",

                      tool === "text" ? "cursor-text" : "cursor-crosshair",
                    ].join(" ")}
                  />

                  {selection && selectionStyle && tool !== "text" && (
                    <div
                      className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10"
                      style={selectionStyle}
                    >
                      <div className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />

                      <div className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-blue-500" />

                      <div className="absolute -bottom-1 -left-1 h-2.5 w-2.5 rounded-full bg-blue-500" />

                      <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-blue-500" />

                      <span className="absolute -top-7 left-0 rounded-md bg-blue-600 px-2 py-1 text-[10px] font-semibold text-white">
                        Selected
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Controls */}
            <aside className="border-t border-gray-200 p-4 lg:border-l lg:border-t-0">
              {tool === "select" && (
                <div>
                  <h3 className="font-bold text-gray-950">Select Text</h3>

                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Draw a tight box around the existing text you want to
                    change.
                  </p>

                  <button
                    type="button"
                    disabled={!selection || ocrRunning}
                    onClick={() => void analyzeAndExtractText()}
                    className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    {ocrRunning ? "Detecting Text..." : "Detect & Edit Text"}
                  </button>

                  <button
                    type="button"
                    disabled={!selection}
                    onClick={() => void cropSelection()}
                    className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 disabled:opacity-40"
                  >
                    Crop Selection
                  </button>
                </div>
              )}

              {tool === "replace" && (
                <div>
                  <h3 className="font-bold text-gray-950">
                    Replace Selected Text
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    ConvertFlow will place the new text inside the same selected
                    area and approximate its original appearance.
                  </p>

                  {!selection && (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                      Select the original text on the image first.
                    </div>
                  )}

                  {selection && !detectedStyle && (
                    <button
                      type="button"
                      disabled={ocrRunning}
                      onClick={() => void analyzeAndExtractText()}
                      className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {ocrRunning ? "Detecting..." : "Detect Text & Style"}
                    </button>
                  )}

                  {detectedStyle && (
                    <>
                      <label className="mt-5 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Detected Text
                      </label>

                      <textarea
                        value={ocrText}
                        readOnly
                        rows={3}
                        className="mt-2 w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600"
                      />

                      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Replace With
                      </label>

                      <textarea
                        value={replacementText}
                        onChange={(event) =>
                          setReplacementText(event.target.value)
                        }
                        rows={4}
                        placeholder="Type the new text..."
                        className="mt-2 w-full rounded-xl border border-gray-300 p-3 text-sm text-gray-950 outline-none focus:border-blue-500"
                      />

                      <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs font-bold text-gray-700">
                          Approximate detected style
                        </p>

                        <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600">
                          <div>
                            Text
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className="h-5 w-5 rounded-full border border-gray-300"
                                style={{
                                  backgroundColor: detectedStyle.textColor,
                                }}
                              />

                              {detectedStyle.textColor}
                            </div>
                          </div>

                          <div>
                            Background
                            <div className="mt-1 flex items-center gap-2">
                              <span
                                className="h-5 w-5 rounded-full border border-gray-300"
                                style={{
                                  backgroundColor:
                                    detectedStyle.backgroundColor,
                                }}
                              />

                              {detectedStyle.backgroundColor}
                            </div>
                          </div>

                          <div>
                            Size
                            <div className="mt-1 font-semibold text-gray-900">
                              ~{detectedStyle.fontSize}
                              px
                            </div>
                          </div>

                          <div>
                            Weight
                            <div className="mt-1 font-semibold text-gray-900">
                              {detectedStyle.bold ? "Bold" : "Regular"}
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!replacementText.trim()}
                        onClick={() => void replaceSelectedText()}
                        className="mt-4 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-40"
                      >
                        Replace Selected Text
                      </button>

                      <p className="mt-3 text-xs leading-5 text-gray-400">
                        Exact font-family recovery is not possible from a
                        flattened image. ConvertFlow fits the closest
                        browser-rendered style into the original box.
                      </p>
                    </>
                  )}
                </div>
              )}

              {tool === "blur" && (
                <SelectionAction
                  title="Blur Selected Area"
                  description="Select the exact area you want to blur, then apply the change."
                  button="Apply Blur"
                  disabled={!selection}
                  onApply={() => void applySelectionEffect("blur")}
                />
              )}

              {tool === "pixelate" && (
                <SelectionAction
                  title="Pixelate Selected Area"
                  description="Hide names, numbers or other sensitive content."
                  button="Apply Pixelation"
                  disabled={!selection}
                  onApply={() => void applySelectionEffect("pixelate")}
                />
              )}

              {tool === "cover" && (
                <div>
                  <h3 className="font-bold text-gray-950">
                    Cover / Simple Erase
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Select an area and cover it with a solid color.
                  </p>

                  <label className="mt-4 block text-xs font-semibold text-gray-600">
                    Cover color
                  </label>

                  <input
                    type="color"
                    value={coverColor}
                    onChange={(event) => setCoverColor(event.target.value)}
                    className="mt-2 h-11 w-full cursor-pointer rounded-lg border border-gray-200"
                  />

                  <button
                    type="button"
                    disabled={!selection}
                    onClick={() => void applySelectionEffect("cover")}
                    className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Apply Cover
                  </button>
                </div>
              )}

              {tool === "text" && (
                <div>
                  <h3 className="font-bold text-gray-950">Add New Text</h3>

                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    This is for adding new text rather than replacing existing
                    text.
                  </p>

                  <textarea
                    value={textValue}
                    onFocus={() => {
                      if (activeTextId) {
                        void beginTextEdit();
                      }
                    }}
                    onChange={(event) => {
                      const value = event.target.value;

                      setTextValue(value);

                      updateActiveText({
                        text: value,
                      });
                    }}
                    placeholder="Type text..."
                    rows={4}
                    className="mt-4 w-full rounded-xl border border-gray-300 p-3 text-sm outline-none focus:border-blue-500"
                  />

                  <label className="mt-4 block text-xs font-semibold text-gray-600">
                    Font size
                  </label>

                  <input
                    type="range"
                    min="12"
                    max="160"
                    value={fontSize}
                    onPointerDown={() => {
                      if (activeTextId) {
                        void beginTextEdit();
                      }
                    }}
                    onChange={(event) => {
                      const value = Number(event.target.value);

                      setFontSize(value);

                      updateActiveText({
                        fontSize: value,
                      });
                    }}
                    className="mt-2 w-full"
                  />

                  <div className="mt-1 text-right text-xs text-gray-400">
                    {fontSize}px
                  </div>

                  <label className="mt-4 block text-xs font-semibold text-gray-600">
                    Text color
                  </label>

                  <input
                    type="color"
                    value={textColor}
                    onPointerDown={() => {
                      if (activeTextId) {
                        void beginTextEdit();
                      }
                    }}
                    onChange={(event) => {
                      const value = event.target.value;

                      setTextColor(value);

                      updateActiveText({
                        color: value,
                      });
                    }}
                    className="mt-2 h-11 w-full cursor-pointer rounded-lg border border-gray-200"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      if (activeTextId) {
                        void beginTextEdit();
                      }

                      const next = !bold;

                      setBold(next);

                      updateActiveText({
                        bold: next,
                      });
                    }}
                    className={[
                      "mt-4 w-full rounded-xl border px-4 py-3 text-sm font-bold",

                      bold
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-200 text-gray-700",
                    ].join(" ")}
                  >
                    Bold
                  </button>

                  {activeTextId && (
                    <button
                      type="button"
                      onClick={() => void deleteActiveText()}
                      className="mt-2 w-full rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50"
                    >
                      Delete Active Text
                    </button>
                  )}
                </div>
              )}

              {/* Export */}
              <div className="mt-6 border-t border-gray-200 pt-5">
                <h3 className="font-bold text-gray-950">Export</h3>

                <input
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
                />

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {(["png", "jpg", "webp"] as ExportFormat[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setFormat(option)}
                      className={[
                        "rounded-lg border px-2 py-2 text-xs font-semibold uppercase",

                        format === option
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-200 text-gray-700",
                      ].join(" ")}
                    >
                      {option}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={processing}
                  onClick={() => void exportImage()}
                  className="mt-3 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {processing ? "Preparing..." : "Download Image"}
                </button>

                <button
                  type="button"
                  onClick={removeImage}
                  className="mt-2 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                >
                  Choose Another Image
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <p className="mt-4 text-center text-xs text-gray-400">
        Editing happens in your browser. Your image is not permanently stored by
        ConvertFlow.
      </p>
    </div>
  );
}

function SelectionAction({
  title,
  description,
  button,
  disabled,
  onApply,
}: {
  title: string;
  description: string;
  button: string;
  disabled: boolean;
  onApply: () => void;
}) {
  return (
    <div>
      <h3 className="font-bold text-gray-950">{title}</h3>

      <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>

      <button
        type="button"
        disabled={disabled}
        onClick={onApply}
        className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {button}
      </button>
    </div>
  );
}

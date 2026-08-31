import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { Document, Packer, PageBreak, Paragraph, TextRun } from "docx";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_PAGES = 300;

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type TextLine = {
  y: number;
  items: PdfTextItem[];
};

function isPdfFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf"
  );
}

function sanitizeBaseName(fileName: string) {
  const withoutExtension = fileName.replace(/\.pdf$/i, "");

  const cleaned = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "converted-document";
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (typeof item !== "object" || item === null) {
    return false;
  }

  const value = item as Record<string, unknown>;

  return (
    typeof value.str === "string" &&
    Array.isArray(value.transform) &&
    value.transform.length >= 6 &&
    typeof value.width === "number" &&
    typeof value.height === "number"
  );
}

function buildLines(items: PdfTextItem[]) {
  const sortedItems = [...items].sort((a, b) => {
    const aY = a.transform[5] ?? 0;
    const bY = b.transform[5] ?? 0;

    if (Math.abs(bY - aY) > 3) {
      return bY - aY;
    }

    const aX = a.transform[4] ?? 0;
    const bX = b.transform[4] ?? 0;

    return aX - bX;
  });

  const lines: TextLine[] = [];
  const yTolerance = 3;

  for (const item of sortedItems) {
    if (!item.str.trim()) {
      continue;
    }

    const y = item.transform[5] ?? 0;

    let matchingLine: TextLine | undefined;

    for (const line of lines) {
      if (Math.abs(line.y - y) <= yTolerance) {
        matchingLine = line;
        break;
      }
    }

    if (matchingLine) {
      matchingLine.items.push(item);
    } else {
      lines.push({
        y,
        items: [item],
      });
    }
  }

  lines.sort((a, b) => b.y - a.y);

  for (const line of lines) {
    line.items.sort((a, b) => {
      const aX = a.transform[4] ?? 0;
      const bX = b.transform[4] ?? 0;

      return aX - bX;
    });
  }

  return lines;
}

function buildLineText(items: PdfTextItem[]) {
  let text = "";
  let previousEndX: number | null = null;

  for (const item of items) {
    const currentText = item.str.trim();

    if (!currentText) {
      continue;
    }

    const x = item.transform[4] ?? 0;

    if (text.length > 0 && previousEndX !== null) {
      const gap = x - previousEndX;

      if (gap > 1 && !text.endsWith(" ")) {
        text += " ";
      }
    }

    text += currentText;

    previousEndX = x + item.width;
  }

  return text.trim();
}

function createParagraph(text: string) {
  return new Paragraph({
    spacing: {
      after: 80,
      line: 276,
    },

    children: [
      new TextRun({
        text,
        size: 22,
      }),
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    /*
     * -------------------------------------------------------
     * 1. READ UPLOADED FILE
     * -------------------------------------------------------
     */

    const formData = await request.formData();

    const entry = formData.get("file");

    if (!(entry instanceof File)) {
      return NextResponse.json(
        {
          error: "Please upload a PDF file.",
        },
        {
          status: 400,
        },
      );
    }

    const file = entry;

    /*
     * -------------------------------------------------------
     * 2. VALIDATE FILE
     * -------------------------------------------------------
     */

    if (!isPdfFile(file)) {
      return NextResponse.json(
        {
          error: "Only PDF files are supported.",
        },
        {
          status: 400,
        },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        {
          error: "The uploaded PDF is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "The PDF must be smaller than 25 MB.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * -------------------------------------------------------
     * 3. LOAD PDF
     * -------------------------------------------------------
     */

    const pdfBytes = new Uint8Array(await file.arrayBuffer());

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    /*
     * Next.js may bundle the PDF.js server module into .next,
     * which can make PDF.js look for its worker in the wrong
     * location.
     *
     * Point PDF.js directly to the worker installed in
     * node_modules.
     */

    const workerPath = path.join(
      process.cwd(),
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.mjs",
    );

    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

    const loadingTask = pdfjs.getDocument({
      data: pdfBytes,
      useSystemFonts: true,
    });

    const pdf = await loadingTask.promise;

    /*
     * -------------------------------------------------------
     * 4. PAGE LIMIT
     * -------------------------------------------------------
     */

    if (pdf.numPages > MAX_PAGES) {
      return NextResponse.json(
        {
          error: `This PDF contains ${pdf.numPages} pages. The current limit is ${MAX_PAGES} pages.`,
        },
        {
          status: 400,
        },
      );
    }

    /*
     * -------------------------------------------------------
     * 5. EXTRACT TEXT
     * -------------------------------------------------------
     */

    const documentChildren: Paragraph[] = [];

    let extractedCharacters = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);

      const textContent = await page.getTextContent();

      const textItems: PdfTextItem[] = [];

      for (const item of textContent.items) {
        if (isPdfTextItem(item)) {
          textItems.push(item);
        }
      }

      const lines = buildLines(textItems);

      for (const line of lines) {
        const lineText = buildLineText(line.items);

        if (!lineText) {
          continue;
        }

        extractedCharacters += lineText.length;

        documentChildren.push(createParagraph(lineText));
      }

      /*
       * Preserve PDF page separation inside Word.
       */

      if (pageNumber < pdf.numPages) {
        documentChildren.push(
          new Paragraph({
            children: [new PageBreak()],
          }),
        );
      }

      page.cleanup();
    }

    /*
     * -------------------------------------------------------
     * 6. DETECT SCANNED / IMAGE PDF
     * -------------------------------------------------------
     */

    if (extractedCharacters < 10) {
      return NextResponse.json(
        {
          error:
            "Very little selectable text was found in this PDF. It may be a scanned or image-based PDF and requires OCR conversion.",

          code: "OCR_REQUIRED",
        },
        {
          status: 422,
        },
      );
    }

    /*
     * -------------------------------------------------------
     * 7. BUILD WORD DOCUMENT
     * -------------------------------------------------------
     */

    const document = new Document({
      creator: "ConvertFlow",

      title: sanitizeBaseName(file.name),

      description: "Converted from PDF to Word",

      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1080,
                right: 1080,
                bottom: 1080,
                left: 1080,
              },
            },
          },

          children: documentChildren,
        },
      ],
    });

    /*
     * -------------------------------------------------------
     * 8. GENERATE DOCX
     * -------------------------------------------------------
     */

    const docxBuffer = await Packer.toBuffer(document);

    if (docxBuffer.length === 0) {
      throw new Error("The generated Word document is empty.");
    }

    /*
     * -------------------------------------------------------
     * 9. OUTPUT FILENAME
     * -------------------------------------------------------
     */

    const outputFileName = `${sanitizeBaseName(file.name)}.docx`;

    const responseBody = new Uint8Array(docxBuffer);

    /*
     * -------------------------------------------------------
     * 10. RETURN WORD DOCUMENT
     * -------------------------------------------------------
     */

    return new NextResponse(responseBody, {
      status: 200,

      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

        "Content-Disposition": `attachment; filename="${outputFileName}"`,

        "Content-Length": docxBuffer.length.toString(),

        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("PDF to Word error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while converting the PDF to Word.",
      },
      {
        status: 500,
      },
    );
  }
}

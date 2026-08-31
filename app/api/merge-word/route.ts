import { NextRequest, NextResponse } from "next/server";

// docx-merger does not provide complete TypeScript definitions.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DocxMerger = require("docx-merger");

export const runtime = "nodejs";

const MAX_FILES = 20;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;

function isDocxFile(file: File) {
  const fileName = file.name.toLowerCase();

  return (
    fileName.endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

async function mergeDocxFiles(files: File[]): Promise<Buffer> {
  const buffers: Buffer[] = [];

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();

    buffers.push(Buffer.from(arrayBuffer));
  }

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const merger = new DocxMerger(
        {
          pageBreak: true,
        },
        buffers,
      );

      merger.save("nodebuffer", (data: Buffer | Uint8Array | ArrayBuffer) => {
        try {
          if (Buffer.isBuffer(data)) {
            resolve(data);
            return;
          }

          if (data instanceof Uint8Array) {
            resolve(Buffer.from(data));
            return;
          }

          if (data instanceof ArrayBuffer) {
            resolve(Buffer.from(data));
            return;
          }

          reject(new Error("The Word merger returned an unsupported result."));
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const entries = formData.getAll("files");

    const files = entries.filter(
      (entry): entry is File => entry instanceof File,
    );

    if (files.length < 2) {
      return NextResponse.json(
        {
          error: "Please provide at least two Word documents.",
        },
        {
          status: 400,
        },
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        {
          error: `You can merge up to ${MAX_FILES} Word documents at once.`,
        },
        {
          status: 400,
        },
      );
    }

    for (const file of files) {
      if (!isDocxFile(file)) {
        return NextResponse.json(
          {
            error: `"${file.name}" is not a supported .docx Word document.`,
          },
          {
            status: 400,
          },
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `"${file.name}" is larger than 25 MB.`,
          },
          {
            status: 400,
          },
        );
      }
    }

    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json(
        {
          error:
            "The combined size of all Word documents must be under 100 MB.",
        },
        {
          status: 400,
        },
      );
    }

    const mergedBuffer = await mergeDocxFiles(files);

    const responseBody = new Uint8Array(mergedBuffer);

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

        "Content-Disposition":
          'attachment; filename="ConvertFlow-Merged-Word.docx"',

        "Content-Length": mergedBuffer.length.toString(),

        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Merge Word error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while merging the Word documents.",
      },
      {
        status: 500,
      },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

const MAX_FILE_SIZE = 25 * 1024 * 1024;

function isDocxFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

function sanitizeBaseName(fileName: string) {
  const withoutExtension = fileName.replace(/\.docx$/i, "");

  const cleaned = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "converted-document";
}

function getLibreOfficePath() {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];

    return candidates;
  }

  if (process.platform === "darwin") {
    return ["/Applications/LibreOffice.app/Contents/MacOS/soffice"];
  }

  return [
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/usr/local/bin/libreoffice",
    "/usr/local/bin/soffice",
  ];
}

async function findLibreOfficeExecutable() {
  const candidates = getLibreOfficePath();

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("LibreOffice is not available on the server.");
}

async function removeDirectory(directory: string) {
  try {
    await fs.rm(directory, {
      recursive: true,
      force: true,
    });
  } catch (error) {
    console.error("Unable to remove temporary conversion directory:", error);
  }
}

export async function POST(request: NextRequest) {
  let tempDirectory = "";

  try {
    const formData = await request.formData();

    const entry = formData.get("file");

    if (!(entry instanceof File)) {
      return NextResponse.json(
        {
          error: "Please upload a Word document.",
        },
        {
          status: 400,
        },
      );
    }

    const file = entry;

    if (!isDocxFile(file)) {
      return NextResponse.json(
        {
          error: "Only .docx Word documents are supported.",
        },
        {
          status: 400,
        },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        {
          error: "The uploaded Word document is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "The Word document must be smaller than 25 MB.",
        },
        {
          status: 400,
        },
      );
    }

    const libreOffice = await findLibreOfficeExecutable();

    tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "convertflow-word-to-pdf-"),
    );

    const inputDirectory = path.join(tempDirectory, "input");
    const outputDirectory = path.join(tempDirectory, "output");
    const profileDirectory = path.join(tempDirectory, "profile");

    await Promise.all([
      fs.mkdir(inputDirectory, {
        recursive: true,
      }),
      fs.mkdir(outputDirectory, {
        recursive: true,
      }),
      fs.mkdir(profileDirectory, {
        recursive: true,
      }),
    ]);

    const safeBaseName = sanitizeBaseName(file.name);

    const inputFilePath = path.join(inputDirectory, `${safeBaseName}.docx`);

    const fileBytes = new Uint8Array(await file.arrayBuffer());

    await fs.writeFile(inputFilePath, fileBytes);

    const profileUrl =
      "file:///" + profileDirectory.replace(/\\/g, "/").replace(/^\/+/, "");

    try {
      await execFileAsync(
        libreOffice,
        [
          "--headless",
          "--nologo",
          "--nodefault",
          "--nolockcheck",
          "--nofirststartwizard",
          `-env:UserInstallation=${profileUrl}`,
          "--convert-to",
          "pdf",
          "--outdir",
          outputDirectory,
          inputFilePath,
        ],
        {
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
    } catch (error) {
      console.error("LibreOffice conversion error:", error);

      throw new Error("LibreOffice could not convert this Word document.");
    }

    const expectedPdfPath = path.join(outputDirectory, `${safeBaseName}.pdf`);

    let pdfPath = expectedPdfPath;

    try {
      await fs.access(pdfPath);
    } catch {
      const outputFiles = await fs.readdir(outputDirectory);

      const pdfFile = outputFiles.find((name) =>
        name.toLowerCase().endsWith(".pdf"),
      );

      if (!pdfFile) {
        throw new Error("The PDF output was not created.");
      }

      pdfPath = path.join(outputDirectory, pdfFile);
    }

    const pdfBuffer = await fs.readFile(pdfPath);

    if (pdfBuffer.length === 0) {
      throw new Error("The generated PDF is empty.");
    }

    const responseBody = new Uint8Array(pdfBuffer);

    const outputFileName = `${safeBaseName}.pdf`;

    await removeDirectory(tempDirectory);
    tempDirectory = "";

    return new NextResponse(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",

        "Content-Disposition": `attachment; filename="${outputFileName}"`,

        "Content-Length": pdfBuffer.length.toString(),

        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Word to PDF error:", error);

    if (tempDirectory) {
      await removeDirectory(tempDirectory);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while converting the Word document.",
      },
      {
        status: 500,
      },
    );
  }
}

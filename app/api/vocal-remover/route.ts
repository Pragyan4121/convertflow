import Replicate from "replicate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac"];

const MODEL =
  "iboostai/demucs-api:d5de8c46b626a46ba6258f685454750c54197420435f9990846fd27a2e2dfa5f";

interface DemucsOutput {
  vocals?: string;
  no_vocals?: string;
}

function getExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function isSupportedFile(file: File) {
  return ALLOWED_EXTENSIONS.includes(getExtension(file.name));
}

export async function POST(request: Request) {
  try {
    const token = process.env.REPLICATE_API_TOKEN;

    if (!token) {
      return Response.json(
        {
          error: "Vocal removal service is not configured.",
        },
        {
          status: 503,
        },
      );
    }

    const formData = await request.formData();

    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return Response.json(
        {
          error: "Please upload an audio file.",
        },
        {
          status: 400,
        },
      );
    }

    if (audio.size === 0) {
      return Response.json(
        {
          error: "The uploaded audio file is empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (audio.size > MAX_FILE_SIZE) {
      return Response.json(
        {
          error: "The audio file must be smaller than 50 MB.",
        },
        {
          status: 413,
        },
      );
    }

    if (!isSupportedFile(audio)) {
      return Response.json(
        {
          error:
            "Unsupported audio format. Please use MP3, WAV, M4A, AAC, or FLAC.",
        },
        {
          status: 415,
        },
      );
    }

    const replicate = new Replicate({
      auth: token,
    });

    const output = (await replicate.run(MODEL, {
      input: {
        audio,
        model: "htdemucs_ft",
        stem: "vocals",
        shifts: 1,
      },
    })) as DemucsOutput;

    if (!output) {
      throw new Error("AI service returned no result.");
    }

    if (!output.no_vocals) {
      throw new Error("Instrumental audio was not returned by the AI service.");
    }

    return Response.json(
      {
        success: true,
        instrumentalUrl: output.no_vocals,
        vocalsUrl: output.vocals ?? null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Vocal remover API error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while processing the audio.";

    return Response.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}

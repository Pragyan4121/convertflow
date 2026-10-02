import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const PURPOSES = new Set([
  "professional",
  "linkedin",
  "cv",
  "passport",
  "formal",
  "studio",
]);

const OUTFITS: Record<string, string> = {
  unchanged: "Keep the existing outfit unchanged.",
  "black-suit":
    "Replace only the clothing with a realistic tailored black business suit and clean professional shirt.",
  "navy-suit":
    "Replace only the clothing with a realistic tailored navy business suit and clean professional shirt.",
  "charcoal-suit":
    "Replace only the clothing with a realistic tailored charcoal business suit and clean professional shirt.",
  "blazer-shirt":
    "Replace only the clothing with a professional blazer over a clean white shirt, no tie unless naturally appropriate.",
  "shirt-tie":
    "Replace only the clothing with a clean white professional shirt and tasteful business tie.",
  "business-casual":
    "Replace only the clothing with polished business-casual attire suitable for a professional profile photo.",
  "womens-suit":
    "Replace only the clothing with a realistic, modest women's professional business suit.",
  "womens-blazer":
    "Replace only the clothing with a realistic, modest professional blazer and appropriate business top.",
};

const BACKGROUNDS: Record<string, string> = {
  unchanged:
    "Keep the original background unchanged unless a tiny edge cleanup is required around the subject.",
  white:
    "Replace the background with a clean pure white seamless studio background.",
  "light-gray":
    "Replace the background with a soft light-gray seamless professional studio background.",
  "soft-blue":
    "Replace the background with a subtle soft-blue professional studio background.",
  "dark-gray":
    "Replace the background with an elegant dark-gray studio background with natural separation from the subject.",
  office:
    "Replace the background with a realistic modern professional office, clean and understated, without distracting text or logos.",
  "office-blur":
    "Replace the background with a realistic softly blurred corporate office, with natural depth of field and no readable branding.",
  "warm-studio":
    "Replace the background with a warm neutral studio backdrop, subtle and professional.",
};

const PURPOSE_INSTRUCTIONS: Record<string, string> = {
  professional:
    "Create a polished professional headshot suitable for a business profile. Keep natural realistic lighting and professional head-and-shoulders framing.",
  linkedin:
    "Create a polished professional LinkedIn-style headshot with centered head-and-shoulders framing and a confident, natural presentation.",
  cv: "Create a formal CV/resume portrait with clean professional lighting, neutral presentation, and head-and-shoulders framing.",
  passport:
    "Create a passport-style studio portrait with straightforward centered framing and a neutral uncluttered presentation. Do not claim or imply official compliance with any country-specific biometric standard.",
  formal:
    "Focus on a realistic professional clothing change while keeping the person's identity, pose, face, hair and photographic character unchanged.",
  studio:
    "Focus on creating a realistic professional studio portrait while keeping the person's identity, face, hair, outfit unless otherwise requested, and pose unchanged.",
};

function readString(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

function getOutputSize(width: number, height: number) {
  const ratio = width / Math.max(1, height);
  if (ratio > 1.15) return "1536x1024" as const;
  if (ratio < 0.87) return "1024x1536" as const;
  return "1024x1024" as const;
}

function buildPrompt(args: {
  purpose: string;
  outfit: string;
  background: string;
}) {
  const purposeInstruction = PURPOSE_INSTRUCTIONS[args.purpose];
  const outfitInstruction = OUTFITS[args.outfit];
  const backgroundInstruction = BACKGROUNDS[args.background];

  return `
Edit the supplied portrait photo into a photorealistic professional headshot.

HIGHEST PRIORITY — IDENTITY LOCK:
- Preserve the exact identity of the person in the input image.
- Do NOT redesign, reinterpret, beautify, idealize, age, de-age, reshape, or replace the face.
- Preserve facial structure, eyes, eyebrows, nose, lips, jawline, cheeks, ears, skin tone, facial hair, hairstyle, hairline, and expression as closely as possible to the original.
- Do not add makeup, skin smoothing, face slimming, eye enlargement, teeth changes, or cosmetic retouching.
- Keep the original head angle and pose unless a tiny framing adjustment is required.
- The finished image must clearly look like the same real person, not an AI recreation of a similar person.

PURPOSE:
${purposeInstruction}

OUTFIT:
${outfitInstruction}

BACKGROUND:
${backgroundInstruction}

PHOTOGRAPHIC RULES:
- Realistic professional photography, natural skin texture, realistic fabric, correct shoulders and neckline.
- Preserve body proportions and anatomy.
- Keep lighting natural and flattering without changing identity-defining facial details.
- No text, logos, watermarks, badges, frames, borders, or decorative graphics.
- Do not introduce jewelry or accessories unless already present and necessary to preserve the original appearance.
- Keep the composition appropriate for a professional headshot.
`;
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio is not configured yet. Add OPENAI_API_KEY to the server environment.",
        },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const image = formData.get("image");
    const purpose = readString(formData.get("purpose"));
    const outfit = readString(formData.get("outfit"));
    const background = readString(formData.get("background"));
    const quality = readString(formData.get("quality"));
    const targetWidth = Number(
      readString(formData.get("targetWidth")) || "1200",
    );
    const targetHeight = Number(
      readString(formData.get("targetHeight")) || "1500",
    );

    if (!(image instanceof File)) {
      return NextResponse.json(
        { error: "Upload a portrait image." },
        { status: 400 },
      );
    }

    if (!ALLOWED_IMAGE_TYPES.has(image.type)) {
      return NextResponse.json(
        { error: "Use a JPG, PNG or WebP image." },
        { status: 400 },
      );
    }

    if (image.size === 0 || image.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Use an image up to 15 MB." },
        { status: 400 },
      );
    }

    if (
      !PURPOSES.has(purpose) ||
      !OUTFITS[outfit] ||
      !BACKGROUNDS[background]
    ) {
      return NextResponse.json(
        { error: "One or more studio options are invalid." },
        { status: 400 },
      );
    }

    const width = Math.max(
      256,
      Math.min(3000, Math.round(targetWidth || 1200)),
    );
    const height = Math.max(
      256,
      Math.min(3000, Math.round(targetHeight || 1500)),
    );
    const outputSize = getOutputSize(width, height);

    const bytes = Buffer.from(await image.arrayBuffer());
    const upload = await toFile(bytes, image.name || "portrait.jpg", {
      type: image.type,
    });

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      maxRetries: 2,
      timeout: 110_000,
    });
    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";

    const response = await client.images.edit({
      model,
      image: upload,
      prompt: buildPrompt({ purpose, outfit, background }),
      size: outputSize,
      quality: quality === "premium" ? "high" : "medium",
      output_format: "jpeg",
      output_compression: quality === "premium" ? 96 : 90,
    });

    const encoded = response.data?.[0]?.b64_json;

    if (!encoded) {
      return NextResponse.json(
        { error: "The image service returned no photo. Please try again." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      image: `data:image/jpeg;base64,${encoded}`,
    });
  } catch (caught) {
    console.error("AI Photo Studio error:", caught);

    const error = caught as {
      code?: string;
      type?: string;
      status?: number;
      message?: string;
      error?: {
        code?: string;
        type?: string;
        message?: string;
      };
    };

    const errorCode = error.code ?? error.error?.code ?? "";

    const errorType = error.type ?? error.error?.type ?? "";

    const errorMessage = error.message ?? error.error?.message ?? "";

    const normalizedMessage = errorMessage.toLowerCase();

    /*
     * Content / moderation error
     */
    if (
      errorCode === "moderation_blocked" ||
      normalizedMessage.includes("moderation")
    ) {
      return NextResponse.json(
        {
          error:
            "This image or edit request could not be processed. Please try another portrait or studio option.",
        },
        { status: 400 },
      );
    }

    /*
     * API credit exhausted
     */
    if (
      errorCode === "credit_balance_exhausted" ||
      normalizedMessage.includes("credit balance") ||
      normalizedMessage.includes("billing quota")
    ) {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio has temporarily reached its available API credit. Please try again after the service credit is restored.",
        },
        { status: 503 },
      );
    }

    /*
     * Project hard spending limit
     */
    if (errorCode === "project_spend_limit_exceeded") {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio has temporarily reached its project usage limit. Please try again later.",
        },
        { status: 503 },
      );
    }

    /*
     * Organization spending limit
     */
    if (errorCode === "organization_spend_limit_exceeded") {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio has temporarily reached its service spending limit. Please try again later.",
        },
        { status: 503 },
      );
    }

    /*
     * Organization monthly usage allowance
     */
    if (errorCode === "organization_usage_limit_exceeded") {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio has temporarily reached its API usage allowance. Please try again later.",
        },
        { status: 503 },
      );
    }

    /*
     * Temporary rate limit.
     * The OpenAI SDK has already retried eligible temporary failures.
     */
    if (
      error.status === 429 ||
      errorCode === "slow_down" ||
      errorType === "rate_limit_error"
    ) {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio is receiving too many requests right now. Please wait a moment and try again.",
        },
        { status: 429 },
      );
    }

    /*
     * Temporary model overload
     */
    if (error.status === 503 || errorCode === "server_is_overloaded") {
      return NextResponse.json(
        {
          error:
            "The AI image service is temporarily busy. Please wait a moment and try again.",
        },
        { status: 503 },
      );
    }

    /*
     * API key / authentication problem
     */
    if (error.status === 401) {
      return NextResponse.json(
        {
          error: "AI Photo Studio is not configured correctly on the server.",
        },
        { status: 503 },
      );
    }

    /*
     * Other billing-related failures
     */
    if (
      error.status === 402 ||
      errorType === "insufficient_quota" ||
      normalizedMessage.includes("billing")
    ) {
      return NextResponse.json(
        {
          error:
            "AI Photo Studio currently has no available API usage allowance.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error:
          errorMessage && errorMessage.length < 240
            ? errorMessage
            : "The professional photo could not be generated. Please try again.",
      },
      { status: 500 },
    );
  }
}

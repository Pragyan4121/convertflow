import type { Metadata } from "next";
import { AiPhotoStudio } from "@/components/ai-photo-studio";

export const metadata: Metadata = {
  title: "AI Professional Photo Studio | ConvertFlow",
  description:
    "Create professional headshots, formal outfit photos, studio portraits, CV photos and LinkedIn-ready profile pictures while preserving your natural facial appearance.",
};

export default function AiPhotoStudioPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-7xl">
        <section className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-600">
            ConvertFlow AI Photo Tools
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
            AI Professional Photo Studio
          </h1>
          <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-gray-600 sm:text-base">
            Create a professional headshot, change clothing, replace the
            background and export the exact size you need while keeping your
            natural facial identity as the highest priority.
          </p>
        </section>

        <section className="mt-8 sm:mt-10">
          <AiPhotoStudio />
        </section>

        <section className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="font-semibold text-gray-900">
              Identity-first editing
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              The edit request explicitly prioritizes preservation of facial
              identity and natural appearance.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="font-semibold text-gray-900">Professional presets</p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Choose formal clothing, studio backgrounds, LinkedIn, CV and
              passport-style presentation.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="font-semibold text-gray-900">Exact output size</p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Download standard presets or define a custom pixel size for your
              final JPG.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

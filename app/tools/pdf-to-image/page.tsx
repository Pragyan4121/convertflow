import type { Metadata } from "next";
import { PdfToImageConverter } from "@/components/pdf-to-image-converter";

export const metadata: Metadata = {
  title: "PDF to Image Converter | ConvertFlow",
  description:
    "Convert PDF pages to high-quality JPG or PNG images online. Select pages, choose image quality, and download images without a watermark.",
};

export default function PdfToImagePage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-7xl">
        <section className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-600">
            ConvertFlow PDF Tools
          </p>

          <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
            PDF to Image Converter
          </h1>

          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-gray-600 sm:text-base">
            Turn PDF pages into JPG or PNG images, choose exactly which pages to
            convert, and download them individually or together as a ZIP file.
          </p>
        </section>

        <section className="mt-8 sm:mt-10">
          <PdfToImageConverter />
        </section>

        <section className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="font-semibold text-gray-900">Choose pages</p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Convert the whole PDF or select only the pages you need.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="font-semibold text-gray-900">JPG or PNG</p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Use JPG for smaller files or PNG when you prefer lossless output.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <p className="font-semibold text-gray-900">No watermark</p>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              ConvertFlow does not stamp branding onto your converted images.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

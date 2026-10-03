import type { Metadata } from "next";
import { PdfEditor } from "@/components/pdf-editor";

export const metadata: Metadata = {
  title: "Edit PDF Online | ConvertFlow",
  description:
    "Edit PDF text, add text, images, signatures, highlights, whiteout and drawings, reorder pages, and export the edited PDF directly in your browser.",
};

export default function EditPdfPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-[1500px]">
        <section className="text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-600">
            ConvertFlow PDF Tools
          </p>

          <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
            Edit PDF
          </h1>

          <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-gray-600 sm:text-base">
            Edit existing PDF text, add new content, sign, highlight, draw,
            manage pages and save the result without rebuilding your document
            from scratch.
          </p>
        </section>

        <section className="mt-8 sm:mt-10">
          <PdfEditor />
        </section>
      </div>
    </main>
  );
}

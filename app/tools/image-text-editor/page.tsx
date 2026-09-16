import { ImageTextEditor } from "@/components/image-text-editor";

export const metadata = {
  title: "Image Text Editor - ConvertFlow",
  description:
    "Select areas in images, extract text with OCR, blur, pixelate, cover, add text, crop and export images online.",
};

export default function ImageTextEditorPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-950 sm:text-4xl">
            Image Text Editor
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-gray-600">
            Select any part of an image, extract text, blur or pixelate
            sensitive areas, cover old text, add new text, crop and export.
          </p>
        </div>

        <div className="mt-10">
          <ImageTextEditor />
        </div>
      </div>
    </main>
  );
}

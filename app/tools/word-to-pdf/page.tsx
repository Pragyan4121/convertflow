import { WordToPdf } from "@/components/word-to-pdf";

export default function WordToPdfPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">Word to PDF</h1>

          <p className="mt-4 text-gray-600">
            Convert DOCX files to high-quality PDF while preserving your
            document layout and formatting as closely as possible.
          </p>
        </div>

        <div className="mt-10">
          <WordToPdf />
        </div>
      </div>
    </main>
  );
}

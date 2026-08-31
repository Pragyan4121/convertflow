import { PdfToWord } from "@/components/pdf-to-word";

export default function PdfToWordPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">
            PDF to Word
          </h1>

          <p className="mt-4 text-gray-600">
            Convert text-based PDF files into editable Word documents quickly
            and securely.
          </p>
        </div>

        <div className="mt-10">
          <PdfToWord />
        </div>
      </div>
    </main>
  );
}
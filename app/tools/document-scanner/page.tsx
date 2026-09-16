import { DocumentScanner } from "@/components/document-scanner";

export const metadata = {
  title: "Document Scanner - ConvertFlow",
  description:
    "Scan multiple documents or photos, enhance individual pages, and save them as PDF or images.",
};

export default function DocumentScannerPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-950 sm:text-4xl">
            Document Scanner
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-gray-600">
            Scan multiple documents or photos, enhance individual pages, and
            save them as PDF or images.
          </p>
        </div>

        <div className="mt-10">
          <DocumentScanner />
        </div>
      </div>
    </main>
  );
}

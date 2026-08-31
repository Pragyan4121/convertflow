import { WordMerger } from "@/components/word-merger";

export default function MergeWordPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">
            Merge Word Documents
          </h1>

          <p className="mt-4 text-gray-600">
            Combine multiple DOCX files into one Word document in the order you
            choose.
          </p>
        </div>

        <div className="mt-10">
          <WordMerger />
        </div>
      </div>
    </main>
  );
}

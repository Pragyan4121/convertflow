import { FileUploader } from "@/components/file-uploader";

export default function MergePdfPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">Merge PDF</h1>

          <p className="mt-4 text-gray-600">
            Upload multiple PDF files, arrange them in the order you want, and
            prepare them for merging.
          </p>
        </div>

        <div className="mt-10">
          <FileUploader multiple accept=".pdf,application/pdf" maxFiles={20} />
        </div>
      </div>
    </main>
  );
}

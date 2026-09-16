import { VocalRemover } from "@/components/vocal-remover";

export default function VocalRemoverPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">Vocal Remover</h1>

          <p className="mt-4 text-gray-600">
            Remove vocals from your song and create an instrumental version
            using AI.
          </p>
        </div>

        <div className="mt-10">
          <VocalRemover />
        </div>
      </div>
    </main>
  );
}

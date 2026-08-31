import { BackgroundRemover } from "@/components/background-remover";

export default function RemoveBackgroundPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">
            Remove Background
          </h1>

          <p className="mt-4 text-gray-600">
            Remove image backgrounds automatically and download a transparent
            PNG in seconds.
          </p>
        </div>

        <div className="mt-10">
          <BackgroundRemover />
        </div>
      </div>
    </main>
  );
}

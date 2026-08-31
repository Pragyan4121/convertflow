import { ImageCompressor } from "@/components/image-compressor";

export default function ReduceImageSizePage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">
            Reduce Image Size
          </h1>

          <p className="mt-4 text-gray-600">
            Compress JPG, PNG and WebP images directly in your browser.
          </p>
        </div>

        <div className="mt-10">
          <ImageCompressor />
        </div>
      </div>
    </main>
  );
}

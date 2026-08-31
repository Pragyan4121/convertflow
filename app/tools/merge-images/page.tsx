import { ImageMerger } from "@/components/image-merger";

export default function MergeImagesPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-950">Merge Images</h1>

          <p className="mt-4 text-gray-600">
            Combine multiple JPG, PNG or WebP images vertically or horizontally
            directly in your browser.
          </p>
        </div>

        <div className="mt-10">
          <ImageMerger />
        </div>
      </div>
    </main>
  );
}

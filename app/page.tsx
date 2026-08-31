import { siteConfig } from "@/config/site";
import { tools } from "@/config/tools";
import { ToolCard } from "@/components/tool-card";
export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="text-xl font-bold text-gray-950">
            {siteConfig.name}
          </div>

          <nav className="hidden items-center gap-8 md:flex">
            {siteConfig.navigation.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="text-sm font-medium text-gray-600 transition hover:text-gray-950"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <section className="mx-auto flex max-w-7xl flex-col items-center px-6 py-24 text-center sm:py-32">
        <p className="mb-4 text-sm font-semibold text-blue-600">
          By {siteConfig.company}
        </p>

        <h1 className="max-w-4xl text-5xl font-bold tracking-tight text-gray-950 sm:text-6xl">
          Convert files quickly, securely, and simply.
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600">
          {siteConfig.description}
        </p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <a
            href="#tools"
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Explore Tools
          </a>

          <a
            href="#about"
            className="rounded-xl border border-gray-300 px-6 py-3 font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            Learn More
          </a>
        </div>
      </section>

      <section
        id="tools"
        className="border-t border-gray-100 bg-gray-50 px-6 py-20"
      >
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h2 className="text-3xl font-bold text-gray-950">
              Everyday file tools
            </h2>

            <p className="mt-3 text-gray-600">
              Fast, focused tools for common file tasks.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      </section>
      <section id="about" className="px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold text-gray-950">Simple by design</h2>

          <p className="mt-4 text-gray-600">
            {siteConfig.name} is designed around fast processing, clear
            workflows, and a clean interface without unnecessary complexity.
          </p>
        </div>
      </section>
    </main>
  );
}

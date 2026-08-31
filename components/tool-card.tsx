import type { ToolDefinition } from "@/config/tools";

type ToolCardProps = {
  tool: ToolDefinition;
};

export function ToolCard({ tool }: ToolCardProps) {
  const isActive = tool.status === "active";

  return (
    <a
      href={isActive ? tool.href : undefined}
      aria-disabled={!isActive}
      className={[
        "group rounded-2xl border border-gray-200 bg-white p-6",
        "transition duration-200",
        isActive
          ? "hover:-translate-y-1 hover:border-blue-200 hover:shadow-lg"
          : "cursor-default opacity-75",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-lg font-semibold text-gray-950">{tool.name}</h3>

        {!isActive && (
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
            Coming soon
          </span>
        )}
      </div>

      <p className="mt-3 text-sm leading-6 text-gray-600">{tool.description}</p>
    </a>
  );
}

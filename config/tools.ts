export type ToolCategory = "document" | "pdf" | "image" | "utility";

export type ToolDefinition = {
  id: string;
  name: string;
  description: string;
  href: string;
  category: ToolCategory;
  status: "active" | "coming-soon";
};

export const tools: ToolDefinition[] = [
  {
    id: "word-to-pdf",
    name: "Word to PDF",
    description: "Convert Word documents into PDF files.",
    href: "/tools/word-to-pdf",
    category: "document",
    status: "active",
  },
  {
    id: "pdf-to-word",
    name: "PDF to Word",
    description: "Convert PDF files into editable Word documents.",
    href: "/tools/pdf-to-word",
    category: "pdf",
    status: "active",
  },
  {
    id: "merge-pdf",
    name: "Merge PDF",
    description: "Reorder and combine multiple PDF files into one.",
    href: "/tools/merge-pdf",
    category: "pdf",
    status: "active",
  },
  {
    id: "merge-word",
    name: "Merge Word",
    description: "Reorder and combine multiple Word documents.",
    href: "/tools/merge-word",
    category: "document",
    status: "active",
  },
  {
    id: "compress-image",
    name: "Reduce Image Size",
    description: "Reduce image file size while preserving useful quality.",
    href: "/tools/reduce-image-size",
    category: "image",
    status: "active",
  },
  {
    id: "merge-images",
    name: "Merge Images",
    description: "Combine images vertically or horizontally.",
    href: "/tools/merge-images",
    category: "image",
    status: "active",
  },
];

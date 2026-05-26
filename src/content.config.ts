import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const baseContentSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  order: z.number().default(999),
  category: z.string().default("General"),
  legacyPath: z.string().optional(),
  source: z.string().default("migrated"),
  tags: z.array(z.string()).default([]),
  maintainers: z.array(z.string()).default([]),
  ownerIds: z.array(z.number()).default([]),
  maintainerUsernames: z.array(z.string()).default([]),
  updatedAt: z.coerce.date().optional()
});

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: baseContentSchema.extend({
    date: z.coerce.date()
  })
});

const docs = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/docs" }),
  schema: baseContentSchema
});

export const collections = { blog, docs };

import mdx from "@astrojs/mdx";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://placeholder.example.com",
  integrations: [mdx()],
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      },
      defaultColor: false,
      wrap: true
    }
  },
  output: "static"
});

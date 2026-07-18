import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: {
    // De widget-UI importeert over de package-grens heen uit de repo-root:
    // de engine (../src/widget/engine) en tenant-config (../tenants).
    fs: { allow: [".."] },
  },
});

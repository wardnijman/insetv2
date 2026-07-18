import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Zelfde preprocess als v1: esbuild stript de volledige TS-syntax uit de
// <script>-blokken (o.a. optionele parameters), wat svelte's ingebouwde
// TS-parser niet overal dekt.
export default {
  preprocess: vitePreprocess(),
};

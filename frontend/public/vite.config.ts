// vite.config.js
import { resolve } from "path";
import { defineConfig } from "vite";
import ConditionalCompile from "vite-plugin-conditional-compiler";

// import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [ConditionalCompile()],
  assetsInclude: ['**/*.fbx', '**/*.urdf', '**/*.stl', '**/*.usd', '**/*.usda', '**/*.usdc', '**/*.usdz', '**/*.csv', '**/*.hdr'],
  publicDir: false, // Disable default public dir behavior since we're in public already
  // plugins: [wasm(), topLevelAwait()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
      // output: {
      //   entryFileNames: `assets/[name].js`,
      //   chunkFileNames: `assets/[name].js`,
      //   assetFileNames: `assets/[name].[ext]`
      // }
    },  
  },
  server: {
    // port: 8000,
    // host: true
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin"
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
        // rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  
});

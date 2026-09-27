import fs from "fs"
import path from "path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, type Plugin } from "vite"

// three.js decoders for uploaded site models (P5-02): Draco meshes and KTX2 (Basis) textures.
// Served at /decoders/… in development and copied into the build, so nothing loads from a
// third-party CDN.
const DECODERS: Record<string, string> = { draco: "three/examples/jsm/libs/draco/gltf", basis: "three/examples/jsm/libs/basis" }
const decoderDir = (lib: string) => path.resolve(import.meta.dirname, "node_modules", DECODERS[lib])

function threeDecoders(): Plugin {
  return {
    name: "three-decoders",
    configureServer(server) {
      server.middlewares.use("/decoders", (req, res, next) => {
        const [, lib, file] = /^\/(draco|basis)\/([\w.-]+\.(?:js|wasm))$/.exec(req.url?.split("?")[0] ?? "") ?? []
        const full = lib ? path.join(decoderDir(lib), file) : ""
        if (!full || !fs.existsSync(full)) return next()
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript")
        fs.createReadStream(full).pipe(res)
      })
    },
    generateBundle() {
      for (const lib of Object.keys(DECODERS))
        for (const file of fs.readdirSync(decoderDir(lib)).filter((f) => /\.(js|wasm)$/.test(f) && !f.includes("encoder")))
          this.emitFile({ type: "asset", fileName: `decoders/${lib}/${file}`, source: fs.readFileSync(path.join(decoderDir(lib), file)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), threeDecoders()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://api:3000',
        changeOrigin: true,
      },
      // Processed 3D models (P5-02): object storage, standing in for the CDN in development.
      '/cdn': {
        target: process.env.CDN_PROXY_TARGET || 'http://objects:9000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/cdn/, '/ecomanage-assets'),
      },
    },
    allowedHosts: [
      'localhost',
      // compose service name, used by containers such as the E2E runner
      'web',
      '.pythagora.ai'
    ],
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/public/**', '**/log/**']
    }
  },
})

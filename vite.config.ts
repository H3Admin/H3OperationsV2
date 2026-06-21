import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    // Vite auto-enables this when it detects an AI coding agent. Combined with
    // TanStack Start's SSR console replay (server warnings echoed to the browser
    // console), it creates a client<->server console feedback loop that amplifies
    // any single warning into an unbounded, exponentially growing log.
    forwardConsole: false,
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
})

export default config

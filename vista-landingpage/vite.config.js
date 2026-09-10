import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    // 5173 belongs to vista-dashboard, which pins it. Without this both apps
    // race for the same port and whichever starts second silently moves,
    // breaking the VITE_VISTA_URL default that points the LOGIN button at 5173.
    port: 5174,
  },
})
import { join, resolve } from 'path'
import { defineConfig, Plugin } from 'vite'
import { mkdir, readdir, stat, copyFile } from 'fs/promises'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        background: 'src/scripts/background.ts',
        content: 'src/scripts/content.ts',
        model: 'src/scripts/model.ts',
        popup: 'src/scripts/popup.ts',
        prompt: 'src/scripts/prompt.ts',
        render: 'src/scripts/render.ts',
        report: 'src/scripts/report.ts',
        settings: 'src/scripts/settings.ts',
        'user-input': 'src/scripts/user-input.ts',
        utils: 'src/scripts/utils.ts'
      },
      output: {
        dir: 'dist',
        entryFileNames: '[name].js',
        format: 'es'
      }
    },
    minify: process.env.NODE_ENV === 'production',
    sourcemap: process.env.NODE_ENV !== 'production'
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  plugins: [
    copyFilesPlugin({
      from: resolve(__dirname, 'src/scripts/tesseract'),
      to: resolve(__dirname, 'dist')
    }),
    copyFilesPlugin({
      from: resolve(__dirname, 'src/assets'),
      to: resolve(__dirname, 'dist/assets')
    }),
    copyFilesPlugin({
      from: resolve(__dirname, 'src/pages'),
      to: resolve(__dirname, 'dist/pages')
    }),
    copyFilesPlugin({
      from: resolve(__dirname, './LICENSE'),
      to: resolve(__dirname, 'dist/LICENSE')
    }),
    copyFilesPlugin({
      from: resolve(__dirname, './README.md'),
      to: resolve(__dirname, 'dist/README.md')
    })
  ]
})

async function copyFilesRecursively(src: string, dest: string) {
  const srcStat = await stat(src)

  if (srcStat.isDirectory()) {
    const entries = await readdir(src, { withFileTypes: true })
    await mkdir(dest, { recursive: true })

    for (const entry of entries) {
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)

      if (entry.isDirectory()) {
        await copyFilesRecursively(srcPath, destPath)
      } else {
        await copyFile(srcPath, destPath)
      }
    }
  } else {
    await mkdir(join(dest, '..'), { recursive: true })
    await copyFile(src, dest)
  }
}

function copyFilesPlugin(options: { from: string; to: string }): Plugin {
  return {
    name: 'copy-files-async',
    async writeBundle() {
      try {
        await copyFilesRecursively(options.from, options.to)
      } catch (error) {
        console.error('Failed to copy files:', error instanceof Error ? error.message : error)
        throw error
      }
    }
  }
}

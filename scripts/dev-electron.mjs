// Runs the Vite dev server and opens the app in Electron with hot reload.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { execSync } from 'node:child_process'
execSync('node scripts/build-electron.mjs', { stdio: 'inherit' })
const server = await createServer()
await server.listen()
const url = server.resolvedUrls.local[0]
const electron = (await import('electron')).default
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } })
child.on('exit', () => { server.close(); process.exit(0) })

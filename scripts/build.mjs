// Builds the project from the top folder: `npm run build`.
// Each part's dependencies are installed first if they are missing, so this works on a fresh checkout
// (for example on Cloudflare's build machines). On Cloudflare only the website (client/) is needed; the API
// (server/) is built and hosted separately.
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const run = (command) => execSync(command, { stdio: 'inherit' })

function build(part) {
  if (!existsSync(`${part}/node_modules`)) run(`npm --prefix ${part} ci --include=dev`)
  run(`npm --prefix ${part} run build`)
}

const onCloudflare = Boolean(process.env.WORKERS_CI || process.env.CF_PAGES)
if (!onCloudflare) build('server')
build('client')

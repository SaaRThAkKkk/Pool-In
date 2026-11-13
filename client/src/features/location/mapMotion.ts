import L from 'leaflet'

const FADE_MS = 250
const MAX_WAIT_MS = 2500

// Hides the map, moves it in one step, and shows it again when the tiles for the new view are ready (or after a
// short wait, so a slow connection never leaves it hidden). Returns a function that cancels a jump in progress.
// The fade itself is CSS: see .live-map / .map-hidden in index.css.
export function fadeJump(map: L.Map, target: [number, number], zoom: number): () => void {
  const container = map.getContainer()
  let done = false
  const timers: ReturnType<typeof setTimeout>[] = []
  const tiles: L.TileLayer[] = []
  map.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) tiles.push(layer)
  })

  const show = () => {
    if (done) return
    done = true
    tiles.forEach((t) => t.off('load', show))
    container.classList.remove('map-hidden')
  }

  container.classList.add('map-hidden')
  timers.push(
    setTimeout(() => {
      map.setView(target, zoom, { animate: false })
      tiles.forEach((t) => t.once('load', show))
      timers.push(setTimeout(show, MAX_WAIT_MS))
    }, FADE_MS),
  )

  return () => {
    timers.forEach(clearTimeout)
    show()
  }
}

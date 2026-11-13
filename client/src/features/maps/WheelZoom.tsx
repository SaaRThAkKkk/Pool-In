import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

// Scrolling over the map zooms it, once the map has been clicked. Until then, scrolling moves the page as
// usual: these maps sit in pages that scroll, and a map that grabs every scroll makes it hard to get past it.
// Moving the pointer off the map hands scrolling back to the page. The hint text is CSS (see .wheel-zoom in
// index.css).
export function WheelZoom() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    container.classList.add('wheel-zoom')

    const on = () => {
      map.scrollWheelZoom.enable()
      container.classList.add('wheel-zoom-on')
    }
    const off = () => {
      map.scrollWheelZoom.disable()
      container.classList.remove('wheel-zoom-on')
    }

    off()
    map.on('click', on)
    map.on('mouseout', off)
    return () => {
      map.off('click', on)
      map.off('mouseout', off)
      container.classList.remove('wheel-zoom', 'wheel-zoom-on')
    }
  }, [map])

  return null
}

import WrappableText from '..'

const canvas = document.querySelector('canvas')
const ctx = canvas.getContext('2d')

render()
window.addEventListener('resize', () => requestAnimationFrame(render))

function render () {
  const margin = 50
  const dpi = window.devicePixelRatio || 1
  canvas.style.setProperty('--margin', margin + 'px')
  canvas.width = (window.innerWidth - margin * 4) * dpi
  canvas.height = (window.innerHeight - margin * 4) * dpi
  canvas.style.width = (canvas.width / dpi) + 'px'
  canvas.style.height = (canvas.height / dpi) + 'px'

  const fontSize = (canvas.height / dpi) * 0.1

  ctx.font = `${fontSize}px "Helvetica"`
  ctx.strokeStyle = '#9a1fff'
  ctx.scale(dpi, dpi)

  const text = new WrappableText(`Hello world&nbsp;! Jean-François.<br><br>Psycho&shy;logie<br>Wrappable&ZeroWidthSpace;Text`, {
    br: /<br\/?>/,
    nbsp: /&nbsp;/,
    shy: /&shy;/,
    zwsp: /&ZeroWidthSpace;/,
    measure: string => {
      ctx.font = `${fontSize}px "Helvetica"`
      return ctx.measureText(string).width
    }
  })

  // Wrap text to canvas width
  const { lines, overflow } = text.wrap(canvas.width / dpi)
  console.log(text, { lines, overflow })

  // Render lines
  ctx.fillStyle = overflow ? 'rgb(255, 75, 78)' : 'black'
  lines.forEach((line, index) => {
    const baseline = (index + 1) * fontSize

    ctx.beginPath()
    ctx.moveTo(0, baseline)
    ctx.lineTo(line.width, baseline)
    ctx.stroke()

    ctx.fillText(line.value, 0, baseline)
  })
}

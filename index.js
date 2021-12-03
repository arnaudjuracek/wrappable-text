import LineBreaker from '@craigmorton/linebreak'

const BR = '\u000A'
const NBSP = '\u00A0'
const SHY = '\u00AD'

function monospace (string) { return string.length }
function getBreaks (string) {
  const breaker = new LineBreaker(string)
  const breaks = {}

  while (true) {
    const br = breaker.nextBreak()
    if (!br) break
    breaks[br.position] = br
  }

  return breaks
}

export default class WrappableText {
  constructor (value, {
    measure = monospace,
    br = BR,
    nbsp = NBSP,
    shy = SHY
  } = {}) {
    this.measure = measure
    this.entities = { br, nbsp, shy }
    this.value = value
      .replace(new RegExp(this.entities.br, 'g'), BR)
      .replace(new RegExp(this.entities.nbsp, 'g'), NBSP)
      .replace(new RegExp(this.entities.shy, 'g'), SHY)
  }

  get isEmpty () {
    return !this.value
      .replace(/\s/g, '')
      .replace(new RegExp(BR, 'g'), '')
      .replace(new RegExp(NBSP, 'g'), '')
      .replace(new RegExp(SHY, 'g'), '')
  }

  wrap (width = Number.POSITIVE_INFINITY) {
    const lines = []
    const breaks = getBreaks(this.value)

    let start = 0
    while (start < this.value.length) {
      let curr = start
      let lineWidth = 0
      while (curr < this.value.length) {
        // Handle required breaks
        if (breaks[curr] && breaks[curr].required && !breaks[curr].consumed) {
          breaks[curr].consumed = true
          curr--
          break
        }

        // Build the line
        lineWidth += this.measure(this.value.charAt(curr))

        // When the line starts overflowing, find the nearest break before the
        // cursor, break there and restart from this position
        if (lineWidth >= width) {
          const br = Object.values(breaks)
            .reverse()
            .find(({ position, consumed }) => !consumed && curr > position)

          if (br) {
            br.consumed = true
            curr = br.position
            break
          }
        }

        // Advance one char
        curr++
      }

      // Get the line value
      let value = this.value.substring(start, curr).trim()

      // Handle shy
      if (this.value.charAt(curr - 1) === SHY) value += '-'
      value = value.replace(SHY, '')

      lines.push({ value, width: this.measure(value) })
      start = curr
    }

    return {
      lines,
      overflow: !!lines.find(line => line.width > width)
    }
  }

  nowrap (width = Number.POSITIVE_INFINITY) {
    const value = this.value
      .replace(new RegExp(BR, 'g'), '')
      .replace(new RegExp(NBSP, 'g'), '')
      .replace(new RegExp(SHY, 'g'), '')
    const lineWidth = this.measure(value)

    // We use the same object structure as WrappableText.wrap() so that both
    // methods can be used interchangeably
    return {
      lines: [{ value, width: lineWidth }],
      overflow: lineWidth > width
    }
  }
}

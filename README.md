# `wrappable-text`
> Renderer-agnostic wrappable text following the Unicode Line Breaking Algorithm

## Installation

```sh
npm install --save wrappable-text
```

## Usage

```js
import WrappableText from 'wrappable-text'

const text = new WrappableText('lorem ipsum…', {
  // Define a function returning the width of a string in your renderer implementation
  measure: string => string.length // default: monospace font
})

const width = 80
const { lines, overflow } = text.wrap(width)

for (const line of lines) {
  console.log(line.value)
}

```

<sup>See [`example/`](example) for a HTML5 Canvas implementation with a non-monospace font.</sup>


### Special characters

There are several special characters influencing the line-breaking algorithm. `WrappableText` constructor accepts a `RegExp` or `string` to re-define each one:

```js
const text = new WrappableText('Lorem ipsum…', {
  br: /<br\/?>/,  // default: '\u000A'
  shy: '&shy;',   // default: '\u00AD'
  nbsp: '&nbsp;', // default: '\u00A0'
  zwsp: /&(ZeroWidthSpace|#8203|#x200B|NegativeVeryThinSpace);/, // default: '\u200B'
})
```

### Helpers

```js
const visuallyEmpty = new WrappableText('<br><br><br>', { br: /<br\/?>/ })
console.log(visuallyEmpty.isEmpty) // true

const longLine = new WrappableText('Lorem ipsum…')
const result = longLine.nowrap(80)
// `result` will have the same structure as WrappableText.wrap return object,
// but with the `result.lines` array containing always only one line.
```

### Caching measures

To keep it simple, `wrappable-text` does not cache string measures, and let this optimization at the discretion of the `measure` function:

```js
const cache = new Map()

for (let fontSize = 10; fontSize < 100; fontSize += 10) {
  const text = new WrappableText('…', {
    measure: string => {
      const K = fontSize + '_' + string
      if (cache.has(K)) return cache.get(K)

      const width = measure(string, fontSize)
      cache.set(K, width)
      return width
    }
  })

  render(text, fontSize)
}

```

## Development

```sh
$ npm install             # install all npm dependencies
$ npm run example:serve   # start the dev server with livereload on the example folder
$ npm run example:deploy  # deploy your example folder on a gh-page branch
$ npm version [major|minor|patch]
```

## Acknowledgement

This module is based on [@craigmorton’s fork](https://github.com/craigmorton/linebreak) of [`linebreak`](https://github.com/foliojs/linebreak), and inspired by [`mattdesl/word-wrapper`](https://github.com/mattdesl/word-wrapper)


## License
[MIT.](https://tldrlegal.com/license/mit-license)

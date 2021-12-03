import test from 'ava'
import WrappableText from './'

const htmlEntities = {
  br: /<br\/?>/,
  nbsp: '&nbsp;',
  shy: '&shy;',
  zwsp: '&ZeroWidthSpace;'
}

const wt = string => new WrappableText(string, htmlEntities)

test('WrappableText correctly handles empty text', t => {
  t.is(wt('').isEmpty, true)
  t.is(wt(' ').isEmpty, true)
  t.is(wt('  ').isEmpty, true)
  t.is(wt('<br>').isEmpty, true)
  t.is(wt('<br><br>').isEmpty, true)
  t.is(wt('&nbsp;').isEmpty, true)
  t.is(wt('&nbsp;&nbsp;').isEmpty, true)
  t.is(wt('&shy;').isEmpty, true)
  t.is(wt('<br> <br>').isEmpty, true)
  t.is(wt('<br><br><br>').isEmpty, true)
  t.is(wt('<br>&nbsp;<br>').isEmpty, true)
  t.is(wt('<br>&shy;<br>').isEmpty, true)
  t.is(wt('hello').isEmpty, false)
})

test('WrappableText correctly wrap lines', t => {
  t.is(wt('first second third').wrap().lines.length, 1)
  t.is(wt('first second third').wrap(19).lines.length, 1)
  t.is(wt('first second third').wrap(15).lines.length, 2)
  t.is(wt('first second third').wrap(1).lines.length, 3)
  t.is(wt('first&nbsp;second third').wrap(1).lines.length, 2)
  t.is(wt('first<br>second third').wrap().lines.length, 2)
})

test('WrappableText correctly nowrap lines', t => {
  t.is(wt('first second third').nowrap().lines.length, 1)
  t.is(wt('first second third').nowrap(1).lines.length, 1)
  t.is(wt('first<br>second third').nowrap().lines.length, 1)
  t.is(wt('first<br>second third').nowrap(1).lines.length, 1)
})

test('WrappableText correctly handles nbsp', t => {
  t.is(wt('Hello&nbsp;world').wrap().lines.length, 1)
  t.is(wt('Hello&nbsp;world').wrap(1).lines.length, 1)
  t.is(wt('Hello&nbsp;world').nowrap(1).lines.length, 1)
  t.is(wt('Hello&nbsp;world').nowrap().lines[0].value.includes('\u00A0'), false)
})

test('WrappableText correctly handles shy', t => {
  t.is(wt('psycho&shy;logie').wrap().lines.length, 1)
  t.is(wt('psycho&shy;logie').wrap(1).lines.length, 2)
  t.is(wt('psycho&shy;logie').wrap(1).lines[0].value.endsWith('-'), true)
  t.is(wt('psycho&shy;logie').wrap(1).lines[1].value.startsWith('-'), false)
  t.is(wt('psycho&shy;logie').nowrap().lines[0].value.includes('\u00AD'), false)
})

test('WrappableText correctly handles zero-width space', t => {
  t.is(wt('psycho&ZeroWidthSpace;logie').wrap().lines.length, 1)
  t.is(wt('psycho&ZeroWidthSpace;logie').wrap(1).lines.length, 2)
  t.is(wt('psycho&ZeroWidthSpace;logie').nowrap().lines[0].value.includes('\u200B'), false)
})

test('WrappableText correctly detect overflows', t => {
  t.is(wt('0123456789').wrap().overflow, false)
  t.is(wt('0123456789').nowrap().overflow, false)
  t.is(wt('0123456789').wrap(5).overflow, true)
  t.is(wt('0123456789').nowrap(5).overflow, true)
  t.is(wt('0123456789 0123456789').wrap(10).overflow, false)
  t.is(wt('0123456789 0123456789').nowrap(10).overflow, true)
})

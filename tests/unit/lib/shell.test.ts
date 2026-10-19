import { formatCommand, shQuote } from '@/lib/shell'

describe('Copy CLI quoting', () => {
  it('leaves safe args alone and quotes the rest', () => {
    expect(shQuote('/usr/bin/trustabl')).toBe('/usr/bin/trustabl')
    expect(shQuote('my repo')).toBe("'my repo'")
    expect(shQuote("it's")).toBe(`'it'"'"'s'`)
    expect(shQuote('')).toBe("''")
  })
  it('formats cwd and stdin', () => {
    expect(formatCommand({ bin: 'autofix', args: ['fix', '--class', '/a b/c.yaml'], cwd: '/tmp', stdin: 'q\n' })).toBe(
      "cd /tmp && printf '%s\\n' q | autofix fix --class '/a b/c.yaml'",
    )
  })
})

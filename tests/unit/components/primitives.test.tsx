// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { Conf, Kpi, Pill, SevRow, Spark, Unavailable } from '@/components/console/primitives'
import { CopyCli } from '@/components/console/CopyCli'
import { AccRow, Chips } from '@/components/console/table'
import { ToastProvider } from '@/components/ui/ToastContext'

describe('severity row', () => {
  it('labels each count for screen readers', () => {
    render(<SevRow counts={{ critical: 1, high: 2, medium: 3, low: 4 }} />)
    expect(screen.getByLabelText('Critical: 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Low: 4')).toHaveTextContent('4')
  })
})

describe('pill / conf / spark / kpi', () => {
  it('renders a pill with its text', () => {
    render(<Pill tone="success">86</Pill>)
    expect(screen.getByText('86')).toBeInTheDocument()
  })
  it('shows confidence as .xx', () => {
    render(<Conf value={0.92} />)
    expect(screen.getByTitle('Confidence 0.92')).toHaveTextContent('.92')
  })
  it('describes the spark bars', () => {
    render(<Spark values={[12, 9, 3]} />)
    expect(screen.getByRole('img', { name: 'Open findings per scan: 12, 9, 3' })).toBeInTheDocument()
  })
  it('shows a loading kpi without the value', () => {
    render(<Kpi label="Open" value={22} loading />)
    expect(screen.queryByText('22')).not.toBeInTheDocument()
  })
  it('marks unavailable fields', () => {
    render(<Unavailable what="agent ID" />)
    expect(screen.getByText('agent ID n/a')).toHaveAttribute('title', 'agent ID: not reported by the pinned CLIs')
  })
})

describe('Copy CLI', () => {
  it('copies the exact command and confirms with a toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ToastProvider><CopyCli command="trustabl scan /repo" /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: /Copy CLI/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('trustabl scan /repo'))
    expect(await screen.findByText('Command copied to clipboard')).toBeInTheDocument()
  })
  it('is disabled with no command', () => {
    render(<ToastProvider><CopyCli command={null} /></ToastProvider>)
    expect(screen.getByRole('button', { name: /Copy CLI/ })).toBeDisabled()
  })
})

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <table><tbody>
      <AccRow id="x" open={open} onToggle={() => setOpen(!open)} colSpan={2} cells={[<td key="a">row</td>]} detail={<p>details here</p>} />
    </tbody></table>
  )
}

describe('accordion row', () => {
  it('expands from its button and reports aria-expanded', () => {
    render(<Harness />)
    const btn = screen.getByRole('button', { name: 'Expand row' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(screen.getByText('details here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse row' })).toHaveAttribute('aria-expanded', 'true')
  })
  it('expands when the row is clicked', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('row'))
    expect(screen.getByText('details here')).toBeInTheDocument()
  })
})

describe('status chips', () => {
  it('is a radio group with counts', () => {
    const onChange = vi.fn()
    render(<Chips label="Status" value="open" onChange={onChange} options={[{ value: 'open', label: 'Open', count: 3 }, { value: 'all', label: 'All', count: 5 }]} />)
    expect(screen.getByRole('radio', { name: 'Open (3)' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'All (5)' }))
    expect(onChange).toHaveBeenCalledWith('all')
  })
})

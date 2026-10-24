import { RevealCard } from '../../components/RevealCard'
import { STATUS_INFO, type SafetyItem } from './safetyContent'

interface Props {
  item: SafetyItem
  /** Opened by a tap or Enter (hover and keyboard focus reveal it too). */
  open: boolean
  onToggle: () => void
  onClose: () => void
}

// A safety point as a hover-to-reveal square card (see RevealCard).
export function SafetyCard({ item, open, onToggle, onClose }: Props) {
  const status = STATUS_INFO[item.status]
  return (
    <RevealCard
      testId={`safety-card-${item.id}`}
      title={item.title}
      summary={item.summary}
      details={item.details}
      icon={item.icon}
      chip={{ label: status.label, className: status.chip }}
      open={open}
      onToggle={onToggle}
      onClose={onClose}
    />
  )
}

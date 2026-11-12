import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, MessageCircle } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { CONVERSATIONS_KEY, startChat, type StartChatInput } from './chatApi'

// "Message" on a match. The server checks the trips really match, opens the chat (or finds the one that already
// exists), and the person lands in it.
export function StartChatButton({ label, input }: { label: string; input: StartChatInput }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const start = useMutation({
    mutationFn: () => startChat(input),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
      navigate(`/chat/${conversation.id}`)
    },
  })

  return (
    <div className="mt-3">
      <button type="button" onClick={() => start.mutate()} disabled={start.isPending} className="btn-secondary !py-2 text-sm">
        {start.isPending ? <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> : <MessageCircle aria-hidden className="h-4 w-4" />}
        {label}
      </button>
      {start.isError && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {start.error instanceof ApiError ? start.error.message : 'Could not reach the server. Please try again.'}
        </p>
      )}
    </div>
  )
}

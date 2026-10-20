export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
  }
}

// Thin fetch wrapper: same-origin /api, cookies included, unwraps { success, data }.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })

  let json: { success: boolean; data?: T; error?: ApiErrorBody } | undefined
  try {
    json = await res.json()
  } catch {
    // non-JSON response
  }

  if (!res.ok || !json?.success) {
    throw new ApiError(res.status, json?.error ?? { code: 'NETWORK_ERROR', message: 'Request failed' })
  }
  return json.data as T
}

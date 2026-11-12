import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// No real sockets in tests: pages that listen for server pushes also poll, and the socket hook is tested on its own.
vi.mock('../lib/socket', () => ({ useServerEvent: vi.fn() }))

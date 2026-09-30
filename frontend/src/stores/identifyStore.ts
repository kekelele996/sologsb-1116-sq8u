import { createStore } from 'zustand/vanilla'
import type { IdentifyLog } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface IdentifyState {
  logs: IdentifyLog[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (log: IdentifyLog) => Promise<void>
  remove: (id: string) => Promise<void>
  latestOf: (recordId: string) => IdentifyLog | undefined
}

export const identifyStore = createStore<IdentifyState>((set, get) => ({
  logs: [],
  loaded: false,
  hydrate: async () => {
    const logs = await syncAll<IdentifyLog>(db.identifies)
    logs.sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id))
    set({ logs, loaded: true })
  },
  save: async (log) => {
    await syncPut<IdentifyLog>(db.identifies, log)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<IdentifyLog>(db.identifies, id)
    await get().hydrate()
  },
  latestOf: (recordId) => get().logs.find((item) => item.recordId === recordId)
}))

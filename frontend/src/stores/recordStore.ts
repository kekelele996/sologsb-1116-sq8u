import { createStore } from 'zustand/vanilla'
import type { FungusRecord } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface RecordState {
  records: FungusRecord[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (record: FungusRecord) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const recordStore = createStore<RecordState>((set, get) => ({
  records: [],
  loaded: false,
  hydrate: async () => {
    const records = await syncAll<FungusRecord>(db.records)
    records.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ records, loaded: true })
  },
  save: async (record) => {
    await syncPut<FungusRecord>(db.records, record)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<FungusRecord>(db.records, id)
    await get().hydrate()
  }
}))

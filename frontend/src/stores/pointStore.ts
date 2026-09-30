import { createStore } from 'zustand/vanilla'
import type { CollectPoint } from '@/types'
import { db, syncAll, syncDelete, syncPut } from '@/hooks/usePersistentStore'

export interface PointState {
  points: CollectPoint[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (point: CollectPoint) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const pointStore = createStore<PointState>((set, get) => ({
  points: [],
  loaded: false,
  hydrate: async () => {
    const points = await syncAll<CollectPoint>(db.points)
    points.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    set({ points, loaded: true })
  },
  save: async (point) => {
    await syncPut<CollectPoint>(db.points, point)
    await get().hydrate()
  },
  remove: async (id) => {
    await syncDelete<CollectPoint>(db.points, id)
    await get().hydrate()
  }
}))

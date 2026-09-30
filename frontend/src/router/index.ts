import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/atlas' },
  {
    path: '/atlas',
    name: 'atlas',
    component: () => import('@/pages/AtlasPage.vue'),
    meta: { title: '图谱总览' }
  },
  {
    path: '/atlas/:id',
    name: 'record-detail',
    component: () => import('@/pages/RecordDetailPage.vue'),
    meta: { title: '条目详情' }
  },
  {
    path: '/points',
    name: 'points',
    component: () => import('@/pages/PointsPage.vue'),
    meta: { title: '采集点管理' }
  },
  {
    path: '/identify',
    name: 'identify',
    component: () => import('@/pages/IdentifyPage.vue'),
    meta: { title: '鉴定工作页' }
  },
  {
    path: '/compare',
    name: 'compare',
    component: () => import('@/pages/ComparePage.vue'),
    meta: { title: '条目对比' }
  },
  {
    path: '/merge',
    name: 'merge',
    component: () => import('@/pages/MergePage.vue'),
    meta: { title: '外业批次合并' }
  },
  { path: '/:pathMatch(.*)*', redirect: '/atlas' }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.afterEach((to) => {
  const title = (to.meta.title as string | undefined) ?? '野生菌采集鉴定图谱'
  document.title = `${title} · 野生菌采集鉴定图谱`
})

export default router

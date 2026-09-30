import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from '@/App.vue'
import router from '@/router'
import { seedDemoData, stampDbVersion } from '@/hooks/usePersistentStore'
import { recordStore } from '@/stores/recordStore'
import { sporeStore } from '@/stores/sporeStore'
import { pointStore } from '@/stores/pointStore'
import { identifyStore } from '@/stores/identifyStore'
import '@/styles/main.css'

async function bootstrap(): Promise<void> {
  await seedDemoData()
  await stampDbVersion()
  await pointStore.getState().hydrate()
  await recordStore.getState().hydrate()
  await sporeStore.getState().hydrate()
  await identifyStore.getState().hydrate()
}

const app = createApp(App)

Object.entries(ElementPlusIconsVue).forEach(([key, component]) => {
  app.component(key, component)
})

app.use(router)
app.use(ElementPlus, { locale: zhCn })
app.mount('#app')

void bootstrap()

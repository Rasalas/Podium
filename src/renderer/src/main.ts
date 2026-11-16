import { createPinia } from 'pinia'
import { createApp } from 'vue'
import { setApi } from './api'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'

async function start() {
  if (window.podium) {
    setApi(window.podium)
  }
  else {
    // Plain browser (development): run against the in-memory mock backend.
    const { createMockBridge } = await import('./mock')
    setApi(createMockBridge())
  }
  createApp(App).use(createPinia()).mount('#app')
}

void start()

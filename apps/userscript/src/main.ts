import { App } from './app/app'

const app = new App()
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.init(), { once: true })
} else {
  app.init()
}
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    app.destroy()
  }
})
